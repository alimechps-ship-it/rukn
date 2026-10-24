import "server-only";
import type { Db } from "./admin";

export type AccType = "agent" | "partner" | "ledger" | "cash";

export interface JournalEntry {
  id: string; entry_no: string; entry_date: string; description: string | null; reference: string | null;
  dr_type: AccType; dr_agent_id: string | null; dr_partner_id: string | null; dr_ledger_id: string | null; dr_cash_id?: string | null; dr_amount: number; dr_currency: string; dr_invoice_id: string | null; dr_bill_id: string | null;
  cr_type: AccType; cr_agent_id: string | null; cr_partner_id: string | null; cr_ledger_id: string | null; cr_cash_id?: string | null; cr_amount: number; cr_currency: string; cr_invoice_id: string | null; cr_bill_id: string | null;
  fx_rate: number | null; fx_source: "auto" | "manual" | null; voided: boolean; void_reason: string | null; created_by: string | null; created_at: string;
}
export interface LedgerAccount { id: string; code: string; name_en: string; name_ar: string | null; kind: string; active: boolean; parent_id: string | null; is_group: boolean; subledger: string | null; sort_order?: number }

/** Id of the account on one side of an entry, whatever its type. */
export const sideId = (e: JournalEntry, s: "dr" | "cr") => (e[`${s}_agent_id`] ?? e[`${s}_partner_id`] ?? e[`${s}_ledger_id`] ?? e[`${s}_cash_id`] ?? null) as string | null;

export const LEDGER_KINDS: Record<string, { en: string; ar: string }> = {
  income: { en: "Income", ar: "إيرادات" }, expense: { en: "Expense", ar: "مصروفات" }, equity: { en: "Equity", ar: "حقوق ملكية" },
  asset: { en: "Asset", ar: "أصول" }, liability: { en: "Liability", ar: "خصوم" }, other: { en: "Other", ar: "أخرى" },
};

/** Ready-made patterns: one side is a ledger account (by code), the other is chosen by the user. */
export const TEMPLATES: { key: string; en: string; ar: string; dr: AccType | string; cr: AccType | string; hint: string }[] = [
  { key: "box_expense", en: "Expense paid from a box", ar: "مصروف من صندوق", dr: "5200", cr: "cash", hint: "Dr an expense account / Cr the cash box — the money leaves the box (payment voucher CP- is created)." },
  { key: "box_income", en: "Income received into a box", ar: "إيراد في صندوق", dr: "cash", cr: "4900", hint: "Dr the cash box / Cr an income account — the money enters the box (receipt voucher CR- is created)." },
  { key: "box_agent", en: "Agent pays into a box", ar: "قبض من مندوب في صندوق", dr: "cash", cr: "agent", hint: "Dr the cash box / Cr the agent — reduces what the agent owes." },
  { key: "box_partner", en: "Pay a lab / clinic from a box", ar: "سداد لشريك من صندوق", dr: "partner", cr: "cash", hint: "Dr the lab / clinic / Cr the cash box — reduces what RUKN owes them." },
  { key: "discount_allowed", en: "Discount allowed", ar: "خصم مسموح به", dr: "5100", cr: "agent", hint: "Dr Discount allowed / Cr Agent — reduces what the agent owes." },
  { key: "discount_earned", en: "Discount earned", ar: "خصم مكتسب", dr: "partner", cr: "4200", hint: "Dr Lab / clinic / Cr Discount earned — reduces what RUKN owes them." },
  { key: "extra_agent", en: "Charge an agent for other services", ar: "إضافة خدمات على مندوب", dr: "agent", cr: "4100", hint: "Dr Agent / Cr Revenue — other services: adds to what the agent owes." },
  { key: "extra_partner", en: "Extra charge from a lab / clinic", ar: "إضافة من معمل أو عيادة", dr: "5200", cr: "partner", hint: "Dr Other expenses / Cr Lab / clinic — adds to what RUKN owes them." },
  { key: "fx_agent", en: "Currency difference (agent)", ar: "فروق عملة على مندوب", dr: "agent", cr: "6100", hint: "Swap the sides if the difference is in the agent's favour." },
  { key: "fx_partner", en: "Currency difference (lab / clinic)", ar: "فروق عملة مع معمل أو عيادة", dr: "6100", cr: "partner", hint: "Swap the sides if the difference is in RUKN's favour." },
  { key: "offset", en: "Offset: lab / clinic against agent", ar: "تقاص: شريك مقابل مندوب", dr: "partner", cr: "agent", hint: "What RUKN owes the partner is set off against what the agent owes RUKN." },
  { key: "convert_agent", en: "Convert an agent's balance to another currency", ar: "تحويل عملة رصيد مندوب", dr: "agent", cr: "agent", hint: "Same agent on both sides, two currencies: e.g. Dr agent 100 USD / Cr agent 5,000 EGP turns an EGP debt into a USD debt." },
  { key: "convert_partner", en: "Convert a lab / clinic balance to another currency", ar: "تحويل عملة رصيد شريك", dr: "partner", cr: "partner", hint: "Same partner on both sides, two currencies: e.g. Dr partner 5,000 EGP / Cr partner 100 USD turns what RUKN owes in EGP into USD." },
  { key: "transfer", en: "Move a balance between agents", ar: "نقل رصيد بين مندوبين", dr: "agent", cr: "agent", hint: "Dr the agent who takes the debt / Cr the agent who is released." },
];

