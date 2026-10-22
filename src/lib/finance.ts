import "server-only";
import type { Db } from "./admin";
import { withQuote } from "./cases";
import { docCredits } from "./adjustments";

export const CASH_KINDS: Record<string, { en: string; ar: string }> = {
  cash: { en: "Cash box", ar: "صندوق نقدي" },
  bank: { en: "Bank account", ar: "حساب بنكي" },
  wallet: { en: "e-Wallet", ar: "محفظة إلكترونية" },
};

/** Categories a person can choose for each direction (case_payment & transfer are created automatically). */
export const IN_CATEGORIES: Record<string, { en: string; ar: string }> = {
  owner_deposit: { en: "Owner / partner deposit", ar: "إيداع من المالك أو الشريك" },
  advance_return: { en: "Custody / advance returned", ar: "رد عهدة أو سلفة" },
  other_income: { en: "Other income", ar: "إيراد آخر" },
  partner_refund: { en: "Returned by a lab / clinic", ar: "مرتجع من معمل أو عيادة" },
};
export const OUT_CATEGORIES: Record<string, { en: string; ar: string }> = {
  withdrawal: { en: "Withdrawal (owner / partner)", ar: "مسحوبات (مالك أو شريك)" },
  advance: { en: "Custody / advance to a person", ar: "عهدة أو سلفة لشخص" },
  salary: { en: "Salary / commission", ar: "رواتب أو عمولات" },
  lab: { en: "Lab / production", ar: "معمل وتصنيع" },
  planning: { en: "Treatment planning fees", ar: "أتعاب التخطيط العلاجي" },
  supplies: { en: "Materials & supplies", ar: "خامات ومستلزمات" },
  shipping: { en: "Shipping & courier", ar: "شحن ومناديب توصيل" },
  rent: { en: "Rent", ar: "إيجار" },
  utilities: { en: "Utilities & internet", ar: "مرافق وإنترنت" },
  marketing: { en: "Marketing", ar: "تسويق" },
  fees: { en: "Bank & transfer fees", ar: "رسوم بنكية وتحويل" },
  other: { en: "Other expense", ar: "مصروف آخر" },
};
export const ALL_CATEGORIES: Record<string, { en: string; ar: string }> = {
  case_payment: { en: "Case payment", ar: "تحصيل حالة" },
  transfer: { en: "Transfer", ar: "تحويل بين الصناديق" },
  ...IN_CATEGORIES,
  ...OUT_CATEGORIES,
};

export const AGING = [
  { key: "current", en: "Not yet due", ar: "لم يستحق", min: -Infinity, max: 0 },
  { key: "d30", en: "1–30 days", ar: "١–٣٠ يوم", min: 1, max: 30 },
  { key: "d60", en: "31–60 days", ar: "٣١–٦٠ يوم", min: 31, max: 60 },
  { key: "d90", en: "61–90 days", ar: "٦١–٩٠ يوم", min: 61, max: 90 },
  { key: "d90p", en: "Over 90 days", ar: "أكثر من ٩٠ يوم", min: 91, max: Infinity },
] as const;
export type AgingKey = (typeof AGING)[number]["key"];

const DAY = 86400000;
export const todayIso = () => new Date().toISOString().slice(0, 10);
export function daysOverdue(due: string | null, issue: string) {
  const ref = Date.parse(`${due ?? issue}T00:00:00Z`);
  const now = Date.parse(`${todayIso()}T00:00:00Z`);
  return Math.round((now - ref) / DAY);
}
export const agingOf = (days: number): AgingKey => (AGING.find((a) => days >= a.min && days <= a.max) ?? AGING[0]).key;

export const addTo = (m: Map<string, number>, k: string, v: number) => m.set(k, Math.round(((m.get(k) ?? 0) + v) * 100) / 100);

// ---------------------------------------------------------------------------------
// Receivables
// ---------------------------------------------------------------------------------
export type ReceivableFilters = { agent?: string; country?: string; bucket?: string; q?: string };

