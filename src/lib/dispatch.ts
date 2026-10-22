export const DISPATCH_STATUS: Record<string, { en: string; ar: string; tone: string }> = {
  draft: { en: "Draft — being prepared", ar: "مسودة", tone: "draft" },
  sent: { en: "Sent to finance — awaiting pricing", ar: "مرسل للمالية — بانتظار التسعير", tone: "changes" },
  invoiced: { en: "Priced & invoiced", ar: "تم التسعير والفوترة", tone: "published" },
  cancelled: { en: "Cancelled", ar: "ملغى", tone: "archived" },
};
export interface CatalogItem { id: string; code: string; category: string; name_en: string; name_ar: string | null; unit_en: string; unit_ar: string | null }
export interface DispatchLine { price_item_id: string | null; code: string | null; description: string; description_ar: string | null; arch: string | null; unit: string | null; qty: number }
