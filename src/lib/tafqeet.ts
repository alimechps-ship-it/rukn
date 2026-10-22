// Amount in words — English and Arabic (تفقيط) — for vouchers and receipts.

const EN_ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function enBelow1000(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${EN_ONES[h]} hundred`);
  if (r) parts.push(r < 20 ? EN_ONES[r] : `${EN_TENS[Math.floor(r / 10)]}${r % 10 ? `-${EN_ONES[r % 10]}` : ""}`);
  return parts.join(" and ");
}
export function enWords(n: number): string {
  if (n === 0) return "zero";
  const scales = ["", " thousand", " million", " billion"];
  const out: string[] = [];
  let i = 0;
  while (n > 0 && i < scales.length) {
    const chunk = n % 1000;
    if (chunk) out.unshift(enBelow1000(chunk) + scales[i]);
    n = Math.floor(n / 1000); i++;
  }
  return out.join(" ");
}

const AR_ONES = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const AR_TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const AR_HUNDREDS = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];
function arBelow1000(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(AR_HUNDREDS[h]);
  if (r) parts.push(r < 20 ? AR_ONES[r] : r % 10 ? `${AR_ONES[r % 10]} و${AR_TENS[Math.floor(r / 10)]}` : AR_TENS[Math.floor(r / 10)]);
  return parts.join(" و");
}
const AR_SCALES: [string, string, string][] = [
  ["ألف", "ألفان", "آلاف"],
  ["مليون", "مليونان", "ملايين"],
  ["مليار", "ملياران", "مليارات"],
];
function arScale(chunk: number, i: number) {
  const [one, two, many] = AR_SCALES[i];
  if (chunk === 1) return one;
  if (chunk === 2) return two;
  if (chunk >= 3 && chunk <= 10) return `${arBelow1000(chunk)} ${many}`;
  return `${arBelow1000(chunk)} ${one}`;
}
export function arWords(n: number): string {
  if (n === 0) return "صفر";
  const out: string[] = [];
  let i = -1;
  while (n > 0 && i < AR_SCALES.length) {
    const chunk = n % 1000;
    if (chunk) out.unshift(i < 0 ? arBelow1000(chunk) : arScale(chunk, i));
    n = Math.floor(n / 1000); i++;
  }
  return out.join(" و");
}

const CUR: Record<string, { en: [string, string]; ar: [string, string] }> = {
  EGP: { en: ["Egyptian pounds", "piasters"], ar: ["جنيه مصري", "قرش"] },
  USD: { en: ["US dollars", "cents"], ar: ["دولار أمريكي", "سنت"] },
  EUR: { en: ["euros", "cents"], ar: ["يورو", "سنت"] },
  SAR: { en: ["Saudi riyals", "halalas"], ar: ["ريال سعودي", "هللة"] },
  AED: { en: ["UAE dirhams", "fils"], ar: ["درهم إماراتي", "فلس"] },
  KWD: { en: ["Kuwaiti dinars", "fils"], ar: ["دينار كويتي", "فلس"] },
  JOD: { en: ["Jordanian dinars", "piasters"], ar: ["دينار أردني", "قرش"] },
  GBP: { en: ["pounds sterling", "pence"], ar: ["جنيه إسترليني", "بنس"] },
};

export function amountInWords(amount: number, currency: string) {
  const whole = Math.floor(Math.abs(amount) + 1e-9);
  const frac = Math.round((Math.abs(amount) - whole) * 100);
  const c = CUR[currency] ?? { en: [currency, "cents"], ar: [currency, "سنت"] };
  const en = `${enWords(whole)} ${c.en[0]}${frac ? ` and ${enWords(frac)} ${c.en[1]}` : ""} only`;
  const ar = `فقط ${arWords(whole)} ${c.ar[0]}${frac ? ` و${arWords(frac)} ${c.ar[1]}` : ""} لا غير`;
  return { en: en.charAt(0).toUpperCase() + en.slice(1), ar };
}