export interface ReceivableRow {
  invoice_id: string; invoice_no: string; issue_date: string; due_date: string | null; currency: string; total: number; paid: number; balance: number;
  days: number; bucket: AgingKey; revision: number;
  case_id: string; code: string; clinic_name: string; doctor_name: string; patient_ref: string; agent_id: string; country_code: string; status: string;
}

export async function loadReceivables(db: Db, f: ReceivableFilters) {
  const { data: invs, error } = await db.from("case_invoices")
    .select("id,invoice_no,issue_date,due_date,currency,total,revision,case_id")
    .eq("status", "issued").order("issue_date").limit(5000);
  const caseIds = [...new Set((invs ?? []).map((i) => i.case_id as string))];
  const invIds = (invs ?? []).map((i) => i.id as string);
  const [{ data: cases }, { data: pays }, credits] = await Promise.all([
    caseIds.length ? db.from("cases").select("id,code,clinic_name,doctor_name,patient_ref,agent_id,country_code,status").in("id", caseIds) : Promise.resolve({ data: [] }),
    invIds.length ? db.from("case_payments").select("invoice_id,amount,voided").in("invoice_id", invIds) : Promise.resolve({ data: [] }),
    docCredits(db, { invoiceIds: invIds }),
  ]);
  const caseMap = new Map((cases ?? []).map((c) => [c.id as string, c]));
  const paid = new Map<string, number>();
  for (const p of (pays ?? []) as { invoice_id: string; amount: number; voided: boolean }[]) if (!p.voided) addTo(paid, p.invoice_id, Number(p.amount));

  const q = (f.q ?? "").trim().toLowerCase();
  const rows: ReceivableRow[] = [];
  for (const i of invs ?? []) {
    const c = caseMap.get(i.case_id as string);
    if (!c) continue;
    const p = Math.round(((paid.get(i.id as string) ?? 0) + (credits.get(i.id as string) ?? 0)) * 100) / 100; // payments + discounts / offsets on the invoice
    const balance = Math.round((Number(i.total) - p) * 100) / 100;
    if (balance <= 0) continue;
    const days = daysOverdue(i.due_date as string | null, i.issue_date as string);
    const row: ReceivableRow = {
      invoice_id: i.id as string, invoice_no: i.invoice_no as string, issue_date: i.issue_date as string, due_date: i.due_date as string | null,
      currency: i.currency as string, total: Number(i.total), paid: p, balance, days, bucket: agingOf(days), revision: Number(i.revision ?? 0),
      case_id: c.id as string, code: c.code as string, clinic_name: c.clinic_name as string, doctor_name: c.doctor_name as string,
      patient_ref: c.patient_ref as string, agent_id: c.agent_id as string, country_code: c.country_code as string, status: c.status as string,
    };
    if (f.agent && row.agent_id !== f.agent) continue;
    if (f.country && row.country_code !== f.country) continue;
    if (f.bucket === "overdue" && row.days <= 0) continue;
    if (f.bucket && f.bucket !== "overdue" && row.bucket !== f.bucket) continue;
    if (q && ![row.invoice_no, row.code, row.clinic_name, row.doctor_name, row.patient_ref].some((v) => v?.toLowerCase().includes(q))) continue;
    rows.push(row);
  }
  rows.sort((a, b) => b.days - a.days);

  const byCurrency = new Map<string, number>();
  const byBucket = new Map<string, Map<string, number>>(); // bucket -> currency -> amount
  const byAgent = new Map<string, Map<string, number>>();
  for (const r of rows) {
    addTo(byCurrency, r.currency, r.balance);
    if (!byBucket.has(r.bucket)) byBucket.set(r.bucket, new Map());
    addTo(byBucket.get(r.bucket)!, r.currency, r.balance);
    if (!byAgent.has(r.agent_id)) byAgent.set(r.agent_id, new Map());
    addTo(byAgent.get(r.agent_id)!, r.currency, r.balance);
  }

  // Cases that have no issued invoice yet (work that is not billed), excluding cancelled ones.
  const { data: allCases } = await db.from("cases").select("id,code,clinic_name,agent_id,country_code,status,case_finance(quote_amount,quote_currency),created_at")
    .neq("status", "cancelled").order("created_at").limit(5000);
  const billed = new Set(caseIds);
  const unbilled = ((allCases ?? []) as Record<string, unknown>[]).map(withQuote).filter((c) => !billed.has(c.id as string)
    && (!f.agent || c.agent_id === f.agent) && (!f.country || c.country_code === f.country));

  return { error: error?.message ?? null, rows, byCurrency, byBucket, byAgent, unbilled };
}

