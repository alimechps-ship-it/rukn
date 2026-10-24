"use server";

import { revalidatePath } from "next/cache";
import { assertStaff, can } from "@/lib/auth";
import { createSessionClient, errMessage, str } from "@/lib/admin";
import type { ActionResult } from "@/components/admin/ActionForm";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const fail = (e: unknown): ActionResult => ({ ok: false, message: e instanceof Error ? e.message : "Unexpected error." });
const money = (v: FormDataEntryValue | null) => Math.round(Number(String(v ?? "").replace(/,/g, "")) * 100) / 100;
const dateOf = (fd: FormData, k: string) => { const d = str(fd, k, 10); return d && DATE.test(d) ? d : new Date().toISOString().slice(0, 10); };

/** "agent:<uuid>" | "partner:<uuid>" | "ledger:<uuid>" → columns of one side */
function side(prefix: "dr" | "cr", v: FormDataEntryValue | null, doc: FormDataEntryValue | null) {
  const [type, id] = String(v ?? "").split(":");
  if (!["agent", "partner", "ledger", "cash"].includes(type) || !UUID.test(id ?? "")) return null;
  const d = String(doc ?? "");
  return {
    [`${prefix}_type`]: type,
    [`${prefix}_agent_id`]: type === "agent" ? id : null,
    [`${prefix}_partner_id`]: type === "partner" ? id : null,
    [`${prefix}_ledger_id`]: type === "ledger" ? id : null,
    [`${prefix}_cash_id`]: type === "cash" ? id : null,
    [`${prefix}_invoice_id`]: type === "agent" && UUID.test(d) ? d : null,
    [`${prefix}_bill_id`]: type === "partner" && UUID.test(d) ? d : null,
  };
}
const refresh = () => {
  for (const p of ["/admin/finance/journal", "/admin/finance/accounts", "/admin/finance/cash", "/admin/statement", "/admin/finance/receivables", "/admin/partners", "/admin/partner-statement", "/admin/partner-bills"]) revalidatePath(p);
};

/** Simple journal entry: one debit account, one credit account, each in its own currency. */
export async function createJournal(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.finance);
    const db = await createSessionClient();
    const dr = side("dr", fd.get("dr"), fd.get("dr_doc"));
    const cr = side("cr", fd.get("cr"), fd.get("cr_doc"));
    if (!dr) return { ok: false, message: "Choose the debit account · اختر الحساب المدين." };
    if (!cr) return { ok: false, message: "Choose the credit account · اختر الحساب الدائن." };
    const amount = money(fd.get("dr_amount"));
    if (!(amount > 0)) return { ok: false, message: "Enter the amount." };
    const drCur = (str(fd, "dr_currency", 3) ?? "").toUpperCase();
    const crCur = (str(fd, "cr_currency", 3) ?? drCur).toUpperCase();
    if (!/^[A-Z]{3}$/.test(drCur) || !/^[A-Z]{3}$/.test(crCur)) return { ok: false, message: "Enter 3-letter currency codes." };
    const typedCr = fd.get("cr_edited") === "1" ? money(fd.get("cr_amount")) : 0;
    const rate = Number(String(fd.get("rate") ?? ""));
    const { data, error } = await db.from("journal_entries").insert({
      ...dr, ...cr, dr_amount: amount, dr_currency: drCur, cr_currency: crCur,
      cr_amount: drCur !== crCur && typedCr > 0 ? typedCr : null,
      fx_rate: drCur !== crCur && !(typedCr > 0) && rate > 0 && Number.isFinite(rate) ? rate : null,
      entry_date: dateOf(fd, "entry_date"), description: str(fd, "description", 500), reference: str(fd, "reference", 120),
    }).select("entry_no").single();
    if (error) return { ok: false, message: errMessage(error) };
    refresh();
    return { ok: true, message: `Journal entry ${data.entry_no} recorded · تم تسجيل القيد.` };
  } catch (e) { return fail(e); }
}

export async function voidJournal(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.finance);
    const db = await createSessionClient();
    const reason = str(fd, "reason", 300);
    if (!reason) return { ok: false, message: "Write the reason for voiding." };
    const { data, error } = await db.from("journal_entries").update({ voided: true, void_reason: reason }).eq("id", String(fd.get("id"))).select("entry_no").single();
    if (error) return { ok: false, message: errMessage(error) };
    refresh();
    return { ok: true, message: `Entry ${data.entry_no} voided.` };
  } catch (e) { return fail(e); }
}

/** Chart of accounts: add or rename / close a general ledger account. */
export async function saveLedgerAccount(id: string | null, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.finance);
    const db = await createSessionClient();
    const parent = String(fd.get("parent_id") ?? "");
    const row: Record<string, unknown> = {
      code: str(fd, "code", 12), name_en: str(fd, "name_en", 120), name_ar: str(fd, "name_ar", 120),
      kind: String(fd.get("kind") ?? "other"), active: id ? fd.get("active") === "on" : true,
      parent_id: UUID.test(parent) ? parent : null, is_group: fd.get("is_group") === "on",
    };
    if (row.parent_id && !fd.get("kind")) {
      const { data: p } = await db.from("ledger_accounts").select("kind").eq("id", row.parent_id as string).maybeSingle();
      if (p) row.kind = p.kind;
    }
    if (!row.code || !/^[0-9A-Za-z.-]{1,12}$/.test(row.code as string)) return { ok: false, message: "Enter an account code (digits / letters)." };
    if (!row.name_en) return { ok: false, message: "Enter the account name." };
    const { error } = id ? await db.from("ledger_accounts").update(row).eq("id", id) : await db.from("ledger_accounts").insert(row);
    if (error) return { ok: false, message: errMessage(error) };
    refresh();
    return { ok: true, message: id ? "Account saved." : `Account ${row.code} added.` };
  } catch (e) { return fail(e); }
}
