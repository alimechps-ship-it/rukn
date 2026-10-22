"use server";

import { revalidatePath } from "next/cache";
import { assertStaff, can } from "@/lib/auth";
import { createSessionClient, errMessage, str } from "@/lib/admin";
import type { ActionResult } from "@/components/admin/ActionForm";
import { refreshAutoRates } from "@/lib/fx";

const IN_CATS = ["owner_deposit", "advance_return", "other_income"];
const OUT_CATS = ["withdrawal", "advance", "salary", "lab", "planning", "supplies", "shipping", "rent", "utilities", "marketing", "fees", "other"];
const KINDS = ["cash", "bank", "wallet"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function fail(e: unknown): ActionResult {
  return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." };
}
const amountOf = (v: FormDataEntryValue | null) => {
  const n = Math.round(Number(String(v ?? "").replace(/,/g, "")) * 100) / 100;
  return Number.isFinite(n) ? n : NaN;
};
const dateOf = (fd: FormData, k: string) => {
  const d = str(fd, k, 10);
  return d && DATE.test(d) ? d : new Date().toISOString().slice(0, 10);
};
function party(fd: FormData) {
  const u = String(fd.get("party_user") ?? "");
  return { party_user: UUID.test(u) ? u : null, party_name: UUID.test(u) ? null : str(fd, "party_name", 120) };
}
const refresh = () => { revalidatePath("/admin/finance/cash"); revalidatePath("/admin/finance/people"); };

export async function saveCashAccount(id: string | null, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.finance);
    const db = await createSessionClient();
    const name = str(fd, "name", 80);
    const kind = String(fd.get("kind") ?? "cash");
    const currency = (str(fd, "currency", 3) ?? "EGP").toUpperCase();
    const custodian = String(fd.get("custodian") ?? "");
    if (!name) return { ok: false, message: "Enter the name of the cash box." };
    if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, message: "Enter a 3-letter currency code (EGP, USD, EUR…)." };
    const row = {
      name, kind: KINDS.includes(kind) ? kind : "cash", currency,
      custodian: UUID.test(custodian) ? custodian : null,
      notes: str(fd, "notes", 500),
      active: id ? fd.get("active") === "on" : true,
      sort_order: Math.round(Number(fd.get("sort_order") ?? 0)) || 0,
      ...(fd.has("opening_balance") ? { opening_balance: Math.max(0, amountOf(fd.get("opening_balance")) || 0) } : {}),
    };
    const { error } = id ? await db.from("cash_accounts").update(row).eq("id", id) : await db.from("cash_accounts").insert(row);
    if (error) return { ok: false, message: error.code === "23505" ? "A cash box with this name already exists." : errMessage(error) };
    refresh();
    return { ok: true, message: id ? "Cash box saved." : `Cash box “${name}” created.` };
  } catch (e) { return fail(e); }
}

/** Receipt voucher (money in) or payment voucher (money out). */
export async function addCashEntry(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.finance);
    const db = await createSessionClient();
    const direction = fd.get("direction") === "in" ? "in" : "out";
    const account = String(fd.get("account_id") ?? "");
    const amount = amountOf(fd.get("amount"));
    const category = String(fd.get("category") ?? "");
    if (!UUID.test(account)) return { ok: false, message: "Choose the cash box." };
    if (!(amount > 0)) return { ok: false, message: "Enter the amount." };
    if (!(direction === "in" ? IN_CATS : OUT_CATS).includes(category)) return { ok: false, message: "Choose the type." };
    const p = party(fd);
    if ((category === "advance" || category === "withdrawal" || category === "advance_return") && !p.party_user && !p.party_name) {
      return { ok: false, message: "Choose or type the person who took / returned the money." };
    }
    const { data, error } = await db.from("cash_entries").insert({
      account_id: account, direction, amount, currency: "XXX", entry_date: dateOf(fd, "entry_date"), category, ...p,
      description: str(fd, "description", 500), reference: str(fd, "reference", 120),
    }).select("id,entry_no").single();
    if (error) return { ok: false, message: errMessage(error) };
    refresh();
    return { ok: true, message: `${direction === "in" ? "Receipt" : "Payment"} voucher ${data.entry_no} recorded. Print it from the list below.` };
  } catch (e) { return fail(e); }
}

export async function updateCashEntry(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.finance);
    const db = await createSessionClient();
    const { data: cur } = await db.from("cash_entries").select("direction,category,case_payment_id,transfer_group,voided").eq("id", id).maybeSingle();
    if (!cur) return { ok: false, message: "Voucher not found." };
    if (cur.voided) return { ok: false, message: "A voided voucher cannot be changed." };
    const linked = Boolean(cur.case_payment_id || cur.transfer_group);
    const p = party(fd);
    const patch: Record<string, unknown> = { description: str(fd, "description", 500), reference: str(fd, "reference", 120), ...p };
    if (!linked) {
      const amount = amountOf(fd.get("amount"));
      const category = String(fd.get("category") ?? cur.category);
      if (!(amount > 0)) return { ok: false, message: "Enter the amount." };
      if (!(cur.direction === "in" ? IN_CATS : OUT_CATS).includes(category)) return { ok: false, message: "Choose the type." };
      Object.assign(patch, { amount, category, entry_date: dateOf(fd, "entry_date") });
    }
    const { error } = await db.from("cash_entries").update(patch).eq("id", id);
    if (error) return { ok: false, message: errMessage(error) };
    refresh();
    return { ok: true, message: linked ? "Voucher details saved (amount and date follow the linked payment / transfer)." : "Voucher updated." };
  } catch (e) { return fail(e); }
}

