import "server-only";
import type { Db } from "./admin";

export const PARTNER_KINDS: Record<string, { en: string; ar: string; work: "planning" | "production" }> = {
  planner: { en: "Treatment planner", ar: "مخطط علاجي (طبيب / عيادة)", work: "planning" },
  lab: { en: "Production lab", ar: "معمل تصنيع", work: "production" },
};
export const WORK_KINDS: Record<string, { en: string; ar: string }> = {
  planning: { en: "Treatment planning", ar: "تخطيط علاجي" },
  production: { en: "Production", ar: "تصنيع" },
};
export const WO_STATUS: Record<string, { en: string; ar: string; tone: string }> = {
  assigned: { en: "Sent — awaiting acceptance", ar: "مرسل — بانتظار القبول", tone: "changes" },
  accepted: { en: "Accepted", ar: "مقبول", tone: "new" },
  in_progress: { en: "In progress", ar: "قيد التنفيذ", tone: "contacted" },
  completed: { en: "Completed", ar: "مكتمل", tone: "qualified" },
  shipped: { en: "Shipped to RUKN", ar: "تم الشحن إلى ركن", tone: "qualified" },
  received: { en: "Received by RUKN", ar: "استلمته ركن", tone: "published" },
  cancelled: { en: "Cancelled", ar: "ملغى", tone: "archived" },
  rejected: { en: "Declined by partner", ar: "رفضه الشريك", tone: "closed" },
};
export const BILL_STATUS: Record<string, { en: string; ar: string; tone: string }> = {
  submitted: { en: "Awaiting review", ar: "بانتظار المراجعة", tone: "changes" },
  approved: { en: "Approved", ar: "معتمدة", tone: "published" },
  rejected: { en: "Rejected", ar: "مرفوضة", tone: "closed" },
  void: { en: "Void", ar: "ملغاة", tone: "archived" },
};
export const OPEN_WO = ["assigned", "accepted", "in_progress", "completed", "shipped"];

