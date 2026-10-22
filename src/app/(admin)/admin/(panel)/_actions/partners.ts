"use server";

import { revalidatePath } from "next/cache";
import { assertStaff, can } from "@/lib/auth";
import { createSessionClient, errMessage, json, str } from "@/lib/admin";
import { PAYMENT_METHODS } from "@/lib/cases";
import type { ActionResult } from "@/components/admin/ActionForm";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function fail(e: unknown): ActionResult {
  return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." };
}
const money = (v: FormDataEntryValue | null) => {
  const n = Math.round(Number(String(v ?? "").replace(/,/g, "")) * 100) / 100;
  return Number.isFinite(n) ? n : NaN;
};
const dateOf = (fd: FormData, k: string) => { const d = str(fd, k, 10); return d && DATE.test(d) ? d : null; };
const refresh = () => { revalidatePath("/admin/partners", "layout"); revalidatePath("/admin/work", "layout"); revalidatePath("/admin/partner-bills"); };

// ---- Partners ---------------------------------------------------------------------
export async function savePartner(id: string | null, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.caseStaff);
    const db = await createSessionClient();
    const kind = fd.get("kind") === "lab" ? "lab" : "planner";
    const currency = (str(fd, "currency", 3) ?? "USD").toUpperCase();
    const row = {
      ...(id ? {} : { kind }),
      name: str(fd, "name", 120), contact_name: str(fd, "contact_name", 120), phone: str(fd, "phone", 40), email: str(fd, "email", 200),
      country: str(fd, "country", 80), city: str(fd, "city", 80), address: str(fd, "address", 300), currency,
      tax_number: str(fd, "tax_number", 60), bank_details: str(fd, "bank_details", 1000), notes: str(fd, "notes", 1000),
      ...(id ? { active: fd.get("active") === "on" } : {}),
    };
    if (!row.name) return { ok: false, message: "Enter the name of the clinic / lab." };
    if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, message: "Enter a 3-letter currency code." };
    const res = id ? await db.from("partners").update(row).eq("id", id).select("id").single() : await db.from("partners").insert(row).select("id").single();
    if (res.error) return { ok: false, message: res.error.code === "23505" ? "A partner with this name already exists." : errMessage(res.error) };
    refresh();
    return id ? { ok: true, message: "Partner saved." } : { ok: true, message: "Partner added.", redirectTo: `/admin/partners/${res.data.id}` };
  } catch (e) { return fail(e); }
}

// ---- Work orders ------------------------------------------------------------------
export async function createWorkOrder(caseId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.caseStaff);
    const db = await createSessionClient();
    const partnerId = String(fd.get("partner_id") ?? "");
    if (!UUID.test(partnerId)) return { ok: false, message: "Choose the planner or lab." };
    const { data: p } = await db.from("partners").select("kind,currency").eq("id", partnerId).maybeSingle();
    if (!p) return { ok: false, message: "Partner not found." };
    const cost = str(fd, "cost_amount", 20) ? money(fd.get("cost_amount")) : null;
    if (cost !== null && !(cost >= 0)) return { ok: false, message: "Enter a valid agreed cost." };
    const items = json<{ title?: string; text?: string }[]>(fd, "items", []).map((i) => ({ title: String(i.title ?? "").trim().slice(0, 200), text: String(i.text ?? "").trim().slice(0, 200) })).filter((i) => i.title).slice(0, 40);
    const { data, error } = await db.from("case_assignments").insert({
      case_id: caseId, partner_id: partnerId, kind: p.kind === "lab" ? "production" : "planning",
      title: str(fd, "title", 200), instructions: str(fd, "instructions", 4000), items, due_date: dateOf(fd, "due_date"),
      cost_amount: cost, currency: (str(fd, "currency", 3) ?? p.currency).toUpperCase(),
    }).select("id,order_no").single();
    if (error) return { ok: false, message: errMessage(error) };
    refresh(); revalidatePath(`/admin/cases/${caseId}`);
    return { ok: true, message: `Work order ${data.order_no} sent.` };
  } catch (e) { return fail(e); }
}

export async function updateWorkOrder(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.caseStaff);
    const db = await createSessionClient();
    const cost = str(fd, "cost_amount", 20) ? money(fd.get("cost_amount")) : null;
    if (cost !== null && !(cost >= 0)) return { ok: false, message: "Enter a valid agreed cost." };
    const items = json<{ title?: string; text?: string }[]>(fd, "items", []).map((i) => ({ title: String(i.title ?? "").trim().slice(0, 200), text: String(i.text ?? "").trim().slice(0, 200) })).filter((i) => i.title).slice(0, 40);
    const { error } = await db.from("case_assignments").update({
      title: str(fd, "title", 200), instructions: str(fd, "instructions", 4000), items, due_date: dateOf(fd, "due_date"),
      cost_amount: cost, currency: (str(fd, "currency", 3) ?? "USD").toUpperCase(),
    }).eq("id", id);
    if (error) return { ok: false, message: errMessage(error) };
    refresh();
    return { ok: true, message: "Work order updated." };
  } catch (e) { return fail(e); }
}

