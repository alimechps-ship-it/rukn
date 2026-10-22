"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkReceipt } from "@/lib/ai-receipt";
import { isAiConfigured } from "@/lib/ai";
import { assertStaff, can } from "@/lib/auth";
import { createSessionClient, errMessage, str } from "@/lib/admin";
import { PAYMENT_METHODS } from "@/lib/cases";
import type { ActionResult } from "@/components/admin/ActionForm";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(e: unknown): ActionResult {
  return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." };
}
const refresh = (caseId?: string) => {
  if (caseId) revalidatePath(`/admin/cases/${caseId}`);
  revalidatePath("/admin/finance/notices");
  revalidatePath("/admin/statement");
};

/** Agent (or staff) confirms the shipment or the treatment plan was received. */
export async function confirmReceipt(caseId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.cases);
    const db = await createSessionClient();
    const what = fd.get("what") === "plan" ? "plan" : "shipment";
    const { data, error } = await db.rpc("confirm_case_receipt", { p_case: caseId, p_what: what, p_name: str(fd, "name", 120), p_notes: str(fd, "notes", 1000) });
    if (error) return { ok: false, message: errMessage(error) };
    refresh(caseId);
    return { ok: true, message: what === "plan" ? "Thank you — the treatment plan is confirmed as received." : `Thank you — delivery confirmed. Delivery note ${data ?? ""} issued.` };
  } catch (e) { return fail(e); }
}

/** Agent sends a payment notice (after the optional proof file was uploaded by the browser). */
export async function submitPaymentNotice(input: {
  caseId: string; invoiceId: string | null; amount: number; currency: string; method: string; paidAt: string; reference: string; notes: string; proofFileId: string | null;
}): Promise<{ ok: boolean; message: string }> {
  try {
    const user = await assertStaff(can.cases);
    const db = await createSessionClient();
    const amount = Math.round(Number(input.amount) * 100) / 100;
    const currency = String(input.currency ?? "").trim().toUpperCase();
    if (!(amount > 0)) return { ok: false, message: "Enter the amount you paid." };
    if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, message: "Enter a 3-letter currency code (e.g. USD)." };
    if (!(input.method in PAYMENT_METHODS)) return { ok: false, message: "Choose how you paid." };
    const { data, error } = await db.from("case_payment_claims").insert({
      case_id: input.caseId,
      invoice_id: input.invoiceId && UUID.test(input.invoiceId) ? input.invoiceId : null,
      amount, currency, method: input.method,
      paid_at: /^\d{4}-\d{2}-\d{2}$/.test(input.paidAt) ? input.paidAt : undefined,
      reference: input.reference?.trim().slice(0, 120) || null,
      notes: input.notes?.trim().slice(0, 500) || null,
      proof_file_id: input.proofFileId && UUID.test(input.proofFileId) ? input.proofFileId : null,
    }).select("id,notice_no").single();
    if (error) return { ok: false, message: errMessage(error) };
    // Read the receipt with AI in the background (needs the server service key).
    const svc = createServiceClient();
    if (svc && isAiConfigured() && input.proofFileId) {
      after(async () => { await checkReceipt(svc, data.id as string, user.id).catch(() => undefined); });
    }
    refresh(input.caseId);
    return { ok: true, message: `Payment notice ${data.notice_no} sent. RUKN will confirm it after checking the transfer.` };
  } catch (e) { return fail(e) as { ok: boolean; message: string }; }
}

export async function cancelPaymentNotice(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.cases);
    const db = await createSessionClient();
    const { error } = await db.rpc("cancel_payment_claim", { p_claim: String(fd.get("id")) });
    if (error) return { ok: false, message: errMessage(error) };
    refresh(String(fd.get("case_id") ?? ""));
    return { ok: true, message: "Payment notice withdrawn." };
  } catch (e) { return fail(e); }
}

/** Case manager confirms the money arrived: receipt issued, optionally deposited into a cash box. */
export async function acceptPaymentNotice(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.finance);
    const db = await createSessionClient();
    const box = String(fd.get("cash_account_id") ?? "");
    const amount = Number(String(fd.get("amount") ?? "").replace(/,/g, ""));
    const { data, error } = await db.rpc("accept_payment_claim", {
      p_claim: String(fd.get("id")),
      p_cash_account: UUID.test(box) ? box : null,
      p_amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null,
      p_note: str(fd, "note", 300),
    });
    if (error) return { ok: false, message: errMessage(error) };
    refresh(String(fd.get("case_id") ?? ""));
    revalidatePath("/admin/finance/cash");
    return { ok: true, message: `Payment confirmed — receipt ${data}${UUID.test(box) ? " and deposited in the cash box" : ""}.` };
  } catch (e) { return fail(e); }
}

export async function rejectPaymentNotice(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.finance);
    const db = await createSessionClient();
    const { error } = await db.rpc("reject_payment_claim", { p_claim: String(fd.get("id")), p_reason: str(fd, "reason", 300) });
    if (error) return { ok: false, message: errMessage(error) };
    refresh(String(fd.get("case_id") ?? ""));
    return { ok: true, message: "Payment notice rejected — the agent sees your reason on the case." };
  } catch (e) { return fail(e); }
}

/** Case staff: (re)read the attached transfer receipt with AI. */
export async function recheckReceipt(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const user = await assertStaff(can.finance);
    const db = await createSessionClient();
    const res = await checkReceipt(db, String(fd.get("id")), user.id);
    refresh(String(fd.get("case_id") ?? ""));
    return { ok: res.ok, message: res.message };
  } catch (e) { return fail(e); }
}