export const moneyMap = (m: Map<string, number> | undefined, fmt: (v: number, c: string) => string) =>
  m && m.size ? [...m.entries()].map(([c, v]) => fmt(v, c)).join(" + ") : "—";

// ---------------------------------------------------------------------------------
// Cash
// ---------------------------------------------------------------------------------
export interface CashAccount { id: string; name: string; kind: string; currency: string; opening_balance: number; custodian: string | null; notes: string | null; active: boolean; sort_order: number }
export interface CashEntry {
  id: string; entry_no: string; account_id: string; direction: "in" | "out"; amount: number; currency: string; entry_date: string; category: string;
  party_user: string | null; party_name: string | null; description: string | null; reference: string | null; case_id: string | null;
  case_payment_id: string | null; transfer_group: string | null; partner_id: string | null; partner_payment_id: string | null; voided: boolean; void_reason: string | null; created_by: string | null; created_at: string;
}

export async function accountsWithBalance(db: Db) {
  const [{ data: accounts }, { data: entries }] = await Promise.all([
    db.from("cash_accounts").select("*").order("sort_order").order("name"),
    db.from("cash_entries").select("account_id,direction,amount,voided"),
  ]);
  const bal = new Map<string, number>();
  for (const e of (entries ?? []) as { account_id: string; direction: string; amount: number; voided: boolean }[]) {
    if (!e.voided) addTo(bal, e.account_id, e.direction === "in" ? Number(e.amount) : -Number(e.amount));
  }
  return ((accounts ?? []) as CashAccount[]).map((a) => ({ ...a, balance: Math.round((Number(a.opening_balance) + (bal.get(a.id) ?? 0)) * 100) / 100 }));
}

/** Person key: linked user id, or the typed name (case-insensitive). */
export const personKey = (e: Pick<CashEntry, "party_user" | "party_name">) => (e.party_user ? `u:${e.party_user}` : e.party_name ? `n:${e.party_name.trim().toLowerCase()}` : null);

/** Team members (anyone with a role) for the "person" selector, and an id → name map. */
export async function teamPeople(db: Db) {
  const [{ data: profiles }, { data: roles }] = await Promise.all([
    db.from("profiles").select("id,full_name,email,is_active").order("full_name"),
    db.from("user_roles").select("user_id"),
  ]);
  const withRole = new Set((roles ?? []).map((r) => r.user_id as string));
  const names = new Map((profiles ?? []).map((p) => [p.id as string, (p.full_name || p.email) as string]));
  const people = (profiles ?? []).filter((p) => p.is_active && withRole.has(p.id as string)).map((p) => ({ id: p.id as string, name: (p.full_name || p.email) as string }));
  return { people, names };
}

/** Statement of one box between two dates (inclusive), with opening balance and running balance. */
export async function loadStatement(db: Db, accountId: string, from?: string, to?: string) {
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) return null;
  const { data: account } = await db.from("cash_accounts").select("*").eq("id", accountId).maybeSingle();
  if (!account) return null;
  const f = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null;
  const t = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : null;
  const { data } = await db.from("cash_entries").select("*").eq("account_id", accountId).order("entry_date").order("created_at").limit(10000);
  const all = (data ?? []) as CashEntry[];
  let opening = Number(account.opening_balance);
  const entries: CashEntry[] = [];
  for (const e of all) {
    const signed = e.direction === "in" ? Number(e.amount) : -Number(e.amount);
    if (f && e.entry_date < f) { if (!e.voided) opening += signed; continue; }
    if (t && e.entry_date > t) continue;
    entries.push(e);
  }
  opening = Math.round(opening * 100) / 100;
  const running = new Map<string, number>();
  let bal = opening, totalIn = 0, totalOut = 0;
  for (const e of entries) {
    if (e.voided) continue;
    if (e.direction === "in") { bal += Number(e.amount); totalIn += Number(e.amount); } else { bal -= Number(e.amount); totalOut += Number(e.amount); }
    bal = Math.round(bal * 100) / 100;
    running.set(e.id, bal);
  }
  return { account: account as CashAccount, opening, entries, running, totalIn: Math.round(totalIn * 100) / 100, totalOut: Math.round(totalOut * 100) / 100, closing: bal, from: f, to: t };
}

