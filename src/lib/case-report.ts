import "server-only";
import type { Db } from "./admin";
import { ALL_STATUSES, type CaseStatus } from "./cases";

export type ReportFilters = { status?: string; agent?: string; country?: string; from?: string; to?: string; open?: string; q?: string; service?: string };

export interface ReportRow {
  id: string; code: string; status: CaseStatus; priority: string; clinic_name: string; doctor_name: string; patient_ref: string;
  service_label: string | null; agent_id: string; country_code: string; created_at: string; delivered_at: string | null;
  quote_amount: number | null; quote_currency: string | null;
}

export async function loadReport(db: Db, f: ReportFilters, staff: boolean) {
  let q = db.from("cases").select("id,code,status,priority,clinic_name,doctor_name,patient_ref,service_label,agent_id,country_code,created_at,delivered_at,quote_amount,quote_currency").order("created_at", { ascending: false }).limit(5000);
  if (f.status && ALL_STATUSES.includes(f.status as CaseStatus)) q = q.eq("status", f.status);
  if (f.open === "1") q = q.not("status", "in", "(delivered,cancelled)");
  if (staff && f.agent && /^[0-9a-f-]{36}$/.test(f.agent)) q = q.eq("agent_id", f.agent);
  if (f.country && /^[A-Z]{2}$/.test(f.country)) q = q.eq("country_code", f.country);
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) q = q.gte("created_at", `${f.from}T00:00:00Z`);
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) q = q.lte("created_at", `${f.to}T23:59:59Z`);
  if (f.q) {
    const t = f.q.replace(/[%_,()]/g, " ").trim().slice(0, 60);
    if (t) q = q.or(`code.ilike.%${t}%,clinic_name.ilike.%${t}%,doctor_name.ilike.%${t}%,patient_ref.ilike.%${t}%`);
  }
  const { data, error } = await q;
  const rows = (data ?? []) as unknown as ReportRow[];
  const ids = rows.map((r) => r.id);
  const { data: pays } = ids.length ? await db.from("case_payments").select("case_id,amount,currency,voided").in("case_id", ids) : { data: [] };

  const byStatus = new Map<string, number>();
  const byAgent = new Map<string, number>();
  const byService = new Map<string, number>();
  const byCountry = new Map<string, number>();
  const quoted = new Map<string, number>();
  const paid = new Map<string, number>();
  const turnaround: number[] = [];
  for (const r of rows) {
    byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
    byAgent.set(r.agent_id, (byAgent.get(r.agent_id) ?? 0) + 1);
    byService.set(r.service_label ?? "—", (byService.get(r.service_label ?? "—") ?? 0) + 1);
    byCountry.set(r.country_code, (byCountry.get(r.country_code) ?? 0) + 1);
    if (r.quote_amount && r.quote_currency) quoted.set(r.quote_currency, (quoted.get(r.quote_currency) ?? 0) + Number(r.quote_amount));
    if (r.delivered_at) turnaround.push((Date.parse(r.delivered_at) - Date.parse(r.created_at)) / 86400000);
  }
  for (const p of (pays ?? []) as { amount: number; currency: string; voided: boolean }[]) if (!p.voided) paid.set(p.currency, (paid.get(p.currency) ?? 0) + Number(p.amount));
  const open = rows.filter((r) => r.status !== "delivered" && r.status !== "cancelled").length;
  return {
    error: error?.message ?? null, rows, open, delivered: byStatus.get("delivered") ?? 0,
    avgDays: turnaround.length ? turnaround.reduce((a, b) => a + b, 0) / turnaround.length : null,
    byStatus, byAgent, byService, byCountry, quoted, paid,
  };
}
