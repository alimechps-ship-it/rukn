import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSessionClient } from "./supabase/server";
import type { AppRole } from "./types";

export interface StaffUser {
  id: string;
  email: string;
  fullName: string | null;
  roles: AppRole[];
  allowedLocales: string[];
  isActive: boolean;
}

export const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: "Super Administrator",
  content_manager: "Content Manager",
  sales_manager: "Sales Manager",
  translator: "Translator",
  case_manager: "Case Manager",
  finance_manager: "Finance Manager",
  agent: "Agent",
  planner: "Treatment planner (partner)",
  lab: "Production lab (partner)",
};

/** Current signed-in user with roles (verified against Supabase Auth on every call). */
export const getStaffUser = cache(async (): Promise<StaffUser | null> => {
  const db = await createSessionClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return null;
  const [{ data: profile }, { data: roles }] = await Promise.all([
    db.from("profiles").select("id,email,full_name,is_active,allowed_locales").eq("id", auth.user.id).maybeSingle(),
    db.rpc("current_app_roles"),
  ]);
  return {
    id: auth.user.id,
    email: auth.user.email ?? profile?.email ?? "",
    fullName: profile?.full_name ?? null,
    roles: ((roles as AppRole[] | null) ?? []).filter(Boolean),
    allowedLocales: profile?.allowed_locales ?? [],
    isActive: profile?.is_active ?? false,
  };
});

export const can = {
  content: (u: StaffUser | null) => !!u?.roles.some((r) => r === "super_admin" || r === "content_manager"),
  translate: (u: StaffUser | null) => !!u?.roles.some((r) => r === "super_admin" || r === "content_manager" || r === "translator"),
  inquiries: (u: StaffUser | null) => !!u?.roles.some((r) => r === "super_admin" || r === "sales_manager"),
  admin: (u: StaffUser | null) => !!u?.roles.includes("super_admin"),
  /** Anyone allowed into /admin (back-office staff and field agents). */
  staff: (u: StaffUser | null) => !!u && u.isActive && u.roles.length > 0,
  /** Back-office roles (everything except agents). */
  backOffice: (u: StaffUser | null) => !!u?.roles.some((r) => r !== "agent" && r !== "planner" && r !== "lab"),
  /** External treatment planners and production labs (partner portal). */
  partner: (u: StaffUser | null) => !!u?.roles.some((r) => r === "planner" || r === "lab"),
  /** Can open case files: case staff, agents (own cases) and partners (their work orders) — RLS decides which. */
  files: (u: StaffUser | null) => !!u?.roles.some((r) => ["super_admin", "case_manager", "finance_manager", "agent", "planner", "lab"].includes(r)),
  /** RUKN case back-office (reads cases): super admin, case manager, finance manager. */
  caseStaff: (u: StaffUser | null) => !!u?.roles.some((r) => r === "super_admin" || r === "case_manager" || r === "finance_manager"),
  /** Case administration (intake, files, plans, work orders, dispatch orders) — no money. */
  ops: (u: StaffUser | null) => !!u?.roles.some((r) => r === "super_admin" || r === "case_manager"),
  /** Prices, invoices, payments, cash, partner bills — the finance manager. */
  finance: (u: StaffUser | null) => !!u?.roles.some((r) => r === "super_admin" || r === "finance_manager"),
  agent: (u: StaffUser | null) => !!u?.roles.includes("agent"),
  cases: (u: StaffUser | null) => !!u?.roles.some((r) => r === "super_admin" || r === "case_manager" || r === "finance_manager" || r === "agent"),
  locale: (u: StaffUser | null, locale: string) =>
    !!u && (u.roles.some((r) => r === "super_admin" || r === "content_manager") || (u.roles.includes("translator") && u.allowedLocales.includes(locale))),
};

/** Page guard: redirects to login, or to the dashboard when the role is insufficient. */
export async function requireStaff(check: (u: StaffUser | null) => boolean = can.staff) {
  const user = await getStaffUser();
  if (!user) redirect("/admin/login");
  if (!can.staff(user) || !check(user)) redirect("/admin?denied=1");
  return user;
}

/** Action guard: returns the user or throws a readable error (server-side enforcement). */
export async function assertStaff(check: (u: StaffUser | null) => boolean) {
  const user = await getStaffUser();
  if (!user || !can.staff(user) || !check(user)) throw new Error("You do not have permission to perform this action.");
  return user;
}
