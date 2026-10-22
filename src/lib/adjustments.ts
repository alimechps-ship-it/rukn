import "server-only";
import type { Db } from "./admin";

export const ADJ_KINDS: Record<string, { en: string; ar: string; party: "agent" | "partner" | "any"; effect?: "increase" | "decrease"; hint: string }> = {
  discount_allowed: { en: "Discount allowed", ar: "خصم مسموح به", party: "agent", effect: "decrease", hint: "A discount RUKN gives an agent / clinic — reduces what he owes." },
  discount_earned: { en: "Discount earned", ar: "خصم مكتسب", party: "partner", effect: "decrease", hint: "A discount a lab / clinic gives RUKN — reduces what RUKN owes them." },
  extra_charge: { en: "Extra charge (other services)", ar: "إضافة مقابل خدمات أخرى", party: "any", effect: "increase", hint: "Agent: adds to what he owes (shipping, extra aligners…). Partner: adds to what RUKN owes them." },
  fx_difference: { en: "Currency difference", ar: "فروق عملة", party: "any", hint: "Difference between the rate on the document and the rate actually paid / received." },
  other: { en: "Other adjustment", ar: "تسوية أخرى", party: "any", hint: "Any other correction of a balance." },
  offset: { en: "Offset between accounts", ar: "تقاص بين حسابين", party: "any", hint: "" },
};

/** Plain words for the effect on each kind of account. */
export const EFFECT_LABEL = {
  agent: { increase: { en: "increases what the agent owes", ar: "يزيد المستحق على المندوب" }, decrease: { en: "reduces what the agent owes", ar: "ينقص المستحق على المندوب" } },
  partner: { increase: { en: "increases what RUKN owes them", ar: "يزيد المستحق للشريك" }, decrease: { en: "reduces what RUKN owes them", ar: "ينقص المستحق للشريك" } },
} as const;

export interface Adjustment {
  id: string; adj_no: string; party_type: "agent" | "partner"; agent_id: string | null; partner_id: string | null; kind: string; effect: "increase" | "decrease";
  amount: number; currency: string; adj_date: string; case_id: string | null; invoice_id: string | null; bill_id: string | null; offset_group: string | null;
  fx_rate: number | null; description: string | null; reference: string | null; voided: boolean; void_reason: string | null; created_by: string | null; created_at: string;
}

/** Signed effect on the party's balance (+ increase, − decrease). */
export const signed = (a: Pick<Adjustment, "effect" | "amount">) => (a.effect === "increase" ? 1 : -1) * Number(a.amount);

/**
 * Net reduction of documents' balances from adjustments linked to them
 * (discounts, offsets…): balance = total − payments − credit.
 */
export async function docCredits(db: Db, by: { invoiceIds?: string[]; billIds?: string[] }): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const run = async (col: "invoice_id" | "bill_id", ids?: string[]) => {
    if (!ids?.length) return;
    const { data } = await db.from("account_adjustments").select(`${col},effect,amount`).in(col, ids).eq("voided", false);
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
      const k = r[col] as string;
      out.set(k, Math.round(((out.get(k) ?? 0) - signed(r as unknown as Adjustment)) * 100) / 100);
    }
  };
  await Promise.all([run("invoice_id", by.invoiceIds), run("bill_id", by.billIds)]);
  return out;
}
