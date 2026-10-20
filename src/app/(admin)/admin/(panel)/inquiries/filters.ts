import type { Db } from "@/lib/admin";

export interface InquiryFilters { q?: string; status?: string; type?: string; service?: string; from?: string; to?: string; page?: string }
const STATUSES = ["new", "in_review", "contacted", "qualified", "converted", "closed"];
const TYPES = ["contact", "case", "partnership"];

/** Applies list filters (shared by the list page and the CSV export). */
export function applyFilters(db: Db, f: InquiryFilters, select: string) {
  let q = db.from("inquiries").select(select, { count: "exact" }).order("created_at", { ascending: false });
  if (f.status && STATUSES.includes(f.status)) q = q.eq("status", f.status);
  if (f.type && TYPES.includes(f.type)) q = q.eq("type", f.type);
  if (f.service) q = f.service === "none" ? q.is("service_id", null) : q.eq("service_id", f.service);
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) q = q.gte("created_at", `${f.from}T00:00:00Z`);
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) q = q.lte("created_at", `${f.to}T23:59:59Z`);
  if (f.q) {
    const term = f.q.replace(/[%_,()]/g, " ").trim().slice(0, 80);
    if (term) q = q.or(`name.ilike.%${term}%,email.ilike.%${term}%,organization.ilike.%${term}%,country.ilike.%${term}%`);
  }
  return q;
}
