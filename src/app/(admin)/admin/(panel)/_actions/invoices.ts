"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertStaff, can } from "@/lib/auth";
import { createSessionClient, errMessage, str } from "@/lib/admin";
import { countryName, withQuote } from "@/lib/cases";
import { addDays, LINE_ARCHES, PRICE_CATEGORIES, round2, type InvoiceLine } from "@/lib/invoices";
import type { ActionResult } from "@/components/admin/ActionForm";

function fail(e: unknown): ActionResult {
  return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CUR = /^[A-Z]{3}$/;
const num = (v: FormDataEntryValue | null, fallback = 0) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
};

// ---- Invoices ----------------------------------------------------------------------

/** Creates a draft invoice pre-filled from the case and the billing defaults, then opens the editor. */
export async function createInvoice(caseId: string, _: ActionResult, _fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.finance);
    if (!UUID.test(caseId)) return { ok: false, message: "Unknown case." };
    const db = await createSessionClient();
    const [{ data: c }, { data: billing }] = await Promise.all([
      db.from("cases").select("id,agent_id,clinic_name,doctor_name,city,country_code,doctor_phone,doctor_email,case_finance(quote_currency)").eq("id", caseId).maybeSingle(),
      db.from("case_billing_settings").select("*").eq("id", 1).maybeSingle(),
    ]);
    if (!c) return { ok: false, message: "Unknown case." };
    const { data: agent } = await db.from("profiles").select("full_name,email,organization,phone").eq("id", c.agent_id).maybeSingle();
    const billTo = [
      `${c.clinic_name} — ${c.doctor_name}`,
      [c.city, countryName(c.country_code)].filter(Boolean).join(", "),
      [c.doctor_phone, c.doctor_email].filter(Boolean).join(" · "),
      agent ? `Via agent: ${agent.full_name || agent.email}${agent.organization ? ` (${agent.organization})` : ""}` : "",
    ].filter(Boolean).join("\n");
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await db.from("case_invoices").insert({
      case_id: caseId,
      currency: withQuote(c).quote_currency ?? billing?.default_currency ?? "USD",
      issue_date: today,
      due_date: addDays(today, billing?.due_days ?? 14),
      bill_to: billTo.slice(0, 600),
      tax_label: billing?.tax_label ?? "VAT",
      tax_rate: billing?.tax_rate ?? 0,
      notes: billing?.terms ?? null,
    }).select("id").single();
    if (error) return { ok: false, message: errMessage(error) };
    return { ok: true, message: "Draft invoice created.", redirectTo: `/admin/cases/${caseId}/invoices/${data.id}` };
  } catch (e) { return fail(e); }
}

function parseLines(raw: string): InvoiceLine[] | string {
  let list: unknown;
  try { list = JSON.parse(raw || "[]"); } catch { return "The invoice lines could not be read."; }
  if (!Array.isArray(list)) return "The invoice lines could not be read.";
  const out: InvoiceLine[] = [];
  for (const [i, l] of (list as Record<string, unknown>[]).entries()) {
    const description = String(l.description ?? "").trim().slice(0, 300);
    const qty = round2(Number(l.qty));
    const unit_price = round2(Number(l.unit_price));
    if (!description && !qty && !unit_price) continue; // empty row
    if (!description) return `Line ${i + 1}: enter a description.`;
    if (!(qty > 0)) return `Line ${i + 1}: quantity must be more than 0.`;
    if (!(unit_price >= 0)) return `Line ${i + 1}: enter a valid unit price.`;
    const arch = String(l.arch ?? "");
    out.push({
      price_item_id: typeof l.price_item_id === "string" && UUID.test(l.price_item_id) ? l.price_item_id : null,
      code: String(l.code ?? "").trim().slice(0, 24) || null,
      description,
      description_ar: String(l.description_ar ?? "").trim().slice(0, 300) || null,
      arch: arch in LINE_ARCHES ? arch : null,
      unit: String(l.unit ?? "").trim().slice(0, 40) || null,
      qty, unit_price,
    });
  }
  if (out.length > 60) return "An invoice can have at most 60 lines.";
  return out;
}

