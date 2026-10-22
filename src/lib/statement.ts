import "server-only";
import type { Db } from "./admin";
import { ADJ_KINDS, signed, type Adjustment } from "./adjustments";

const r2 = (n: number) => Math.round(n * 100) / 100;
const add = (m: Map<string, number>, k: string, v: number) => m.set(k, r2((m.get(k) ?? 0) + v));

export interface StatementLine {
  date: string; kind: "invoice" | "payment" | "adjustment"; doc: string; doc_id: string; case_id: string; code: string; clinic: string;
  currency: string; debit: number; credit: number; balance: number; note: string | null;
}
export interface AgentTotals { agent: string; invoiced: Map<string, number>; paid: Map<string, number>; adjusted: Map<string, number>; balance: Map<string, number>; pending: Map<string, number>; cases: number }

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
  let aq = db.from("account_adjustments").select("*").eq("party_type", "agent").eq("voided", false).limit(10000);
  if (opts.agent) aq = aq.eq("agent_id", opts.agent);
  const { data: adjRows } = await aq;
  const adjs = (adjRows ?? []) as Adjustment[];
  if (!ids.length && !adjs.length) return { totals: [] as AgentTotals[], lines: [] as StatementLine[], opening: new Map<string, number>(), from, to };
  const [{ data: invs }, { data: pays }, { data: claims }] = ids.length ? await Promise.all([
    db.from("case_invoices").select("id,invoice_no,case_id,issue_date,currency,total,revision,issued_at,created_at").eq("status", "issued").in("case_id", ids),
    db.from("case_payments").select("id,receipt_no,case_id,paid_at,currency,amount,method,voided,reference,created_at").eq("voided", false).in("case_id", ids),
    db.from("case_payment_claims").select("case_id,currency,amount").eq("status", "pending").in("case_id", ids),
  ]) : [{ data: [] }, { data: [] }, { data: [] }];

  const totals = new Map<string, AgentTotals>();
  const T = (agent: string) => {
    if (!totals.has(agent)) totals.set(agent, { agent, invoiced: new Map(), paid: new Map(), adjusted: new Map(), balance: new Map(), pending: new Map(), cases: 0 });
    return totals.get(agent)!;
  };
  for (const c of cases ?? []) T(c.agent_id as string).cases++;
  for (const i of invs ?? []) { const t = T(caseMap.get(i.case_id as string)!.agent_id as string); add(t.invoiced, i.currency as string, Number(i.total)); add(t.balance, i.currency as string, Number(i.total)); }
  for (const p of pays ?? []) { const t = T(caseMap.get(p.case_id as string)!.agent_id as string); add(t.paid, p.currency as string, Number(p.amount)); add(t.balance, p.currency as string, -Number(p.amount)); }
  for (const a of adjs) { const t = T(a.agent_id!); add(t.adjusted, a.currency, signed(a)); add(t.balance, a.currency, signed(a)); }
  for (const n of claims ?? []) add(T(caseMap.get(n.case_id as string)!.agent_id as string).pending, n.currency as string, Number(n.amount));

  // Ledger lines (only when one agent is selected)
  const lines: StatementLine[] = [];
  const opening = new Map<string, number>();
  if (opts.agent) {
    const raw: (Omit<StatementLine, "balance"> & { at: string })[] = [
      ...(invs ?? []).map((i) => {
        const c = caseMap.get(i.case_id as string)!;
        return { date: i.issue_date as string, kind: "invoice" as const, doc: i.invoice_no as string, doc_id: i.id as string, case_id: c.id as string, code: c.code as string, clinic: c.clinic_name as string,
          currency: i.currency as string, debit: Number(i.total), credit: 0, note: Number(i.revision) ? `rev. ${i.revision}` : null,
          at: String((i as Record<string, unknown>).issued_at ?? i.created_at ?? "") };
      }),
      ...(pays ?? []).map((p) => {
        const c = caseMap.get(p.case_id as string)!;
        return { date: p.paid_at as string, kind: "payment" as const, doc: p.receipt_no as string, doc_id: p.id as string, case_id: c.id as string, code: c.code as string, clinic: c.clinic_name as string,
          currency: p.currency as string, debit: 0, credit: Number(p.amount), note: (p.reference as string | null) ?? null, at: String(p.created_at ?? "") };
      }),
      ...adjs.map((a) => {
        const c = a.case_id ? caseMap.get(a.case_id) : undefined;
        const k = ADJ_KINDS[a.kind];
        return { date: a.adj_date, kind: "adjustment" as const, doc: a.adj_no, doc_id: a.id, case_id: (c?.id as string) ?? "", code: (c?.code as string) ?? "", clinic: (c?.clinic_name as string) ?? "",
          currency: a.currency, debit: a.effect === "increase" ? Number(a.amount) : 0, credit: a.effect === "decrease" ? Number(a.amount) : 0,
          note: `${k?.en ?? a.kind} · ${k?.ar ?? ""}${a.description ? ` — ${a.description}` : ""}`, at: a.created_at };
      }),
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
