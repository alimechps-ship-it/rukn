import { NextResponse, type NextRequest } from "next/server";
import { can, getStaffUser } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { applyFilters } from "../filters";

const COLS = ["created_at", "type", "status", "name", "email", "phone", "country", "organization", "professional_role", "service_label", "message", "locale", "source_path"] as const;

/** Neutralises spreadsheet formula injection and quotes the value. */
function cell(v: unknown) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  const user = await getStaffUser();
  if (!user || !can.staff(user) || !can.inquiries(user)) return new NextResponse("Forbidden", { status: 403 });
  const db = await createSessionClient();
  const f = Object.fromEntries(req.nextUrl.searchParams.entries());
  const { data, error } = await applyFilters(db, f, COLS.join(",")).limit(10000);
  if (error) return new NextResponse(`Export failed: ${error.message}`, { status: 500 });
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const csv = "﻿" + [COLS.join(","), ...rows.map((r) => COLS.map((c) => cell(r[c])).join(","))].join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="rukn-inquiries-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
