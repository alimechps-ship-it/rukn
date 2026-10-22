import "server-only";
import type { Db } from "./admin";

/** Free daily rates, no key needed. Overridable for tests. */
export const FX_API_URL = process.env.FX_API_URL || "https://open.er-api.com/v6/latest/USD";
/** Automatic rates older than this are refreshed when finance opens the cash / rates pages. */
export const FX_MAX_AGE_HOURS = 12;

export interface FxRate { currency: string; per_usd: number; source: "auto" | "manual"; locked: boolean; updated_at: string; updated_by: string | null }
export type FxMap = Map<string, number>;

export async function loadRates(db: Db): Promise<FxRate[]> {
  const { data } = await db.from("exchange_rates").select("*").order("currency");
  return ((data ?? []) as FxRate[]).map((r) => ({ ...r, per_usd: Number(r.per_usd) }));
}

export const ratesMap = (rates: FxRate[]): FxMap => new Map(rates.map((r) => [r.currency, r.per_usd]));

/** 1 unit of `from` = ? units of `to` (null when a rate is missing). */
export function cross(map: FxMap, from: string, to: string): number | null {
  if (from === to) return 1;
  const f = map.get(from); const t = map.get(to);
  return f && t ? t / f : null;
}

/** Sum of amounts in several currencies expressed in one currency (null if a rate is missing). */
export function totalIn(map: FxMap, amounts: Map<string, number>, to: string): number | null {
  let sum = 0;
  for (const [c, v] of amounts) {
    const r = cross(map, c, to);
    if (r === null) return null;
    sum += v * r;
  }
  return Math.round(sum * 100) / 100;
}

/**
 * Pulls the latest rates and updates every unlocked currency.
 * Returns how many currencies were updated, or an error message.
 */
export async function refreshAutoRates(db: Db, onlyIfStale = false): Promise<{ updated: number; at?: string; error?: string }> {
  const rates = await loadRates(db);
  const unlocked = rates.filter((r) => !r.locked && r.currency !== "USD");
  if (!unlocked.length) return { updated: 0 };
  if (onlyIfStale) {
    const oldest = Math.min(...unlocked.map((r) => (r.source === "auto" ? Date.parse(r.updated_at) : 0)));
    if (Date.now() - oldest < FX_MAX_AGE_HOURS * 3600_000) return { updated: 0 };
  }
  let json: { result?: string; rates?: Record<string, number>; time_last_update_utc?: string };
  try {
    const res = await fetch(FX_API_URL, { cache: "no-store", signal: AbortSignal.timeout(onlyIfStale ? 3500 : 8000) });
    if (!res.ok) return { updated: 0, error: `The rates service answered ${res.status}.` };
    json = await res.json();
  } catch {
    return { updated: 0, error: "The rates service could not be reached. The last saved rates are used." };
  }
  if (json.result && json.result !== "success") return { updated: 0, error: "The rates service returned an error." };
  const live = json.rates ?? {};
  let updated = 0;
  for (const r of unlocked) {
    const v = Number(live[r.currency]);
    if (!(v > 0)) continue;
    const { error } = await db.from("exchange_rates").update({ per_usd: v, source: "auto" }).eq("currency", r.currency);
    if (!error) updated++;
  }
  return { updated, at: json.time_last_update_utc };
}

export const fmtRate = (n: number | null) =>
  n === null ? "—" : n >= 100 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : n.toLocaleString("en-US", { maximumSignificantDigits: 5 });
