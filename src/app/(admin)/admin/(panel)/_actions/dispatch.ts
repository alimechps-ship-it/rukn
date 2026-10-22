"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertStaff, can } from "@/lib/auth";
import { createSessionClient, errMessage, str } from "@/lib/admin";
import { LINE_ARCHES } from "@/lib/invoices";
import type { ActionResult } from "@/components/admin/ActionForm";
import type { DispatchLine } from "@/lib/dispatch";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(e: unknown): ActionResult {
  return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." };
}

/** Case manager: new draft dispatch order, then open its editor. */
export async function createDispatch(caseId: string, _: ActionResult, _fd: FormData): Promise<ActionResult> {
  let target = "";
  try {
    await assertStaff(can.ops);
    const db = await createSessionClient();
    const { data, error } = await db.from("case_dispatch_orders").insert({ case_id: caseId }).select("id").single();
    if (error) return { ok: false, message: errMessage(error) };
    target = `/admin/cases/${caseId}/dispatch/${data.id}`;
  } catch (e) { return fail(e); }
  redirect(target);
}

function parseLines(raw: string): DispatchLine[] | string {
  let list: unknown;
  try { list = JSON.parse(raw || "[]"); } catch { return "The services could not be read."; }
  if (!Array.isArray(list)) return "The services could not be read.";
  const out: DispatchLine[] = [];
  for (const [i, l] of (list as Record<string, unknown>[]).entries()) {
    const description = String(l.description ?? "").trim().slice(0, 300);
    const qty = Math.round(Number(l.qty) * 100) / 100;
    if (!description && !qty) continue;
    if (!description) return `Line ${i + 1}: choose or type the service.`;
    if (!(qty > 0)) return `Line ${i + 1}: quantity must be more than 0.`;
    const arch = String(l.arch ?? "");
    out.push({
      price_item_id: typeof l.price_item_id === "string" && UUID.test(l.price_item_id) ? l.price_item_id : null,
      code: String(l.code ?? "").trim().slice(0, 24) || null, description,
      description_ar: String(l.description_ar ?? "").trim().slice(0, 300) || null,
      arch: arch in LINE_ARCHES ? arch : null, unit: String(l.unit ?? "").trim().slice(0, 40) || null, qty,
    });
  }
  return out.length > 60 ? "At most 60 lines." : out;
}

/** Case manager: save the draft (services + quantities) and optionally send it to finance. */
export async function saveDispatch(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  let target = "";
  try {
    await assertStaff(can.ops);
    const db = await createSessionClient();
    const { data: d } = await db.from("case_dispatch_orders").select("id,case_id,status").eq("id", id).maybeSingle();
    if (!d) return { ok: false, message: "Dispatch order not found." };
    if (d.status !== "draft") return { ok: false, message: "Recall the order from finance before changing it." };
    const lines = parseLines(String(fd.get("lines") ?? "[]"));
    if (typeof lines === "string") return { ok: false, message: lines };
    const upd = await db.from("case_dispatch_orders").update({ notes: str(fd, "notes", 1500) }).eq("id", id);
    if (upd.error) return { ok: false, message: errMessage(upd.error) };
    const del = await db.from("case_dispatch_lines").delete().eq("dispatch_id", id);
    if (del.error) return { ok: false, message: errMessage(del.error) };
    if (lines.length) {
      const ins = await db.from("case_dispatch_lines").insert(lines.map((l, i) => ({ ...l, dispatch_id: id, sort_order: i + 1 })));
      if (ins.error) return { ok: false, message: errMessage(ins.error) };
    }
    revalidatePath(`/admin/cases/${d.case_id}`);
    if (fd.get("intent") === "send") {
      const { error } = await db.from("case_dispatch_orders").update({ status: "sent" }).eq("id", id);
      if (error) return { ok: false, message: errMessage(error) };
      revalidatePath("/admin/finance/to-price");
      // The editor disappears once the order is sent, so navigate from the server.
      target = `/admin/cases/${d.case_id}?sent=dispatch#dispatch`;
    } else return { ok: true, message: "Draft saved." };
  } catch (e) { return fail(e); }
  redirect(target);
}

/** Case manager: take a sent order back (before it is invoiced), or cancel a draft. */
export async function setDispatchStatus(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.ops);
    const db = await createSessionClient();
    const status = fd.get("status") === "cancelled" ? "cancelled" : "draft";
    const { data, error } = await db.from("case_dispatch_orders").update({ status }).eq("id", id).select("case_id").single();
    if (error) return { ok: false, message: errMessage(error) };
    revalidatePath(`/admin/cases/${data.case_id}`);
    return { ok: true, message: status === "draft" ? "Recalled — you can edit it again." : "Dispatch order cancelled." };
  } catch (e) { return fail(e); }
}

/** Finance: turn a sent dispatch order into a priced draft invoice and open it. */
export async function invoiceFromDispatch(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let target = "";
  try {
    await assertStaff(can.finance);
    const db = await createSessionClient();
    const id = String(fd.get("id"));
    const { data: d } = await db.from("case_dispatch_orders").select("case_id").eq("id", id).maybeSingle();
    if (!d) return { ok: false, message: "Dispatch order not found." };
    const { data, error } = await db.rpc("invoice_from_dispatch", { p_dispatch: id });
    if (error) return { ok: false, message: errMessage(error) };
    revalidatePath(`/admin/cases/${d.case_id}`); revalidatePath("/admin/finance/to-price");
    target = `/admin/cases/${d.case_id}/invoices/${data}`;
  } catch (e) { return fail(e); }
  redirect(target);
}
