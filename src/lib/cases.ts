/** Shared constants for the case-management module (server and client safe). */

export type CaseStatus =
  | "submitted" | "records_received" | "diagnosis" | "planning" | "awaiting_approval" | "revision" | "approved"
  | "production" | "quality_check" | "shipped" | "delivered" | "on_hold" | "cancelled";

export const STATUS: Record<CaseStatus, { en: string; ar: string; tone: string }> = {
  submitted: { en: "Submitted", ar: "مُرسلة", tone: "new" },
  records_received: { en: "Records received", ar: "تم استلام السجلات", tone: "contacted" },
  diagnosis: { en: "Digital diagnosis", ar: "التشخيص الرقمي", tone: "in_review" },
  planning: { en: "Treatment planning", ar: "التخطيط العلاجي", tone: "in_review" },
  awaiting_approval: { en: "Awaiting doctor approval", ar: "بانتظار اعتماد الطبيب", tone: "draft" },
  revision: { en: "Revision requested", ar: "مطلوب تعديل", tone: "changes" },
  approved: { en: "Plan approved", ar: "الخطة معتمدة", tone: "qualified" },
  production: { en: "In production", ar: "قيد التصنيع", tone: "in_review" },
  quality_check: { en: "Quality check", ar: "فحص الجودة", tone: "in_review" },
  shipped: { en: "Shipped", ar: "تم الشحن", tone: "contacted" },
  delivered: { en: "Delivered", ar: "تم التسليم", tone: "converted" },
  on_hold: { en: "On hold", ar: "معلّقة", tone: "archived" },
  cancelled: { en: "Cancelled", ar: "ملغاة", tone: "closed" },
};

/** Main path shown as a progress stepper. */
export const STEPS: CaseStatus[] = [
  "submitted", "records_received", "diagnosis", "planning", "awaiting_approval", "approved", "production", "quality_check", "shipped", "delivered",
];
export const ALL_STATUSES = Object.keys(STATUS) as CaseStatus[];

export const FILE_CATEGORIES: Record<string, { en: string; ar: string }> = {
  scan_upper: { en: "Upper scan", ar: "مسح الفك العلوي" },
  scan_lower: { en: "Lower scan", ar: "مسح الفك السفلي" },
  bite: { en: "Bite registration", ar: "تسجيل العضة" },
  photos: { en: "Photographs", ar: "صور فوتوغرافية" },
  xray: { en: "Radiographs", ar: "صور أشعة" },
  prescription: { en: "Prescription / form", ar: "وصفة / نموذج" },
  treatment_plan: { en: "Treatment plan", ar: "الخطة العلاجية" },
  other: { en: "Other", ar: "أخرى" },
};

export const FILE_EXTENSIONS = ["stl", "ply", "obj", "3mf", "zip", "pdf", "jpg", "jpeg", "png", "webp", "heic", "dcm", "mp4", "mov"];
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export const PAYMENT_METHODS: Record<string, { en: string; ar: string }> = {
  cash: { en: "Cash", ar: "نقدًا" },
  bank_transfer: { en: "Bank transfer", ar: "تحويل بنكي" },
  card: { en: "Card", ar: "بطاقة" },
  online: { en: "Online payment", ar: "دفع إلكتروني" },
  other: { en: "Other", ar: "أخرى" },
};

export const ARCHES: Record<string, { en: string; ar: string }> = {
  upper: { en: "Upper", ar: "علوي" },
  lower: { en: "Lower", ar: "سفلي" },
  both: { en: "Both arches", ar: "الفكان" },
  na: { en: "Not applicable", ar: "لا ينطبق" },
};

export const SEXES: Record<string, { en: string; ar: string }> = {
  female: { en: "Female", ar: "أنثى" },
  male: { en: "Male", ar: "ذكر" },
  unspecified: { en: "Not specified", ar: "غير محدد" },
};

export const INTAKE_PRESETS = [
  "Intraoral scan — upper (STL)", "Intraoral scan — lower (STL)", "Bite registration", "Impressions (physical)",
  "Plaster models", "Intraoral photographs", "Extraoral photographs", "Panoramic X-ray", "Cephalometric X-ray", "Prescription form",
];

export const COUNTRIES: [string, string][] = [
  ["EG", "Egypt"], ["SA", "Saudi Arabia"], ["AE", "United Arab Emirates"], ["KW", "Kuwait"], ["QA", "Qatar"], ["BH", "Bahrain"],
  ["OM", "Oman"], ["JO", "Jordan"], ["PS", "Palestine"], ["LB", "Lebanon"], ["IQ", "Iraq"], ["SY", "Syria"], ["YE", "Yemen"],
  ["LY", "Libya"], ["TN", "Tunisia"], ["DZ", "Algeria"], ["MA", "Morocco"], ["SD", "Sudan"], ["TR", "Türkiye"], ["DE", "Germany"],
  ["AT", "Austria"], ["CH", "Switzerland"], ["NL", "Netherlands"], ["BE", "Belgium"], ["FR", "France"], ["IT", "Italy"], ["ES", "Spain"],
  ["GB", "United Kingdom"], ["IE", "Ireland"], ["SE", "Sweden"], ["NO", "Norway"], ["DK", "Denmark"], ["PL", "Poland"], ["GR", "Greece"],
  ["US", "United States"], ["CA", "Canada"], ["BR", "Brazil"], ["MX", "Mexico"], ["IN", "India"], ["PK", "Pakistan"], ["MY", "Malaysia"],
  ["ID", "Indonesia"], ["AU", "Australia"], ["NG", "Nigeria"], ["KE", "Kenya"], ["ZA", "South Africa"], ["XX", "Other"],
];
export const countryName = (cc: string | null | undefined) => COUNTRIES.find(([c]) => c === cc)?.[1] ?? cc ?? "—";

export function fmtMoney(amount: number | string | null | undefined, currency: string | null | undefined) {
  if (amount === null || amount === undefined || !currency) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(amount));
  } catch {
    return `${Number(amount).toFixed(2)} ${currency}`;
  }
}

export function fmtDay(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Cairo" });
}