/** RUKN: mark received / completed / cancelled (with an optional note). */
export async function setWorkOrderStatus(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const user = await assertStaff(can.caseStaff);
    const db = await createSessionClient();
    const status = String(fd.get("status") ?? "");
    if (!["received", "completed", "cancelled", "assigned"].includes(status)) return { ok: false, message: "Invalid status." };
    const { error } = await db.from("case_assignments").update({ status }).eq("id", id);
    if (error) return { ok: false, message: errMessage(error) };
    const note = str(fd, "note", 1000);
    if (note) await db.from("assignment_events").insert({ assignment_id: id, kind: "comment", body: note, author_id: user.id });
    refresh();
    return { ok: true, message: "Work order updated." };
  } catch (e) { return fail(e); }
}

/** Partner: accept / decline / start / complete / ship. */
export async function partnerWorkAction(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.partner);
    const db = await createSessionClient();
    const action = String(fd.get("action") ?? "");
    const { data, error } = await db.rpc("partner_work_action", {
      p_id: id, p_action: action, p_note: str(fd, "note", 1000), p_carrier: str(fd, "carrier", 80), p_tracking: str(fd, "tracking_no", 120),
    });
    if (error) return { ok: false, message: errMessage(error) };
    refresh();
    return { ok: true, message: `Work order is now: ${String(data).replace("_", " ")}.` };
  } catch (e) { return fail(e); }
}

export async function addWorkMessage(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const user = await assertStaff((u) => can.caseStaff(u) || can.partner(u));
    const db = await createSessionClient();
    const body = str(fd, "body", 4000);
    if (!body) return { ok: false, message: "Write a message first." };
    const { error } = await db.from("assignment_events").insert({ assignment_id: id, kind: "comment", body, author_id: user.id });
    if (error) return { ok: false, message: errMessage(error) };
    refresh();
    return { ok: true, message: "Message sent." };
  } catch (e) { return fail(e); }
}

/** RUKN sends a partner file (e.g. the treatment plan) to the agent. */
export async function sendFileToAgent(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.caseStaff);
    const db = await createSessionClient();
    const { data, error } = await db.from("case_files").update({ is_deliverable: true }).eq("id", String(fd.get("id"))).select("case_id,filename").single();
    if (error) return { ok: false, message: errMessage(error) };
    revalidatePath(`/admin/cases/${data.case_id}`); refresh();
    return { ok: true, message: `${data.filename} is now visible to the agent.` };
  } catch (e) { return fail(e); }
}

// ---- Bills ------------------------------------------------------------------------
/** Partner (own) or RUKN (for a partner) records a bill: selected completed work orders + extra lines. */
export async function createPartnerBill(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const user = await assertStaff((u) => can.caseStaff(u) || can.partner(u));
    const db = await createSessionClient();
    const staff = can.caseStaff(user);
    let partnerId = String(fd.get("partner_id") ?? "");
    if (!staff) {
      const { data: me } = await db.from("profiles").select("partner_id").eq("id", user.id).single();
      partnerId = me?.partner_id ?? "";
    }
    if (!UUID.test(partnerId)) return { ok: false, message: "Choose the partner." };
    const { data: partner } = await db.from("partners").select("currency").eq("id", partnerId).maybeSingle();
    if (!partner) return { ok: false, message: "Partner not found." };
    const woIds = fd.getAll("wo").map(String).filter((x) => UUID.test(x));
    const { data: wos } = woIds.length ? await db.from("case_assignments").select("id,order_no,title,cost_amount,currency,case_id").in("id", woIds) : { data: [] };
    const extra = json<{ title?: string; text?: string }[]>(fd, "extra", []).map((l) => ({ description: String(l.title ?? "").trim().slice(0, 300), amount: money(l.text ?? "") })).filter((l) => l.description && l.amount > 0);
    if (!(wos ?? []).length && !extra.length) return { ok: false, message: "Select at least one completed work order or add a line." };
    const wrongCur = (wos ?? []).find((w) => w.currency !== partner.currency);
    if (wrongCur) return { ok: false, message: `Work order ${wrongCur.order_no} is in ${wrongCur.currency}; bill it separately.` };
    const { data: bill, error } = await db.from("partner_bills").insert({
      partner_id: partnerId, partner_ref: str(fd, "partner_ref", 60), bill_date: dateOf(fd, "bill_date") ?? undefined, due_date: dateOf(fd, "due_date"),
      currency: partner.currency, notes: str(fd, "notes", 1000),
    }).select("id,bill_no").single();
    if (error) return { ok: false, message: errMessage(error) };
    const caseIds = [...new Set((wos ?? []).map((w) => w.case_id as string))];
    const { data: codes } = staff && caseIds.length ? await db.from("cases").select("id,code").in("id", caseIds) : { data: [] };
    const codeOf = new Map((codes ?? []).map((c) => [c.id as string, c.code as string]));
    const lines = [
      ...(wos ?? []).map((w) => ({ bill_id: bill.id, assignment_id: w.id, description: `${w.order_no} — ${w.title}${codeOf.get(w.case_id) ? ` (${codeOf.get(w.case_id)})` : ""}`.slice(0, 300), qty: 1, unit_price: Number(w.cost_amount ?? 0) })),
      ...extra.map((l) => ({ bill_id: bill.id, assignment_id: null, description: l.description, qty: 1, unit_price: l.amount })),
    ];
    const ins = await db.from("partner_bill_lines").insert(lines);
    if (ins.error) { await db.from("partner_bills").delete().eq("id", bill.id); return { ok: false, message: errMessage(ins.error) }; }
    refresh();
    return { ok: true, message: `Bill ${bill.bill_no} ${staff ? "recorded" : "sent to RUKN for review"}.` };
  } catch (e) { return fail(e); }
}

