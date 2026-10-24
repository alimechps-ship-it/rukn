import "server-only";
import type { Db } from "./admin";
import { accountNames, agentEffects, type JournalEntry } from "./journal";

const r2 = (n: number) => Math.round(n * 100) / 100;
const fmtN = (n: number) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const add = (m: Map<string, number>, k: string, v: number) => m.set(k, r2((m.get(k) ?? 0) + v));

export interface StatementLine {
  date: string; kind: "invoice" | "payment" | "journal" | "voucher"; doc: string; doc_id: string; case_id: string; code: string; clinic: string;
  currency: string; debit: number; credit: number; balance: number; note: string | null;
}
export interface AgentTotals { agent: string; invoiced: Map<string, number>; paid: Map<string, number>; journal: Map<string, number>; balance: Map<string, number>; pending: Map<string, number>; cases: number }

/**
 * Account of each agent with RUKN: invoices issued on his cases (debit) and payments
 * received (credit). RLS limits an agent to his own cases automatically.
 */
export async function loadStatements(db: Db, opts: { agent?: string | null; from?: string; to?: string }) {
  const from = opts.from && /^\d{4}-\d{2}-\d{2}$/.test(opts.from) ? opts.from : null;
  const to = opts.to && /^\d{4}-\d{2}-\d{2}$/.test(opts.to) ? opts.to : null;
  let cq = db.from("cases").select("id,code,clinic_name,agent_id").limit(10000);
  if (opts.agent) cq = cq.eq("agent_id", opts.agent);
  const { data: cases } = await cq;
  const caseMap = new Map((cases ?? []).map((c) => [c.id as string, c]));
  const ids = [...caseMap.keys()];
  let jq = db.from("journal_entries").select("*").eq("voided", false).or("dr_type.eq.agent,cr_type.eq.agent").limit(10000);
  if (opts.agent) jq = jq.or(`dr_agent_id.eq.${opts.agent},cr_agent_id.eq.${opts.agent}`);
  const { data: jRows } = await jq;
  const journal = (jRows ?? []) as JournalEntry[];
  // Payments and notices belong to the agent (with or without a case — advances / payments on account)
  let pq = db.from("case_payments").select("id,receipt_no,case_id,agent_id,paid_at,currency,amount,method,voided,reference,created_at").eq("voided", false).limit(20000);
  let nq = db.from("case_payment_claims").select("case_id,agent_id,currency,amount").eq("status", "pending");
  // Cash vouchers paid to / received from the agent directly (not the case-payment receipts, which come above)
  let vq = db.from("cash_entries").select("id,entry_no,agent_id,direction,amount,currency,entry_date,category,description,reference,created_at").eq("voided", false).not("agent_id", "is", null).is("case_payment_id", null).limit(20000);
  if (opts.agent) { pq = pq.eq("agent_id", opts.agent); nq = nq.eq("agent_id", opts.agent); vq = vq.eq("agent_id", opts.agent); }
  const { data: vouchers } = await vq;
  const [{ data: invs }, { data: pays }, { data: claims }] = await Promise.all([
    ids.length ? db.from("case_invoices").select("id,invoice_no,case_id,issue_date,currency,total,revision,issued_at,created_at").eq("status", "issued").in("case_id", ids) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    pq, nq,
  ]);
  if (!ids.length && !journal.length && !(pays ?? []).length && !(claims ?? []).length && !(vouchers ?? []).length) return { totals: [] as AgentTotals[], lines: [] as StatementLine[], opening: new Map<string, number>(), from, to };

  const totals = new Map<string, AgentTotals>();
  const T = (agent: string) => {
    if (!totals.has(agent)) totals.set(agent, { agent, invoiced: new Map(), paid: new Map(), journal: new Map(), balance: new Map(), pending: new Map(), cases: 0 });
    return totals.get(agent)!;
  };
  for (const c of cases ?? []) T(c.agent_id as string).cases++;
  for (const i of invs ?? []) { const t = T(caseMap.get(i.case_id as string)!.agent_id as string); add(t.invoiced, i.currency as string, Number(i.total)); add(t.balance, i.currency as string, Number(i.total)); }
  for (const p of pays ?? []) { const t = T(p.agent_id as string); add(t.paid, p.currency as string, Number(p.amount)); add(t.balance, p.currency as string, -Number(p.amount)); }
  // Journal entries: debit to an agent adds to what he owes, credit reduces it (an entry between two agents touches both)
  for (const e of journal) for (const ag of new Set([e.dr_agent_id, e.cr_agent_id])) {
    if (!ag || (opts.agent && ag !== opts.agent)) continue;
    const t = T(ag);
    for (const eff of agentEffects(e, ag)) { add(t.journal, eff.currency, eff.amount); add(t.balance, eff.currency, eff.amount); }
  }
  // out (paid to him) → debit; in (received from him) → credit
  for (const v of vouchers ?? []) { const t = T(v.agent_id as string); const amt = (v.direction === "out" ? 1 : -1) * Number(v.amount); add(t.journal, v.currency as string, amt); add(t.balance, v.currency as string, amt); }
  for (const n of claims ?? []) add(T(n.agent_id as string).pending, n.currency as string, Number(n.amount));

  // Ledger lines (only when one agent is selected)
  const lines: StatementLine[] = [];
  const opening = new Map<string, number>();
  if (opts.agent) {
    const names = await accountNames(db, journal);
    const raw: (Omit<StatementLine, "balance"> & { at: string })[] = [
      ...(invs ?? []).map((i) => {
        const c = caseMap.get(i.case_id as string)!;
        return { date: i.issue_date as string, kind: "invoice" as const, doc: i.invoice_no as string, doc_id: i.id as string, case_id: c.id as string, code: c.code as string, clinic: c.clinic_name as string,
          currency: i.currency as string, debit: Number(i.total), credit: 0, note: Number(i.revision) ? `rev. ${i.revision}` : null,
          at: String((i as Record<string, unknown>).issued_at ?? i.created_at ?? "") };
      }),
      ...(pays ?? []).map((p) => {
        const c = p.case_id ? caseMap.get(p.case_id as string) : undefined;
        const onAccount = !p.case_id;
        return { date: p.paid_at as string, kind: "payment" as const, doc: p.receipt_no as string, doc_id: p.id as string, case_id: (c?.id as string) ?? "", code: (c?.code as string) ?? "", clinic: (c?.clinic_name as string) ?? "",
          currency: p.currency as string, debit: 0, credit: Number(p.amount),
          note: [onAccount ? "On account / advance · دفعة على الحساب" : null, (p.reference as string | null) ?? null].filter(Boolean).join(" · ") || null, at: String(p.created_at ?? "") };
      }),
      ...(vouchers ?? []).map((v) => ({
        date: v.entry_date as string, kind: "voucher" as const, doc: v.entry_no as string, doc_id: v.id as string, case_id: "", code: "", clinic: "",
        currency: v.currency as string, debit: v.direction === "out" ? Number(v.amount) : 0, credit: v.direction === "in" ? Number(v.amount) : 0,
        note: [v.direction === "out" ? "Payment voucher · سند صرف" : "Receipt voucher · سند قبض", (v.description as string) || null, v.reference ? `ref. ${v.reference}` : null].filter(Boolean).join(" — "),
        at: String(v.created_at ?? ""),
      })),
      ...journal.flatMap((e) => agentEffects(e, opts.agent!).map((eff) => {
        const inv = eff.side === "dr" ? e.dr_invoice_id : e.cr_invoice_id;
        const c = inv ? caseMap.get((invs ?? []).find((x) => x.id === inv)?.case_id as string) : undefined;
        const other = names.side(e, eff.side === "dr" ? "cr" : "dr");
        return { date: e.entry_date, kind: "journal" as const, doc: e.entry_no, doc_id: e.id, case_id: (c?.id as string) ?? "", code: (c?.code as string) ?? "", clinic: (c?.clinic_name as string) ?? "",
          currency: eff.currency, debit: eff.side === "dr" ? Number(e.dr_amount) : 0, credit: eff.side === "cr" ? Number(e.cr_amount) : 0,
          note: `Journal · قيد — ${eff.side === "dr" ? "Cr" : "Dr"} ${other.en}${other.ar ? ` · ${other.ar}` : ""}${e.dr_currency !== e.cr_currency ? ` (${fmtN(e.dr_amount)} ${e.dr_currency} ⇄ ${fmtN(e.cr_amount)} ${e.cr_currency})` : ""}${e.description ? ` — ${e.description}` : ""}`, at: e.created_at };
      })),
    ].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.at !== b.at ? (a.at < b.at ? -1 : 1) : a.doc < b.doc ? -1 : 1)); // same day → in the order the documents were made
    const bal = new Map<string, number>();
    for (const l of raw) {
      if (from && l.date < from) { add(opening, l.currency, l.debit - l.credit); add(bal, l.currency, l.debit - l.credit); continue; }
      if (to && l.date > to) continue;
      add(bal, l.currency, l.debit - l.credit);
      const { at: _at, ...line } = l;
      lines.push({ ...line, balance: bal.get(l.currency) ?? 0 });
    }
  }
  return { totals: [...totals.values()], lines, opening, from, to };
}

export const mapText = (m: Map<string, number>, fmt: (v: number, c: string) => string) => (m.size ? [...m.entries()].filter(([, v]) => v !== 0).map(([c, v]) => fmt(v, c)).join(" · ") || "—" : "—");
