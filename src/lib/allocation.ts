import "server-only";
import type { Db } from "./admin";
import { docCredits, type JournalEntry } from "./journal";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Advances / payments on account applied to invoices (تسوية الدفعات المقدمة مع الفواتير).
 *
 * For every agent and currency, the money he paid that is not tied to an invoice
 * (payments on account / advances, receipt vouchers, journal credits without an invoice)
 * minus his charges that are not invoices (payment vouchers to him, journal debits without
 * an invoice) is his unapplied credit. It settles his issued invoices in that currency,
 * oldest first. What is left over stays as credit on his account.
 *
 * Returns invoice id → amount of advance applied to it. RLS applies (an agent sees his own).
 */
export async function advanceAllocation(db: Db, agentIds?: string[]): Promise<Map<string, number>> {
  let iq = db.from("case_invoices").select("id,currency,total,issue_date,issued_at,created_at,cases!inner(agent_id)").eq("status", "issued").limit(10000);
  let pq = db.from("case_payments").select("agent_id,invoice_id,amount,currency").eq("voided", false).is("invoice_id", null).limit(20000);
  let vq = db.from("cash_entries").select("agent_id,direction,amount,currency").eq("voided", false).not("agent_id", "is", null).is("case_payment_id", null).limit(20000);
  let jq = db.from("journal_entries").select("*").eq("voided", false).or("dr_type.eq.agent,cr_type.eq.agent").limit(20000);
  if (agentIds?.length) {
    iq = iq.in("cases.agent_id", agentIds); pq = pq.in("agent_id", agentIds); vq = vq.in("agent_id", agentIds);
    jq = jq.or(`dr_agent_id.in.(${agentIds.join(",")}),cr_agent_id.in.(${agentIds.join(",")})`);
  }
  const [{ data: invs }, { data: pays }, { data: vouchers }, { data: journal }] = await Promise.all([iq, pq, vq, jq]);
  const list = ((invs ?? []) as unknown as { id: string; currency: string; total: number; issue_date: string; issued_at: string | null; created_at: string; cases: { agent_id: string } }[]);
  if (!list.length) return new Map();
  const ids = list.map((i) => i.id);
  const [{ data: linkedPays }, credits] = await Promise.all([
    db.from("case_payments").select("invoice_id,amount").eq("voided", false).in("invoice_id", ids),
    docCredits(db, { invoiceIds: ids }),
  ]);

  // unapplied credit per agent|currency
  const credit = new Map<string, number>();
  const add = (agent: string, cur: string, v: number) => { const k = `${agent}|${cur}`; credit.set(k, r2((credit.get(k) ?? 0) + v)); };
  for (const p of pays ?? []) add(p.agent_id as string, p.currency as string, Number(p.amount));
  for (const v of vouchers ?? []) add(v.agent_id as string, v.currency as string, (v.direction === "in" ? 1 : -1) * Number(v.amount));
  for (const e of (journal ?? []) as JournalEntry[]) {
    if (e.cr_agent_id && !e.cr_invoice_id) add(e.cr_agent_id, e.cr_currency, Number(e.cr_amount));
    if (e.dr_agent_id && !e.dr_invoice_id) add(e.dr_agent_id, e.dr_currency, -Number(e.dr_amount));
  }

  // what is still open on each invoice before advances
  const paid = new Map<string, number>();
  for (const p of linkedPays ?? []) paid.set(p.invoice_id as string, r2((paid.get(p.invoice_id as string) ?? 0) + Number(p.amount)));
  const out = new Map<string, number>();
  const sorted = [...list].sort((a, b) => (a.issue_date !== b.issue_date ? (a.issue_date < b.issue_date ? -1 : 1) : (a.issued_at ?? a.created_at) < (b.issued_at ?? b.created_at) ? -1 : 1));
  for (const inv of sorted) {
    const k = `${inv.cases.agent_id}|${inv.currency}`;
    const avail = credit.get(k) ?? 0;
    if (avail <= 0) continue;
    const open = r2(Number(inv.total) - (paid.get(inv.id) ?? 0) - (credits.get(inv.id) ?? 0));
    if (open <= 0) continue;
    const use = r2(Math.min(open, avail));
    out.set(inv.id, use);
    credit.set(k, r2(avail - use));
  }
  return out;
}
