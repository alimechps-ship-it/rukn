"use server";

import { assertStaff, can } from "@/lib/auth";
import { createSessionClient, errMessage, str } from "@/lib/admin";
import type { ActionResult } from "@/components/admin/ActionForm";

const STATUSES = ["new", "in_review", "contacted", "qualified", "converted", "closed"];
function fail(e: unknown): ActionResult { return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." }; }

export async function updateInquiry(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.inquiries);
    const db = await createSessionClient();
    const status = String(fd.get("status"));
    if (!STATUSES.includes(status)) return { ok: false, message: "Invalid status." };
    const assigned = str(fd, "assigned_to");
    const { error } = await db.from("inquiries").update({ status, assigned_to: assigned && /^[0-9a-f-]{36}$/.test(assigned) ? assigned : null }).eq("id", id);
    if (error) return { ok: false, message: errMessage(error) };
    return { ok: true, message: "Inquiry updated." };
  } catch (e) { return fail(e); }
}

export async function addNote(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const user = await assertStaff(can.inquiries);
    const db = await createSessionClient();
    const body = str(fd, "body", 4000);
    if (!body) return { ok: false, message: "Write a note first." };
    const { error } = await db.from("inquiry_notes").insert({ inquiry_id: id, author_id: user.id, body });
    if (error) return { ok: false, message: errMessage(error) };
    return { ok: true, message: "Note added." };
  } catch (e) { return fail(e); }
}

export async function deleteNote(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.inquiries);
    const db = await createSessionClient();
    const { data, error } = await db.from("inquiry_notes").delete().eq("id", String(fd.get("id"))).select("id");
    if (error) return { ok: false, message: errMessage(error) };
    if (!data?.length) return { ok: false, message: "You can only delete your own notes." };
    return { ok: true, message: "Note deleted." };
  } catch (e) { return fail(e); }
}

export async function deleteInquiry(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.admin);
    const db = await createSessionClient();
    const { data, error } = await db.from("inquiries").delete().eq("id", String(fd.get("id"))).select("id");
    if (error) return { ok: false, message: errMessage(error) };
    if (!data?.length) return { ok: false, message: "Inquiry not found or not permitted." };
    return { ok: true, message: "Inquiry deleted permanently.", redirectTo: "/admin/inquiries" };
  } catch (e) { return fail(e); }
}
