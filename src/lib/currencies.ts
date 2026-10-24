/** ISO currency names (English · Arabic) for the currency drop-downs. */
export const CURRENCY_NAMES: Record<string, [string, string]> = {
  USD: ["US Dollar", "دولار أمريكي"], EGP: ["Egyptian Pound", "جنيه مصري"], EUR: ["Euro", "يورو"], GBP: ["British Pound", "جنيه إسترليني"],
  SAR: ["Saudi Riyal", "ريال سعودي"], AED: ["UAE Dirham", "درهم إماراتي"], KWD: ["Kuwaiti Dinar", "دينار كويتي"], QAR: ["Qatari Riyal", "ريال قطري"],
  BHD: ["Bahraini Dinar", "دينار بحريني"], OMR: ["Omani Rial", "ريال عماني"], JOD: ["Jordanian Dinar", "دينار أردني"], ILS: ["Israeli Shekel", "شيكل"],
  LBP: ["Lebanese Pound", "ليرة لبنانية"], SYP: ["Syrian Pound", "ليرة سورية"], IQD: ["Iraqi Dinar", "دينار عراقي"], YER: ["Yemeni Rial", "ريال يمني"],
  LYD: ["Libyan Dinar", "دينار ليبي"], TND: ["Tunisian Dinar", "دينار تونسي"], DZD: ["Algerian Dinar", "دينار جزائري"], MAD: ["Moroccan Dirham", "درهم مغربي"],
  SDG: ["Sudanese Pound", "جنيه سوداني"], TRY: ["Turkish Lira", "ليرة تركية"], CHF: ["Swiss Franc", "فرنك سويسري"], SEK: ["Swedish Krona", "كرونة سويدية"],
  NOK: ["Norwegian Krone", "كرونة نرويجية"], DKK: ["Danish Krone", "كرونة دنماركية"], PLN: ["Polish Zloty", "زلوتي بولندي"], CZK: ["Czech Koruna", "كرونة تشيكية"],
  HUF: ["Hungarian Forint", "فورنت مجري"], RON: ["Romanian Leu", "ليو روماني"], RUB: ["Russian Ruble", "روبل روسي"], UAH: ["Ukrainian Hryvnia", "هريفنيا أوكرانية"],
  CAD: ["Canadian Dollar", "دولار كندي"], AUD: ["Australian Dollar", "دولار أسترالي"], NZD: ["New Zealand Dollar", "دولار نيوزيلندي"], JPY: ["Japanese Yen", "ين ياباني"],
  CNY: ["Chinese Yuan", "يوان صيني"], HKD: ["Hong Kong Dollar", "دولار هونغ كونغ"], SGD: ["Singapore Dollar", "دولار سنغافوري"], KRW: ["South Korean Won", "وون كوري"],
  INR: ["Indian Rupee", "روبية هندية"], PKR: ["Pakistani Rupee", "روبية باكستانية"], BDT: ["Bangladeshi Taka", "تاكا بنغلاديشية"], IDR: ["Indonesian Rupiah", "روبية إندونيسية"],
  MYR: ["Malaysian Ringgit", "رينغيت ماليزي"], THB: ["Thai Baht", "بات تايلندي"], PHP: ["Philippine Peso", "بيسو فلبيني"], IRR: ["Iranian Rial", "ريال إيراني"],
  AZN: ["Azerbaijani Manat", "مانات أذربيجاني"], GEL: ["Georgian Lari", "لاري جورجي"], KZT: ["Kazakh Tenge", "تينغ كازاخستاني"], ZAR: ["South African Rand", "راند جنوب أفريقي"],
  NGN: ["Nigerian Naira", "نايرا نيجيرية"], KES: ["Kenyan Shilling", "شلن كيني"], ETB: ["Ethiopian Birr", "بير إثيوبي"], MXN: ["Mexican Peso", "بيسو مكسيكي"],
  BRL: ["Brazilian Real", "ريال برازيلي"], ARS: ["Argentine Peso", "بيسو أرجنتيني"], CLP: ["Chilean Peso", "بيسو تشيلي"], COP: ["Colombian Peso", "بيسو كولومبي"],
};

export const currencyLabel = (code: string, short = false) => {
  const n = CURRENCY_NAMES[code];
  if (!n) return code;
  return short ? `${code} · ${n[1]}` : `${code} — ${n[0]} · ${n[1]}`;
};

/** USD and EGP first, then alphabetical; duplicates and invalid codes removed. */
export function sortCurrencies(codes: Iterable<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const c of codes) { const u = (c ?? "").trim().toUpperCase(); if (/^[A-Z]{3}$/.test(u)) set.add(u); }
  const head = ["USD", "EGP"].filter((c) => set.has(c));
  return [...head, ...[...set].filter((c) => !head.includes(c)).sort()];
}