/** Person accounts: what each person took from the boxes and what they returned. */
export async function loadPeople(db: Db, from?: string, to?: string) {
  const { data } = await db.from("cash_entries").select("*").eq("voided", false).or("party_user.not.is.null,party_name.not.is.null").is("partner_id", null).order("entry_date").order("created_at").limit(10000);
  const f = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null;
  const t = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : null;
  const rows = ((data ?? []) as CashEntry[]).filter((e) => (!f || e.entry_date >= f) && (!t || e.entry_date <= t));
  const people = new Map<string, { key: string; user: string | null; name: string | null; taken: Map<string, number>; returned: Map<string, number>; byCategory: Map<string, Map<string, number>>; entries: CashEntry[] }>();
  for (const e of rows) {
    const k = personKey(e);
    if (!k) continue;
    if (!people.has(k)) people.set(k, { key: k, user: e.party_user, name: e.party_name, taken: new Map(), returned: new Map(), byCategory: new Map(), entries: [] });
    const p = people.get(k)!;
    p.entries.push(e);
    if (e.direction === "out") addTo(p.taken, e.currency, Number(e.amount)); else addTo(p.returned, e.currency, Number(e.amount));
    if (!p.byCategory.has(e.category)) p.byCategory.set(e.category, new Map());
    addTo(p.byCategory.get(e.category)!, e.currency, e.direction === "out" ? Number(e.amount) : -Number(e.amount));
  }
  return { people: [...people.values()], from: f, to: t };
}

export function netMap(taken: Map<string, number>, returned: Map<string, number>) {
  const m = new Map<string, number>();
  for (const [c, v] of taken) addTo(m, c, v);
  for (const [c, v] of returned) addTo(m, c, -v);
  return m;
}

/** Labs / clinics and their open approved bills, for the voucher party picker. */
export async function voucherParties(db: Db) {
  const [{ data: partners }, { data: bills }, { data: pays }] = await Promise.all([
    db.from("partners").select("id,name,kind,contact_name,phone,city,currency,active").order("name"),
    db.from("partner_bills").select("id,bill_no,partner_id,total,currency").eq("status", "approved"),
    db.from("partner_payments").select("bill_id,amount,voided").not("bill_id", "is", null),
  ]);
  const paid = new Map<string, number>();
  for (const p of pays ?? []) if (!p.voided) paid.set(p.bill_id as string, (paid.get(p.bill_id as string) ?? 0) + Number(p.amount));
  const credits = await docCredits(db, { billIds: (bills ?? []).map((b) => b.id as string) });
  for (const [k, v] of credits) paid.set(k, (paid.get(k) ?? 0) + v);
  return {
    partners: (partners ?? []).map((p) => ({ id: p.id as string, name: p.name as string, kind: p.kind as string, contact: (p.contact_name as string) ?? null, phone: (p.phone as string) ?? null, city: (p.city as string) ?? null, currency: p.currency as string, active: Boolean(p.active) })),
    bills: (bills ?? []).map((b) => ({ id: b.id as string, bill_no: b.bill_no as string, partner_id: b.partner_id as string, currency: b.currency as string, due: Math.round((Number(b.total) - (paid.get(b.id as string) ?? 0)) * 100) / 100 })).filter((b) => b.due > 0),
  };
}
