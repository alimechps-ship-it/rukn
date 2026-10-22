"use server";

import { assertStaff, can } from "@/lib/auth";
import { createSessionClient, errMessage, json, str } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase/service";
import { ALL_STATUSES, ARCHES, COUNTRIES, FILE_CATEGORIES, FILE_EXTENSIONS, MAX_FILE_BYTES, PAYMENT_METHODS, SEXES, type CaseStatus } from "@/lib/cases";
import type { ActionResult } from "@/components/admin/ActionForm";

function fail(e: unknown): ActionResult {
  return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function caseFields(fd: FormData) {
  const country = String(fd.get("country_code") ?? "");
  const age = str(fd, "patient_age", 3);
  const email = str(fd, "doctor_email", 200);
  const sex = String(fd.get("patient_sex") ?? "");
  const arches = String(fd.get("arches") ?? "");
  const due = str(fd, "due_date", 10);
  const row = {
    clinic_name: str(fd, "clinic_name", 160),
    doctor_name: str(fd, "doctor_name", 120),
    doctor_phone: str(fd, "doctor_phone", 40),
    doctor_email: email,
    country_code: COUNTRIES.some(([c]) => c === country) ? country : null,
    city: str(fd, "city", 80),
    patient_ref: str(fd, "patient_ref", 60),
    patient_age: age && /^\d{1,3}$/.test(age) ? Number(age) : null,
    patient_sex: sex in SEXES ? sex : null,
    arches: arches in ARCHES ? arches : null,
    description: str(fd, "description", 4000),
    priority: fd.get("priority") === "urgent" ? "urgent" : "normal",
    due_date: due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
  };
  const missing = [
    !row.clinic_name && "clinic", !row.doctor_name && "treating doctor", !row.country_code && "country", !row.patient_ref && "patient reference",
  ].filter(Boolean);
  if (missing.length) return { error: `Please fill in: ${missing.join(", ")}.` } as const;
  if (email && !EMAIL.test(email)) return { error: "The doctor's e-mail address is not valid." } as const;
  return { row } as const;
}

async function serviceLabel(db: Awaited<ReturnType<typeof createSessionClient>>, serviceId: string | null) {
  if (!serviceId || !UUID.test(serviceId)) return { service_id: null, service_label: null };
  const { data } = await db.from("service_translations").select("nav_title,title").eq("service_id", serviceId).eq("locale", "en").eq("variant", "published").maybeSingle();
  return { service_id: serviceId, service_label: data?.nav_title ?? data?.title ?? null };
}

async function notifyNewCase(code: string, id: string, country: string, service: string | null) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFICATION_FROM_EMAIL;
  const svc = createServiceClient();
  if (!apiKey || !from || !svc) return;
  const { data: cfg } = await svc.from("private_settings").select("notifications_enabled,notification_emails").eq("id", 1).maybeSingle();
  if (!cfg?.notifications_enabled || !cfg.notification_emails?.length) return;
  const site = (process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "")).replace(/\/$/, "");
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: cfg.notification_emails, subject: `New case ${code} — RUKN`,
      text: `A new case was submitted by an agent.\nCase: ${code}\nService: ${service ?? "—"}\nCountry: ${country}\n\n${site ? `${site}/admin/cases/${id}` : ""}`,
    }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
export async function createCase(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const user = await assertStaff(can.cases);
    const db = await createSessionClient();
    const f = caseFields(fd);
    if ("error" in f) return { ok: false, message: f.error! };
    let agentId = user.id;
    if (can.caseStaff(user)) {
      const chosen = String(fd.get("agent_id") ?? "");
      if (!UUID.test(chosen)) return { ok: false, message: "Choose the agent this case belongs to." };
      agentId = chosen;
    }
    const svc = await serviceLabel(db, str(fd, "service_id"));
    const { data, error } = await db.from("cases").insert({ ...f.row, ...svc, agent_id: agentId, code: "pending" }).select("id,code").single();
    if (error) return { ok: false, message: errMessage(error, "The case could not be created") };
    await notifyNewCase(data.code, data.id, f.row.country_code!, svc.service_label);
    return { ok: true, message: `Case ${data.code} created. Now upload the records.`, redirectTo: `/admin/cases/${data.id}?created=1` };
  } catch (e) { return fail(e); }
}

export async function updateCaseInfo(caseId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const user = await assertStaff(can.cases);
    const db = await createSessionClient();
    const f = caseFields(fd);
    if ("error" in f) return { ok: false, message: f.error! };
    const svc = await serviceLabel(db, str(fd, "service_id"));
    const patch: Record<string, unknown> = { ...f.row, ...svc };
    if (can.caseStaff(user)) {
      const agent = String(fd.get("agent_id") ?? "");
      if (UUID.test(agent)) patch.agent_id = agent;
      const assigned = String(fd.get("assigned_to") ?? "");
      patch.assigned_to = UUID.test(assigned) ? assigned : null;
    }
    const { data, error } = await db.from("cases").update(patch).eq("id", caseId).select("id");
    if (error) return { ok: false, message: errMessage(error) };
    if (!data?.length) return { ok: false, message: "Case not found or not permitted." };
    return { ok: true, message: "Case details saved." };
  } catch (e) { return fail(e); }
}