type Eff = { amount: number; currency: string; side: "dr" | "cr" };
/** Effects of an entry on an agent's balance (what he owes RUKN) — both sides when the same agent converts currencies. */
export function agentEffects(e: JournalEntry, agentId: string): Eff[] {
  const out: Eff[] = [];
  if (e.dr_agent_id === agentId) out.push({ amount: Number(e.dr_amount), currency: e.dr_currency, side: "dr" });
  if (e.cr_agent_id === agentId) out.push({ amount: -Number(e.cr_amount), currency: e.cr_currency, side: "cr" });
  return out;
}
/** Effects on what RUKN owes a partner. */
export function partnerEffects(e: JournalEntry, partnerId: string): Eff[] {
  const out: Eff[] = [];
  if (e.dr_partner_id === partnerId) out.push({ amount: -Number(e.dr_amount), currency: e.dr_currency, side: "dr" });
  if (e.cr_partner_id === partnerId) out.push({ amount: Number(e.cr_amount), currency: e.cr_currency, side: "cr" });
  return out;
}

/** Effect on what RUKN owes a partner. */
export function partnerEffect(e: JournalEntry, partnerId: string): { amount: number; currency: string; side: "dr" | "cr" } | null {
  if (e.cr_partner_id === partnerId) return { amount: Number(e.cr_amount), currency: e.cr_currency, side: "cr" };
  if (e.dr_partner_id === partnerId) return { amount: -Number(e.dr_amount), currency: e.dr_currency, side: "dr" };
  return null;
}

/**
 * Reduction of documents' balances from journal entries linked to them:
 * invoice — credit to the agent reduces, debit increases; bill — debit to the partner reduces, credit increases.
 * balance = total − payments − credit.
 */
export async function docCredits(db: Db, by: { invoiceIds?: string[]; billIds?: string[] }): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const add = (k: string | null, v: number) => { if (k) out.set(k, Math.round(((out.get(k) ?? 0) + v) * 100) / 100); };
  const inv = by.invoiceIds ?? []; const bills = by.billIds ?? [];
  const queries = [];
  if (inv.length) {
    const l = inv.join(",");
    queries.push(db.from("journal_entries").select("dr_invoice_id,cr_invoice_id,dr_amount,cr_amount").eq("voided", false).or(`dr_invoice_id.in.(${l}),cr_invoice_id.in.(${l})`)
      .then(({ data }) => { for (const r of data ?? []) { if (inv.includes(r.cr_invoice_id as string)) add(r.cr_invoice_id as string, Number(r.cr_amount)); if (inv.includes(r.dr_invoice_id as string)) add(r.dr_invoice_id as string, -Number(r.dr_amount)); } }));
  }
  if (bills.length) {
    const l = bills.join(",");
    queries.push(db.from("journal_entries").select("dr_bill_id,cr_bill_id,dr_amount,cr_amount").eq("voided", false).or(`dr_bill_id.in.(${l}),cr_bill_id.in.(${l})`)
      .then(({ data }) => { for (const r of data ?? []) { if (bills.includes(r.dr_bill_id as string)) add(r.dr_bill_id as string, Number(r.dr_amount)); if (bills.includes(r.cr_bill_id as string)) add(r.cr_bill_id as string, -Number(r.cr_amount)); } }));
  }
  await Promise.all(queries);
  return out;
}

/** Names for both sides of entries (agents, partners, ledger accounts the user may read). */
export async function accountNames(db: Db, entries: JournalEntry[]) {
  const agents = [...new Set(entries.flatMap((e) => [e.dr_agent_id, e.cr_agent_id]).filter(Boolean))] as string[];
  const partners = [...new Set(entries.flatMap((e) => [e.dr_partner_id, e.cr_partner_id]).filter(Boolean))] as string[];
  const [{ data: a }, { data: p }, { data: l }, { data: boxes }] = await Promise.all([
    agents.length ? db.from("profiles").select("id,full_name,email").in("id", agents) : Promise.resolve({ data: [] }),
    partners.length ? db.from("partners").select("id,name,kind").in("id", partners) : Promise.resolve({ data: [] }),
    db.from("ledger_accounts").select("id,code,name_en,name_ar"),
    db.from("cash_accounts").select("id,name,currency"),
  ]);
  const m = new Map<string, { en: string; ar: string; kind: string }>();
  for (const x of a ?? []) m.set(`agent:${x.id}`, { en: (x.full_name || x.email) as string, ar: "مندوب", kind: "Agent" });
  for (const x of p ?? []) m.set(`partner:${x.id}`, { en: x.name as string, ar: x.kind === "lab" ? "معمل" : "عيادة", kind: x.kind === "lab" ? "Lab" : "Clinic" });
  for (const x of l ?? []) m.set(`ledger:${x.id}`, { en: `${x.code} ${x.name_en}`, ar: (x.name_ar as string) ?? "", kind: "Account" });
  for (const x of boxes ?? []) m.set(`cash:${x.id}`, { en: `${x.name} (${x.currency})`, ar: "صندوق", kind: "Cash box" });
  const side = (e: JournalEntry, s: "dr" | "cr") => {
    const t = e[`${s}_type`]; const id = sideId(e, s);
    return m.get(`${t}:${id}`) ?? { en: t === "agent" ? "Agent" : t === "partner" ? "Partner" : t === "cash" ? "Cash box" : "Account", ar: "", kind: t };
  };
  return { side };
}
