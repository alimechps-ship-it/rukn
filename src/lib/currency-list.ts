import "server-only";
import { cache } from "react";
import { createSessionClient } from "./admin";
import { sortCurrencies } from "./currencies";

/** Currencies used by RUKN = those on the Exchange rates page (any signed-in user may read the codes). */
export const loadCurrencies = cache(async (): Promise<string[]> => {
  try {
    const db = await createSessionClient();
    const { data, error } = await db.rpc("currency_codes");
    if (!error && Array.isArray(data) && data.length) return sortCurrencies(data as string[]);
  } catch { /* fall back */ }
  return sortCurrencies(["USD", "EGP", "EUR", "SAR", "AED", "GBP"]);
});