export async function changeCaseStatus(caseId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const user = await assertStaff(can.caseStaff);
    const db = await createSessionClient();
    const status = String(fd.get("status")) as CaseStatus;
    if (!ALL_STATUSES.includes(status)) return { ok: false, message: "Invalid status." };
    const { error } = await db.from("cases").update({ status }).eq("id", caseId);
    if (error) return { ok: false, message: errMessage(error) };
    const comment = str(fd, "comment", 4000);
    if (comment) {
      const kind = fd.get("visibility") === "internal" ? "internal" : "comment";
      await db.from("case_events").insert({ case_id: caseId, kind, body: comment, author_id: user.id });
    }
    return { ok: true, message: "Status updated." };
  } catch (e) { return fail(e); }
}

export async function addCaseComment(caseId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const user = await assertStaff(can.cases);
    const db = await createSessionClient();
    const body = str(fd, "body", 4000);
    if (!body) return { ok: false, message: "Write a message first." };
    const kind = can.caseStaff(user) && fd.get("visibility") === "internal" ? "internal" : "comment";
    const { error } = await db.from("case_events").insert({ case_id: caseId, kind, body, author_id: user.id });
    if (error) return { ok: false, message: errMessage(error) };
    return { ok: true, message: kind === "internal" ? "Internal note added (not visible to the agent)." : "Message added to the case timeline." };
  } catch (e) { return fail(e); }
}

export async function registerIntake(caseId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.caseStaff);
    const db = await createSessionClient();
    const items = json<{ title?: string; text?: string }[]>(fd, "items", [])
      .map((i) => ({ title: String(i.title ?? "").trim().slice(0, 200), text: String(i.text ?? "").trim().slice(0, 200) }))
      .filter((i) => i.title)
      .slice(0, 30);
    if (!items.length) return { ok: false, message: "List at least one item that was received." };
    const date = str(fd, "received_at", 16);
    const { data: current } = await db.from("cases").select("status").eq("id", caseId).single();
    const patch: Record<string, unknown> = {
      intake_items: items, intake_notes: str(fd, "notes", 1000),
      intake_received_at: date ? new Date(date).toISOString() : new Date().toISOString(),
    };
    if (current?.status === "submitted") patch.status = "records_received";
    const { error } = await db.from("cases").update(patch).eq("id", caseId);
    if (error) return { ok: false, message: errMessage(error) };
    return { ok: true, message: "Records intake saved. You can now print the records receipt." };
  } catch (e) { return fail(e); }
}

export async function saveQuote(caseId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.caseStaff);
    const db = await createSessionClient();
    const amountRaw = str(fd, "quote_amount", 20);
    const currency = (str(fd, "quote_currency", 3) ?? "").toUpperCase();
    const amount = amountRaw ? Number(amountRaw) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return { ok: false, message: "Enter a valid amount." };
    if (amount !== null && !/^[A-Z]{3}$/.test(currency)) return { ok: false, message: "Enter a 3-letter currency code (USD, EUR, EGP…)." };
    const { error } = await db.from("cases").update({ quote_amount: amount, quote_currency: amount === null ? null : currency }).eq("id", caseId);
    if (error) return { ok: false, message: errMessage(error) };
    return { ok: true, message: "Quotation saved." };
  } catch (e) { return fail(e); }
}

export async function addPayment(caseId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.caseStaff);
    const db = await createSessionClient();
    const amount = Number(str(fd, "amount", 20));
    let currency = (str(fd, "currency", 3) ?? "").toUpperCase();
    const invoiceId = String(fd.get("invoice_id") ?? "");
    let invoice_id: string | null = null;
    if (UUID.test(invoiceId)) {
      const { data: inv } = await db.from("case_invoices").select("id,currency,status").eq("id", invoiceId).eq("case_id", caseId).maybeSingle();
      if (!inv || inv.status !== "issued") return { ok: false, message: "Choose an issued invoice of this case." };
      invoice_id = inv.id; currency = inv.currency; // the receipt always uses the invoice currency
    }
    const method = String(fd.get("method"));
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: "Enter the amount received." };
    if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, message: "Enter a 3-letter currency code." };
    if (!(method in PAYMENT_METHODS)) return { ok: false, message: "Choose the payment method." };
    const paid = str(fd, "paid_at", 10);
    const { data, error } = await db.from("case_payments").insert({
      case_id: caseId, amount, currency, method, invoice_id,
      cash_account_id: UUID.test(String(fd.get("cash_account_id") ?? "")) ? String(fd.get("cash_account_id")) : null,
      reference: str(fd, "reference", 120), notes: str(fd, "notes", 500),
      paid_at: paid && /^\d{4}-\d{2}-\d{2}$/.test(paid) ? paid : undefined, receipt_no: "pending",
    }).select("receipt_no").single();
    if (error) return { ok: false, message: errMessage(error) };
    return { ok: true, message: `Payment recorded — receipt ${data.receipt_no}${fd.get("cash_account_id") ? " (deposited in the cash box)" : ""}.` };
  } catch (e) { return fail(e); }
}

