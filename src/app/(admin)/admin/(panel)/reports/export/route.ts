import { NextResponse, type NextRequest } from "next/server";
import { can, getStaffUser } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { profileMap } from "@/lib/case-data";
import { loadReport } from "@/lib/case-report";
import { countryName, STATUS } from "@/lib/cases";

function cell(v: unknown) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  const user = await getStaffUser();
  if (!user || !can.staff(user) || !can.cases(user)) return new NextResponse("Forbidden", { status: 403 });
  const db = await createSessionClient();
  const r = await loadReport(db, Object.fromEntries(req.nextUrl.searchParams.entries()), can.caseStaff(user));
  const people = await profileMap(db, r.rows.map((x) => x.agent_id));
  const head = ["code", "created", "status", "priority", "service", "clinic", "doctor", "patient_ref", "country", "agent", "quoted", "currency", "delivered"];
  const lines = r.rows.map((x) => [x.code, x.created_at.slice(0, 10), STATUS[x.status].en, x.priority, x.service_label, x.clinic_name, x.doctor_name, x.patient_ref, countryName(x.country_code), people.get(x.agent_id)?.name, x.quote_amount, x.quote_currency, x.delivered_at?.slice(0, 10)].map(cell).join(","));
  return new NextResponse("﻿" + [head.join(","), ...lines].join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="rukn-cases-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" },
  });
}