export async function deletePartnerBill(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff((u) => can.caseStaff(u) || can.partner(u));
    const db = await createSessionClient();
    const { error, count } = await db.from("partner_bills").delete({ count: "exact" }).eq("id", String(fd.get("id")));
    if (error) return { ok: false, message: errMessage(error) };
    if (!count) return { ok: false, message: "Only bills awaiting review can be withdrawn." };
    refresh();
    return { ok: true, message: "Bill withdrawn." };
  } catch (e) { return fail(e); }
}

export async function reviewPartnerBill(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.caseStaff);
    const db = await createSessionClient();
    const decision = fd.get("decision") === "reject" ? "reject" : "approve";
    const { error } = await db.rpc("review_partner_bill", { p_bill: String(fd.get("id")), p_decision: decision, p_note: str(fd, "note", 300) });
    if (error) return { ok: false, message: errMessage(error) };
    refresh();
    return { ok: true, message: decision === "approve" ? "Bill approved — it is now payable." : "Bill rejected — the partner sees your reason." };
  } catch (e) { return fail(e); }
}

export async function voidPartnerBill(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.caseStaff);
    const db = await createSessionClient();
    const { error } = await db.from("partner_bills").update({ status: "void", review_note: str(fd, "reason", 300) ?? "Voided" }).eq("id", String(fd.get("id")));
    if (error) return { ok: false, message: errMessage(error) };
    refresh();
    return { ok: true, message: "Bill voided." };
  } catch (e) { return fail(e); }
}

// ---- Payments to partners -----------------------------------------------------------
export async function payPartner(partnerId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.caseStaff);
    const db = await createSessionClient();
    const amount = money(fd.get("amount"));
    if (!(amount > 0)) return { ok: false, message: "Enter the amount paid." };
    const method = String(fd.get("method") ?? "bank_transfer");
    const bill = String(fd.get("bill_id") ?? "");
    const box = String(fd.get("cash_account_id") ?? "");
    const { data: partner } = await db.from("partners").select("currency").eq("id", partnerId).single();
    const { data, error } = await db.from("partner_payments").insert({
      partner_id: partnerId, bill_id: UUID.test(bill) ? bill : null, amount, currency: (str(fd, "currency", 3) ?? partner?.currency ?? "USD").toUpperCase(),
      paid_at: dateOf(fd, "paid_at") ?? undefined, method: method in PAYMENT_METHODS ? method : "other",
      reference: str(fd, "reference", 120), notes: str(fd, "notes", 500), cash_account_id: UUID.test(box) ? box : null,
    }).select("payment_no").single();
    if (error) return { ok: false, message: errMessage(error) };
    refresh(); revalidatePath("/admin/finance/cash");
    return { ok: true, message: `Payment ${data.payment_no} recorded${UUID.test(box) ? " and paid out of the cash box" : ""}.` };
  } catch (e) { return fail(e); }
}

export async function voidPartnerPayment(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.caseStaff);
    const db = await createSessionClient();
    const { error } = await db.from("partner_payments").update({ voided: true, void_reason: str(fd, "reason", 300) ?? "Voided" }).eq("id", String(fd.get("id")));
    if (error) return { ok: false, message: errMessage(error) };
    refresh(); revalidatePath("/admin/finance/cash");
    return { ok: true, message: "Payment voided (its cash voucher too)." };
  } catch (e) { return fail(e); }
}
