"use server";

import { revalidatePath } from "next/cache";
import { assertStaff, can } from "@/lib/auth";
import { createSessionClient, errMessage, str } from "@/lib/admin";
import type { ActionResult } from "@/components/admin/ActionForm";
import { ADJ_KINDS } from "@/lib/adjustments";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const fail = (e: unknown): ActionResult => ({ ok: false, message: e instanceof Error ? e.message : "Unexpected error." });
const money = (v: FormDataEntryValue | null) => Math.round(Number(String(v ?? "").replace(/,/g, "")) * 100) / 100;
const dateOf = (fd: FormData, k: string) => { const d = str(fd, k, 10); return d && DATE.test(d) ? d : new Date().toISOString().slice(0, 10); };

/** "agent:<uuid>" | "partner:<uuid>" → parts */
function account(v: FormDataEntryValue | null): { type: "agent" | "partner"; id: string } | null {
  const [type, id] = String(v ?? "").split(":");
  return (type === "agent" || type === "partner") && UUID.test(id ?? "") ? { type, id } : null;
}
const refresh = () => {
  for (const p of ["/admin/finance/adjustments", "/admin/statement", "/admin/finance/receivables", "/admin/partners", "/admin/partner-statement", "/admin/partner-bills"]) revalidatePath(p);
};

/** Discount allowed / earned, extra charge, currency difference, other. */
export async function createAdjustment(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.finance);
    const db = await createSessionClient();
    const kind = String(fd.get("kind") ?? "");
    const k = ADJ_KINDS[kind];
    if (!k || kind === "offset") return { ok: false, message: "Choose the type of adjustment." };
    const acc = account(fd.get("party"));
    if (!acc) return { ok: false, message: "Choose the agent or the lab / clinic." };
    if (k.party !== "any" && k.party !== acc.type) return { ok: false, message: kind === "discount_allowed" ? "A discount allowed is given to an agent." : "A discount earned comes from a lab / clinic." };
    const effect = k.effect ?? (fd.get("effect") === "increase" ? "increase" : fd.get("effect") === "decrease" ? "decrease" : null);
    if (!effect) return { ok: false, message: "Choose whether it increases or reduces the balance." };
    const amount = money(fd.get("amount"));
    if (!(amount > 0)) return { ok: false, message: "Enter the amount." };
    const currency = (str(fd, "currency", 3) ?? "").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, message: "Enter a 3-letter currency code." };
    const doc = String(fd.get("doc") ?? "");
    const { data, error } = await db.from("account_adjustments").insert({
      party_type: acc.type, agent_id: acc.type === "agent" ? acc.id : null, partner_id: acc.type === "partner" ? acc.id : null,
      kind, effect, amount, currency, adj_date: dateOf(fd, "adj_date"),
      invoice_id: acc.type === "agent" && UUID.test(doc) ? doc : null, bill_id: acc.type === "partner" && UUID.test(doc) ? doc : null,
      description: str(fd, "description", 500), reference: str(fd, "reference", 120),
    }).select("id,adj_no").single();
    if (error) return { ok: false, message: errMessage(error) };
    refresh();
    return { ok: true, message: `Adjustment ${data.adj_no} recorded (${k.en} · ${k.ar}). Print it from the list below.` };
  } catch (e) { return fail(e); }
}

/** Offset between two accounts (net or move), optionally across currencies. */
export async function createOffset(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.finance);
    const db = await createSessionClient();
    const a = account(fd.get("a_party"));
    const b = account(fd.get("b_party"));
    if (!a || !b) return { ok: false, message: "Choose both accounts." };
    const amount = money(fd.get("amount"));
    const currency = (str(fd, "currency", 3) ?? "").toUpperCase();
    const currencyB = (str(fd, "currency_b", 3) ?? currency).toUpperCase();
    if (!(amount > 0)) return { ok: false, message: "Enter the amount." };
    if (!/^[A-Z]{3}$/.test(currency) || !/^[A-Z]{3}$/.test(currencyB)) return { ok: false, message: "Enter 3-letter currency codes." };
    const typedB = fd.get("b_edited") === "1" ? money(fd.get("amount_b")) : 0;
    const rate = Number(String(fd.get("rate") ?? ""));
    const docA = String(fd.get("doc_a") ?? ""); const docB = String(fd.get("doc_b") ?? "");
    const { data: g, error } = await db.rpc("make_offset", {
      p_a_type: a.type, p_a_id: a.id, p_b_type: b.type, p_b_id: b.id, p_mode: fd.get("mode") === "move" ? "move" : "net",
      p_amount: amount, p_currency: currency, p_currency_b: currencyB, p_amount_b: typedB > 0 ? typedB : null,
      p_rate: currencyB !== currency && rate > 0 && Number.isFinite(rate) ? rate : null,
      p_date: dateOf(fd, "adj_date"), p_description: str(fd, "description", 500), p_reference: str(fd, "reference", 120),
      p_invoice_a: a.type === "agent" && UUID.test(docA) ? docA : null, p_bill_a: a.type === "partner" && UUID.test(docA) ? docA : null,
      p_invoice_b: b.type === "agent" && UUID.test(docB) ? docB : null, p_bill_b: b.type === "partner" && UUID.test(docB) ? docB : null,
    });
    if (error) return { ok: false, message: errMessage(error) };
    const { data: rows } = await db.from("account_adjustments").select("adj_no").eq("offset_group", g as string).order("adj_no");
    refresh();
    return { ok: true, message: `Offset recorded: ${(rows ?? []).map((r) => r.adj_no).join(" + ")}.` };
  } catch (e) { return fail(e); }
}

export async function voidAdjustment(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.finance);
    const db = await createSessionClient();
    const reason = str(fd, "reason", 300);
    if (!reason) return { ok: false, message: "Write the reason for voiding." };
    const { data, error } = await db.from("account_adjustments").update({ voided: true, void_reason: reason }).eq("id", String(fd.get("id"))).select("adj_no,offset_group").single();
    if (error) return { ok: false, message: errMessage(error) };
    refresh();
    return { ok: true, message: `Adjustment ${data.adj_no} voided${data.offset_group ? " (with the other side of the offset)" : ""}.` };
  } catch (e) { return fail(e); }
}