export interface Partner {
  id: string; kind: string; name: string; contact_name: string | null; phone: string | null; email: string | null; country: string | null; city: string | null;
  address: string | null; currency: string; tax_number: string | null; bank_details: string | null; notes: string | null; active: boolean;
}
export interface WorkOrder {
  id: string; order_no: string; case_id: string; partner_id: string; kind: string; title: string; instructions: string | null; items: { title: string; text: string }[];
  due_date: string | null; status: string; carrier: string | null; tracking_no: string | null;
  accepted_at: string | null; completed_at: string | null; shipped_at: string | null; received_at: string | null; partner_note: string | null; created_at: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const add = (m: Map<string, number>, k: string, v: number) => m.set(k, r2((m.get(k) ?? 0) + v));

/** What RUKN owes each partner: approved bills − payments, per currency; plus unbilled completed work. */
export async function partnerBalances(db: Db, partnerId?: string) {
  let bq = db.from("partner_bills").select("partner_id,currency,total,status").in("status", ["approved", "submitted"]);
  let pq = db.from("partner_payments").select("partner_id,currency,amount,voided").eq("voided", false);
  let wq = db.from("case_assignments").select("id,partner_id,status,assignment_costs(cost_amount,currency)");
  let rq = db.from("cash_entries").select("partner_id,currency,amount").eq("category", "partner_refund").eq("voided", false);
  if (partnerId) { bq = bq.eq("partner_id", partnerId); pq = pq.eq("partner_id", partnerId); wq = wq.eq("partner_id", partnerId); rq = rq.eq("partner_id", partnerId); }
  const [{ data: bills }, { data: pays }, { data: wos }, { data: lines }, { data: refunds }] = await Promise.all([
    bq, pq, wq, db.from("partner_bill_lines").select("assignment_id,bill_id,partner_bills!inner(status)").not("assignment_id", "is", null), rq,
  ]);
  const billed = new Set(((lines ?? []) as unknown as { assignment_id: string; partner_bills: { status: string } }[])
    .filter((l) => ["submitted", "approved"].includes(l.partner_bills.status)).map((l) => l.assignment_id));
  const out = new Map<string, { approved: Map<string, number>; pending: Map<string, number>; paid: Map<string, number>; owed: Map<string, number>; unbilled: Map<string, number>; openOrders: number }>();
  const P = (id: string) => {
    if (!out.has(id)) out.set(id, { approved: new Map(), pending: new Map(), paid: new Map(), owed: new Map(), unbilled: new Map(), openOrders: 0 });
    return out.get(id)!;
  };
  for (const b of bills ?? []) {
    const t = P(b.partner_id as string);
    if (b.status === "approved") { add(t.approved, b.currency as string, Number(b.total)); add(t.owed, b.currency as string, Number(b.total)); }
    else add(t.pending, b.currency as string, Number(b.total));
  }
  for (const p of pays ?? []) { const t = P(p.partner_id as string); add(t.paid, p.currency as string, Number(p.amount)); add(t.owed, p.currency as string, -Number(p.amount)); }
  for (const r of refunds ?? []) { const t = P(r.partner_id as string); add(t.paid, r.currency as string, -Number(r.amount)); add(t.owed, r.currency as string, Number(r.amount)); }
  for (const w of wos ?? []) {
    const t = P(w.partner_id as string);
    if (OPEN_WO.includes(w.status as string) && !["completed", "shipped"].includes(w.status as string)) t.openOrders++;
    const cost = (w as unknown as { assignment_costs: { cost_amount: number | null; currency: string } | null }).assignment_costs;
    if (["completed", "shipped", "received"].includes(w.status as string) && !billed.has(w.id as string) && cost?.cost_amount) add(t.unbilled, cost.currency, Number(cost.cost_amount));
  }
  return out;
}

export interface PartnerLine { date: string; kind: "bill" | "payment" | "refund"; doc: string; id: string; ref: string | null; currency: string; billed: number; paid: number; balance: number; note: string | null }

/** Statement of one partner: approved bills (we owe) and payments (we paid). */
export async function partnerStatement(db: Db, partnerId: string, from?: string, to?: string) {
  const f = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null;
  const t = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : null;
  const [{ data: bills }, { data: pays }, { data: refunds }] = await Promise.all([
    db.from("partner_bills").select("id,bill_no,partner_ref,bill_date,currency,total,created_at,reviewed_at").eq("partner_id", partnerId).eq("status", "approved"),
    db.from("partner_payments").select("id,payment_no,paid_at,currency,amount,reference,method,created_at").eq("partner_id", partnerId).eq("voided", false),
    db.from("cash_entries").select("id,entry_no,entry_date,currency,amount,reference,created_at").eq("partner_id", partnerId).eq("category", "partner_refund").eq("voided", false),
  ]);
  const raw = [
    ...(bills ?? []).map((b) => ({ date: b.bill_date as string, kind: "bill" as const, doc: b.bill_no as string, id: b.id as string, ref: (b.partner_ref as string) ?? null, currency: b.currency as string, billed: Number(b.total), paid: 0, note: null, at: String(b.created_at ?? "") })),
    ...(pays ?? []).map((p) => ({ date: p.paid_at as string, kind: "payment" as const, doc: p.payment_no as string, id: p.id as string, ref: (p.reference as string) ?? null, currency: p.currency as string, billed: 0, paid: Number(p.amount), note: p.method as string, at: String(p.created_at ?? "") })),
    // Money the partner returned to RUKN (receipt voucher): adds back to what RUKN owes / reduces an advance
    ...(refunds ?? []).map((r) => ({ date: r.entry_date as string, kind: "refund" as const, doc: r.entry_no as string, id: r.id as string, ref: (r.reference as string) ?? null, currency: r.currency as string, billed: Number(r.amount), paid: 0, note: null, at: String(r.created_at ?? "") })),
  ].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.at !== b.at ? (a.at < b.at ? -1 : 1) : a.doc < b.doc ? -1 : 1)); // same day → in the order the documents were made
  const opening = new Map<string, number>(); const bal = new Map<string, number>();
  const lines: PartnerLine[] = [];
  const totals = { billed: new Map<string, number>(), paid: new Map<string, number>() };
  for (const l of raw) {
    if (f && l.date < f) { add(opening, l.currency, l.billed - l.paid); add(bal, l.currency, l.billed - l.paid); continue; }
    if (t && l.date > t) continue;
    add(bal, l.currency, l.billed - l.paid);
    if (l.billed) add(totals.billed, l.currency, l.billed);
    if (l.paid) add(totals.paid, l.currency, l.paid);
    const { at: _at, ...line } = l;
    lines.push({ ...line, balance: bal.get(l.currency) ?? 0 });
  }
  return { lines, opening, closing: bal, totals, from: f, to: t };
}

export const mm = (m: Map<string, number> | undefined, fmt: (v: number, c: string) => string) =>
  m && [...m.values()].some((v) => v !== 0) ? [...m.entries()].filter(([, v]) => v !== 0).map(([c, v]) => fmt(v, c)).join(" · ") : "—";

export type CostMap = Map<string, { amount: number | null; currency: string }>;
/** Agreed costs of work orders (visible to finance and to the partner of each order). */
export async function costsFor(db: Db, ids: string[]): Promise<CostMap> {
  if (!ids.length) return new Map();
  const { data } = await db.from("assignment_costs").select("assignment_id,cost_amount,currency").in("assignment_id", ids);
  return new Map((data ?? []).map((r) => [r.assignment_id as string, { amount: r.cost_amount as number | null, currency: r.currency as string }]));
}