export async function voidCashEntry(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.finance);
    const db = await createSessionClient();
    const id = String(fd.get("id"));
    const reason = str(fd, "reason", 300);
    if (!reason) return { ok: false, message: "Write the reason for voiding." };
    const { data: e } = await db.from("cash_entries").select("case_payment_id,entry_no").eq("id", id).maybeSingle();
    if (!e) return { ok: false, message: "Voucher not found." };
    if (e.case_payment_id) return { ok: false, message: "This voucher comes from a case payment — void the payment receipt on the case instead." };
    const { error } = await db.from("cash_entries").update({ voided: true, void_reason: reason }).eq("id", id);
    if (error) return { ok: false, message: errMessage(error) };
    refresh();
    return { ok: true, message: `Voucher ${e.entry_no} voided.` };
  } catch (e) { return fail(e); }
}

export async function transferCash(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.finance);
    const db = await createSessionClient();
    const from = String(fd.get("from") ?? "");
    const to = String(fd.get("to") ?? "");
    const amount = amountOf(fd.get("amount"));
    const amountTo = amountOf(fd.get("amount_to"));
    const rate = Number(String(fd.get("rate") ?? "").replace(/,/g, ""));
    if (!UUID.test(from) || !UUID.test(to)) return { ok: false, message: "Choose both cash boxes." };
    if (!(amount > 0)) return { ok: false, message: "Enter the amount." };
    // The form sends the rate it shows; the received amount only when the user typed it himself.
    // Both only count when they were made for exactly these two boxes' currencies.
    const { data: boxes } = await db.from("cash_accounts").select("id,currency").in("id", [from, to]);
    const cFrom = boxes?.find((x) => x.id === from)?.currency; const cTo = boxes?.find((x) => x.id === to)?.currency;
    const sameDir = cFrom && cTo && fd.get("rate_from") === cFrom && fd.get("rate_to") === cTo;
    if (cFrom && cTo && cFrom !== cTo && (fd.get("rate") || fd.get("to_edited") === "1") && !sameDir) {
      return { ok: false, message: "The boxes changed while the rate was shown — check the rate and send again." };
    }
    const typedTo = fd.get("to_edited") === "1" && amountTo > 0;
    const { error } = await db.rpc("cash_transfer", {
      p_from: from, p_to: to, p_amount: amount, p_amount_to: typedTo ? amountTo : null,
      p_date: dateOf(fd, "entry_date"), p_description: str(fd, "description", 500),
      p_rate: !typedTo && rate > 0 && Number.isFinite(rate) ? rate : null,
    });
    if (error) return { ok: false, message: errMessage(error) };
    refresh();
    return { ok: true, message: "Transfer recorded." };
  } catch (e) { return fail(e); }
}

// ---------------------------------------------------------------------------------
// Exchange rates
// ---------------------------------------------------------------------------------
const refreshFx = () => { revalidatePath("/admin/finance/rates"); revalidatePath("/admin/finance/cash"); };

/** Finance: set a currency's rate by hand ("1 USD = x"), optionally locking it against the automatic update. */
export async function saveRate(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.finance);
    const db = await createSessionClient();
    const currency = (str(fd, "currency", 3) ?? "").toUpperCase();
    const perUsd = Number(String(fd.get("per_usd") ?? "").replace(/,/g, ""));
    if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, message: "Enter a 3-letter currency code." };
    if (currency === "USD") return { ok: false, message: "USD is the reference currency (always 1)." };
    if (!(perUsd > 0) || !Number.isFinite(perUsd)) return { ok: false, message: "Enter how many units equal 1 USD." };
    const locked = fd.get("locked") === "on";
    const { error } = await db.from("exchange_rates").upsert({ currency, per_usd: perUsd, source: "manual", locked });
    if (error) return { ok: false, message: errMessage(error) };
    refreshFx();
    return { ok: true, message: `Rate saved: 1 USD = ${perUsd} ${currency}${locked ? " (locked — the automatic update will not change it)" : ""}.` };
  } catch (e) { return fail(e); }
}

/** Finance: let the automatic update manage a currency again (unlock). */
export async function unlockRate(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.finance);
    const db = await createSessionClient();
    const currency = String(fd.get("currency") ?? "").toUpperCase();
    const { error } = await db.from("exchange_rates").update({ locked: false }).eq("currency", currency);
    if (error) return { ok: false, message: errMessage(error) };
    const r = await refreshAutoRates(db);
    refreshFx();
    return { ok: true, message: `${currency} follows the automatic rate again${r.error ? ` — ${r.error}` : ""}.` };
  } catch (e) { return fail(e); }
}

export async function deleteRate(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.finance);
    const db = await createSessionClient();
    const currency = String(fd.get("currency") ?? "").toUpperCase();
    const { error } = await db.from("exchange_rates").delete().eq("currency", currency);
    if (error) return { ok: false, message: errMessage(error) };
    refreshFx();
    return { ok: true, message: `${currency} removed from the rates.` };
  } catch (e) { return fail(e); }
}

/** Finance: pull the latest rates from the internet now. */
export async function updateRatesNow(_: ActionResult, _fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.finance);
    const db = await createSessionClient();
    const r = await refreshAutoRates(db);
    refreshFx();
    if (r.error) return { ok: false, message: r.error };
    return { ok: true, message: `Rates updated automatically (${r.updated} currenc${r.updated === 1 ? "y" : "ies"})${r.at ? ` · source time ${r.at}` : ""}.` };
  } catch (e) { return fail(e); }
}