/** Saves a draft (fields + lines). With intent=issue it is then issued and locked. */
export async function saveInvoice(invoiceId: string, prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const result = await saveInvoiceInner(invoiceId, prev, fd);
  // Issued: navigate on the server (the editor unmounts as soon as the invoice is locked).
  if (result?.ok && result.redirectTo) redirect(result.redirectTo);
  return result;
}

async function saveInvoiceInner(invoiceId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.finance);
    const db = await createSessionClient();
    const { data: inv } = await db.from("case_invoices").select("id,case_id,status,total,invoice_no").eq("id", invoiceId).maybeSingle();
    if (!inv) return { ok: false, message: "Invoice not found." };
    if (inv.status === "void") return { ok: false, message: "A voided invoice cannot be changed." };
    const revising = inv.status === "issued";
    const oldTotal = Number(inv.total);
    const lines = parseLines(String(fd.get("lines") ?? "[]"));
    if (typeof lines === "string") return { ok: false, message: lines };
    if (revising && !lines.length) return { ok: false, message: "An issued invoice needs at least one line. To cancel it, void it instead." };
    const currency = (str(fd, "currency", 3) ?? "").toUpperCase();
    if (!CUR.test(currency)) return { ok: false, message: "Enter a 3-letter currency code (e.g. USD, EUR, EGP)." };
    const issue = str(fd, "issue_date", 10);
    const due = str(fd, "due_date", 10);
    const discount = round2(Math.max(0, num(fd.get("discount_amount"))));
    const taxRate = round2(Math.min(100, Math.max(0, num(fd.get("tax_rate")))));
    const { error } = await db.from("case_invoices").update({
      currency,
      issue_date: issue && DATE.test(issue) ? issue : new Date().toISOString().slice(0, 10),
      due_date: due && DATE.test(due) ? due : null,
      bill_to: str(fd, "bill_to", 600),
      discount_amount: discount,
      tax_label: str(fd, "tax_label", 30) ?? "VAT",
      tax_rate: taxRate,
      notes: str(fd, "notes", 1500),
    }).eq("id", invoiceId);
    if (error) return { ok: false, message: errMessage(error) };
    // replace the lines
    const del = await db.from("case_invoice_items").delete().eq("invoice_id", invoiceId);
    if (del.error) return { ok: false, message: errMessage(del.error) };
    if (lines.length) {
      const ins = await db.from("case_invoice_items").insert(lines.map((l, i) => ({ ...l, invoice_id: invoiceId, sort_order: i + 1 })));
      if (ins.error) return { ok: false, message: errMessage(ins.error) };
    }
    revalidatePath(`/admin/cases/${inv.case_id}`);
    if (revising) {
      const { data: rev, error: rErr } = await db.rpc("log_invoice_revision", { p_invoice: invoiceId, p_old_total: oldTotal, p_note: str(fd, "revision_note", 300) });
      if (rErr) return { ok: false, message: `Changes saved, but the revision could not be logged: ${errMessage(rErr)}` };
      const { data: now } = await db.from("case_invoices").select("total,currency").eq("id", invoiceId).single();
      return {
        ok: true,
        message: `Invoice ${inv.invoice_no} updated — revision ${rev}. Total ${oldTotal.toFixed(2)} → ${Number(now?.total ?? 0).toFixed(2)} ${now?.currency ?? ""}.`,
        redirectTo: `/admin/cases/${inv.case_id}/invoices/${invoiceId}?revised=${rev}&was=${oldTotal.toFixed(2)}`,
      };
    }
    if (fd.get("intent") === "issue") {
      if (!lines.length) return { ok: false, message: "Draft saved. Add at least one line before issuing." };
      const { data: issued, error: iErr } = await db.from("case_invoices").update({ status: "issued" }).eq("id", invoiceId).select("invoice_no,total,currency").single();
      if (iErr) return { ok: false, message: `Draft saved, but it could not be issued: ${errMessage(iErr)}` };
      return { ok: true, message: `Invoice ${issued.invoice_no} issued.`, redirectTo: `/admin/cases/${inv.case_id}/invoices/${invoiceId}?issued=1` };
    }
    return { ok: true, message: "Draft saved." };
  } catch (e) { return fail(e); }
}

