/** Splits statement lines into one table per currency (each with its own opening balance and totals). */
export const CURRENCY_AR: Record<string, string> = {
  USD: "دولار أمريكي", EUR: "يورو", EGP: "جنيه مصري", SAR: "ريال سعودي", AED: "درهم إماراتي", JOD: "دينار أردني", KWD: "دينار كويتي",
  GBP: "جنيه إسترليني", QAR: "ريال قطري", OMR: "ريال عماني", BHD: "دينار بحريني", TRY: "ليرة تركية", LYD: "دينار ليبي", IQD: "دينار عراقي",
};

export function groupByCurrency<L extends { currency: string }>(lines: L[], opening: Map<string, number>) {
  const order: string[] = [];
  for (const c of [...opening.keys(), ...lines.map((l) => l.currency)]) if (!order.includes(c)) order.push(c);
  return order.sort().map((currency) => ({ currency, opening: opening.get(currency) ?? 0, lines: lines.filter((l) => l.currency === currency) }));
}
