import { NextResponse, type NextRequest } from "next/server";
import { can, getStaffUser } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { profileMap } from "@/lib/case-data";
import { countryName } from "@/lib/cases";
import { AGING, loadReceivables } from "@/lib/finance";

function cell(v: unknown) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  const user = await getStaffUser();
  if (!user || !can.staff(user) || !can.caseStaff(user)) return new NextResponse("Forbidden", { status: 403 });
  const db = await createSessionClient();
  const r = await loadReceivables(db, Object.fromEntries(req.nextUrl.searchParams.entries()));
  const people = await profileMap(db, r.rows.map((x) => x.agent_id));
  const head = ["invoice", "case", "clinic", "doctor", "patient_ref", "country", "agent", "issued", "due", "days_late", "age", "currency", "total", "paid", "balance"];
  const lines = r.rows.map((x) => [x.invoice_no, x.code, x.clinic_name, x.doctor_name, x.patient_ref, countryName(x.country_code), people.get(x.agent_id)?.name,
    x.issue_date, x.due_date, Math.max(0, x.days), AGING.find((a) => a.key === x.bucket)?.en, x.currency, x.total.toFixed(2), x.paid.toFixed(2), x.balance.toFixed(2)].map(cell).join(","));
  return new NextResponse("﻿" + [head.join(","), ...lines].join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="rukn-receivables-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" },
  });
}