export async function voidPayment(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.caseStaff);
    const db = await createSessionClient();
    const reason = str(fd, "reason", 300) ?? "Voided";
    const { error } = await db.from("case_payments").update({ voided: true, void_reason: reason }).eq("id", String(fd.get("id")));
    if (error) return { ok: false, message: errMessage(error) };
    return { ok: true, message: "Receipt voided. It stays on record and prints with a VOID mark." };
  } catch (e) { return fail(e); }
}

export async function saveShipment(caseId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.caseStaff);
    const db = await createSessionClient();
    const shipped = str(fd, "shipped_at", 16);
    const patch: Record<string, unknown> = {
      carrier: str(fd, "carrier", 80), tracking_no: str(fd, "tracking_no", 120),
      shipped_at: shipped ? new Date(shipped).toISOString() : new Date().toISOString(),
    };
    if (fd.get("mark_shipped") === "on") patch.status = "shipped";
    const { error } = await db.from("cases").update(patch).eq("id", caseId);
    if (error) return { ok: false, message: errMessage(error) };
    return { ok: true, message: "Shipment saved." };
  } catch (e) { return fail(e); }
}

export async function markDelivered(caseId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.caseStaff);
    const db = await createSessionClient();
    const receiver = str(fd, "received_by_name", 120);
    if (!receiver) return { ok: false, message: "Enter the name of the person who received the delivery." };
    const when = str(fd, "delivered_at", 16);
    const { error } = await db.from("cases").update({
      status: "delivered", received_by_name: receiver, delivery_notes: str(fd, "delivery_notes", 1000),
      delivered_at: when ? new Date(when).toISOString() : new Date().toISOString(),
    }).eq("id", caseId);
    if (error) return { ok: false, message: errMessage(error) };
    return { ok: true, message: "Delivery recorded. The delivery note is ready to print." };
  } catch (e) { return fail(e); }
}

export async function decidePlan(caseId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.cases);
    const db = await createSessionClient();
    const decision = fd.get("decision") === "approve" ? "approve" : "revision";
    const { error } = await db.rpc("decide_case_plan", {
      p_case: caseId, p_decision: decision, p_doctor: str(fd, "doctor", 120) ?? "", p_comment: str(fd, "comment", 1000) ?? "",
    });
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: decision === "approve" ? "Plan approval recorded. Production can start." : "Revision request sent to RUKN." };
  } catch (e) { return fail(e); }
}

/** Called after the browser uploaded a file straight to the private bucket. */
export async function registerCaseFile(input: { caseId: string; path: string; filename: string; size: number; mime: string; category: string; deliverable: boolean }) {
  try {
    await assertStaff(can.files);
    const db = await createSessionClient();
    const ext = input.filename.split(".").pop()?.toLowerCase() ?? "";
    if (!FILE_EXTENSIONS.includes(ext)) return { ok: false, message: `File type .${ext} is not accepted.` };
    if (input.size > MAX_FILE_BYTES) return { ok: false, message: "File is larger than 50 MB." };
    if (!input.path.startsWith(`${input.caseId}/`)) return { ok: false, message: "Invalid upload path." };
    const { data: row, error } = await db.from("case_files").insert({
      case_id: input.caseId, storage_path: input.path, filename: input.filename.slice(0, 200), size_bytes: input.size,
      mime_type: input.mime.slice(0, 120) || null, category: input.category in FILE_CATEGORIES ? input.category : "other",
      is_deliverable: input.deliverable,
    }).select("id").single();
    if (error) {
      await db.storage.from("case-files").remove([input.path]);
      return { ok: false, message: errMessage(error, "The file could not be registered") };
    }
    return { ok: true, message: "Uploaded.", fileId: row.id as string };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." };
  }
}

export async function deleteCaseFile(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.cases);
    const db = await createSessionClient();
    const id = String(fd.get("id"));
    const { data: f } = await db.from("case_files").select("storage_path").eq("id", id).maybeSingle();
    if (!f) return { ok: false, message: "File not found." };
    const { data, error } = await db.from("case_files").delete().eq("id", id).select("id");
    if (error) return { ok: false, message: errMessage(error) };
    if (!data?.length) return { ok: false, message: "This file can no longer be deleted (the case is already being processed)." };
    await db.storage.from("case-files").remove([f.storage_path]);
    return { ok: true, message: "File deleted." };
  } catch (e) { return fail(e); }
}
