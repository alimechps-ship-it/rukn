// Shared invoice helpers (server + client safe).

export const PRICE_CATEGORIES: Record<string, { en: string; ar: string }> = {
  aligner: { en: "Clear aligners", ar: "التقويم الشفاف" },
  snap_on: { en: "Snap-On", ar: "سناب أون" },
  retainer: { en: "Retainers", ar: "الريتينر" },
  planning: { en: "Digital planning", ar: "التخطيط الرقمي" },
  accessory: { en: "Accessories", ar: "ملحقات" },
  service: { en: "Services", ar: "خدمات" },
  other: { en: "Other", ar: "أخرى" },
};

export const INVOICE_STATUS: Record<string, { en: string; ar: string; tone: string }> = {
  draft: { en: "Draft", ar: "مسودة", tone: "draft" },
  issued: { en: "Issued", ar: "صادرة", tone: "published" },
  void: { en: "Void", ar: "ملغاة", tone: "closed" },
};

export const LINE_ARCHES: Record<string, { en: string; ar: string }> = {
  upper: { en: "Upper", ar: "علوي" },
  lower: { en: "Lower", ar: "سفلي" },
  both: { en: "Both", ar: "الفكان" },
};

export interface PriceItem {
  id: string; code: string; category: string; name_en: string; name_ar: string | null;
  unit_en: string; unit_ar: string | null; unit_price: number; currency: string; active: boolean; sort_order: number;
}

export interface InvoiceLine {
  price_item_id: string | null; code: string | null; description: string; description_ar: string | null;
  arch: string | null; unit: string | null; qty: number; unit_price: number;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Same arithmetic as public.recalc_case_invoice() — used for the live preview. */
export function invoiceTotals(lines: Pick<InvoiceLine, "qty" | "unit_price">[], discount: number, taxRate: number) {
  const subtotal = round2(lines.reduce((a, l) => a + round2((Number(l.qty) || 0) * (Number(l.unit_price) || 0)), 0));
  const disc = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  const net = round2(subtotal - disc);
  const tax = round2((net * (Number(taxRate) || 0)) / 100);
  return { subtotal, discount: disc, net, tax, total: round2(net + tax) };
}

export function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