export async function deleteInvoice(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.finance);
    const db = await createSessionClient();
    const id = String(fd.get("id"));
    const { data: inv } = await db.from("case_invoices").select("case_id,status").eq("id", id).maybeSingle();
    if (!inv) return { ok: false, message: "Invoice not found." };
    const { error } = await db.from("case_invoices").delete().eq("id", id);
    if (error) return { ok: false, message: errMessage(error) };
    return { ok: true, message: "Draft deleted.", redirectTo: `/admin/cases/${inv.case_id}` };
  } catch (e) { return fail(e); }
}

export async function voidInvoice(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.finance);
    const db = await createSessionClient();
    const id = String(fd.get("id"));
    const reason = str(fd, "reason", 300);
    if (!reason) return { ok: false, message: "Write the reason for voiding." };
    const { data, error } = await db.from("case_invoices").update({ status: "void", void_reason: reason }).eq("id", id).select("invoice_no,case_id").single();
    if (error) return { ok: false, message: errMessage(error) };
    revalidatePath(`/admin/cases/${data.case_id}`);
    return { ok: true, message: `Invoice ${data.invoice_no} voided. Create a new invoice if needed.` };
  } catch (e) { return fail(e); }
}

// ---- Price list --------------------------------------------------------------------

export async function savePriceItem(id: string | null, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.finance);
    const db = await createSessionClient();
    const code = (str(fd, "code", 24) ?? "").toUpperCase().replace(/\s+/g, "-");
    const category = String(fd.get("category") ?? "other");
    const currency = (str(fd, "currency", 3) ?? "USD").toUpperCase();
    const row = {
      code,
      category: category in PRICE_CATEGORIES ? category : "other",
      name_en: str(fd, "name_en", 160),
      name_ar: str(fd, "name_ar", 160),
      unit_en: str(fd, "unit_en", 40) ?? "piece",
      unit_ar: str(fd, "unit_ar", 40),
      unit_price: round2(Math.max(0, num(fd.get("unit_price")))),
      currency,
      active: fd.get("active") === "on",
      sort_order: Math.round(num(fd.get("sort_order"), 0)),
    };
    if (!/^[A-Z0-9][A-Z0-9-]{1,23}$/.test(code)) return { ok: false, message: "Code: 2–24 capital letters, digits or dashes (e.g. ALN-FULL)." };
    if (!row.name_en) return { ok: false, message: "Enter the English name." };
    if (!CUR.test(currency)) return { ok: false, message: "Enter a 3-letter currency code." };
    const { error } = id
      ? await db.from("case_price_items").update({ ...row, updated_at: new Date().toISOString() }).eq("id", id)
      : await db.from("case_price_items").insert(row);
    if (error) return { ok: false, message: error.code === "23505" ? `The code ${code} is already used.` : errMessage(error) };
    revalidatePath("/admin/price-list");
    return { ok: true, message: id ? "Item saved." : `Item ${code} added.` };
  } catch (e) { return fail(e); }
}

export async function saveBillingSettings(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.finance);
    const db = await createSessionClient();
    const currency = (str(fd, "default_currency", 3) ?? "USD").toUpperCase();
    if (!CUR.test(currency)) return { ok: false, message: "Enter a 3-letter currency code." };
    const { error } = await db.from("case_billing_settings").update({
      default_currency: currency,
      tax_label: str(fd, "tax_label", 30) ?? "VAT",
      tax_rate: round2(Math.min(100, Math.max(0, num(fd.get("tax_rate"))))),
      due_days: Math.min(365, Math.max(0, Math.round(num(fd.get("due_days"), 14)))),
      tax_number: str(fd, "tax_number", 60),
      bank_details: str(fd, "bank_details", 1000),
      terms: str(fd, "terms", 1000),
      updated_at: new Date().toISOString(),
    }).eq("id", 1);
    if (error) return { ok: false, message: errMessage(error) };
    return { ok: true, message: "Billing details saved. They print on every invoice." };
  } catch (e) { return fail(e); }
}
