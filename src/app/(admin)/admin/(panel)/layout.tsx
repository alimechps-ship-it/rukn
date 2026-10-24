import { Sidebar, type NavGroup } from "@/components/admin/Sidebar";
import { can, getStaffUser, ROLE_LABELS } from "@/lib/auth";
import { createSessionClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { redirect } from "next/navigation";
import { signOut } from "../auth-actions";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) {
    return <main className="auth-page"><div className="auth-card"><h1>Configuration required</h1><p>Set the Supabase environment variables (see README).</p></div></main>;
  }
  const user = await getStaffUser();
  if (!user) redirect("/admin/login");
  if (!can.staff(user)) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <h1 style={{ fontSize: "1.2rem" }}>No access</h1>
          <p className="muted">You are signed in as {user.email}, but your account {user.isActive ? "has no administrative role" : "is deactivated"}. Ask a Super Administrator to grant access.</p>
          <form action={signOut}><button className="btn" type="submit">Sign out</button></form>
        </div>
      </main>
    );
  }

  let newInquiries = 0;
  if (can.inquiries(user)) {
    const db = await createSessionClient();
    const { count } = await db.from("inquiries").select("id", { count: "exact", head: true }).eq("status", "new");
    newInquiries = count ?? 0;
  }

  const db = await createSessionClient();
  const head = { count: "exact" as const, head: true };
  const [openCases, openOrders, waiting, billsToReview, pendingNotices, toPrice] = await Promise.all([
    can.cases(user) ? db.from("cases").select("id", head).not("status", "in", "(delivered,cancelled)").then((r) => r.count ?? 0) : 0,
    can.partner(user) ? db.from("case_assignments").select("id", head).in("status", ["assigned", "accepted", "in_progress"]).then((r) => r.count ?? 0) : 0,
    can.caseStaff(user) ? db.from("case_assignments").select("id", head).in("status", ["completed", "shipped"]).then((r) => r.count ?? 0) : 0,
    can.finance(user) ? db.from("partner_bills").select("id", head).eq("status", "submitted").then((r) => r.count ?? 0) : 0,
    can.finance(user) ? db.from("case_payment_claims").select("id", head).eq("status", "pending").then((r) => r.count ?? 0) : 0,
    can.finance(user) ? db.from("case_dispatch_orders").select("id", head).eq("status", "sent").then((r) => r.count ?? 0) : 0,
  ]);

  const groups: NavGroup[] = [];
  if (can.backOffice(user)) groups.push({ key: "overview", label: "Overview", ar: "نظرة عامة", items: [{ href: "/admin", label: "Dashboard", ar: "لوحة المعلومات" }] });
  if (can.cases(user)) {
    const staff = can.caseStaff(user);
    groups.push({
      key: "cases", label: staff ? "Cases" : "Agent portal", ar: staff ? "الحالات" : "بوابة المندوب",
      items: [
        { href: "/admin/cases", label: staff ? "All cases" : "My cases", ar: staff ? "كل الحالات" : "حالاتي", badge: openCases },
        { href: "/admin/cases/new", label: "New case", ar: "حالة جديدة" },
        { href: "/admin/reports", label: "Reports", ar: "التقارير" },
        ...(staff ? [] : [{ href: "/admin/statement", label: "My account", ar: "كشف حسابي" }]),
      ],
    });
  }
  if (can.partner(user)) {
    groups.push({
      key: "partner", label: "Partner portal", ar: "بوابة الشركاء",
      items: [
        { href: "/admin/work", label: "Work orders", ar: "أوامر العمل", badge: openOrders },
        { href: "/admin/partner-bills", label: "My bills", ar: "فواتيري" },
        { href: "/admin/partner-statement", label: "My statement", ar: "كشف حسابي" },
      ],
    });
  }
  if (can.caseStaff(user)) {
    groups.push({
      key: "partners", label: "Planners & labs", ar: "المخططون والمعامل",
      items: [
        { href: "/admin/partners", label: "Partners", ar: "الشركاء" },
        { href: "/admin/work", label: "Work orders", ar: "أوامر العمل", badge: waiting },
        ...(can.finance(user) ? [{ href: "/admin/partner-bills", label: "Partner bills", ar: "فواتير الشركاء", badge: billsToReview }] : []),
      ],
    });
  }
  if (can.finance(user)) {
    groups.push({
      key: "finance", label: "Finance", ar: "المالية",
      items: [
        { href: "/admin/finance/to-price", label: "To price", ar: "بانتظار التسعير", badge: toPrice },
        { href: "/admin/finance/notices", label: "Payment notices", ar: "إشعارات الدفع", badge: pendingNotices },
        { href: "/admin/finance/receivables", label: "Receivables", ar: "المستحقات" },
        { href: "/admin/statement", label: "Agent statements", ar: "كشوف المناديب" },
        { href: "/admin/price-list", label: "Price list & billing", ar: "قائمة الأسعار" },
      ],
    });
    groups.push({
      key: "accounting", label: "Accounting", ar: "الحسابات",
      items: [
        { href: "/admin/finance/cash", label: "Cash boxes", ar: "الصناديق" },
        { href: "/admin/finance/journal", label: "Journal entries", ar: "القيود" },
        { href: "/admin/finance/accounts", label: "Chart of accounts", ar: "شجرة الحسابات" },
        { href: "/admin/finance/people", label: "Person accounts", ar: "العهد" },
        { href: "/admin/finance/rates", label: "Exchange rates", ar: "أسعار الصرف" },
      ],
    });
  }
  if (can.caseStaff(user)) groups.push({ key: "tools", label: "Tools", ar: "أدوات", items: [{ href: "/admin/assistant", label: "AI assistant", ar: "المساعد الذكي" }] });
  if (can.translate(user)) {
    groups.push({
      key: "content", label: "Website content", ar: "محتوى الموقع",
      items: [
        { href: "/admin/pages", label: "Pages & sections", ar: "الصفحات" },
        { href: "/admin/services", label: "Services", ar: "الخدمات" },
        { href: "/admin/faqs", label: "FAQs", ar: "الأسئلة الشائعة" },
        { href: "/admin/team", label: "Team profiles", ar: "الفريق" },
        { href: "/admin/navigation", label: "Navigation & footer", ar: "القوائم والتذييل" },
        { href: "/admin/announcements", label: "Announcements", ar: "الإعلانات" },
        { href: "/admin/strings", label: "Interface text", ar: "نصوص الواجهة" },
        ...(can.content(user) ? [{ href: "/admin/media", label: "Media library", ar: "مكتبة الوسائط" }, { href: "/admin/trash", label: "Trash", ar: "المحذوفات" }] : []),
      ],
    });
  }
  if (can.inquiries(user)) groups.push({ key: "leads", label: "Leads", ar: "العملاء المحتملون", items: [{ href: "/admin/inquiries", label: "Inquiries", ar: "الطلبات", badge: newInquiries }] });
  const system = [
    ...(can.translate(user) ? [{ href: "/admin/settings", label: "Settings", ar: "الإعدادات" }] : []),
    ...(can.admin(user) ? [{ href: "/admin/users", label: "Users & roles", ar: "المستخدمون والصلاحيات" }] : []),
    ...(can.backOffice(user) ? [{ href: "/admin/activity", label: "Activity log", ar: "سجل النشاط" }] : []),
  ];
  if (system.length) groups.push({ key: "system", label: "System", ar: "النظام", items: system });

  return (
    <div className="shell">
      <Sidebar groups={groups} user={{ email: user.email, name: user.fullName ?? "", roles: user.roles.map((r) => ROLE_LABELS[r]).join(" · ") }} signOut={signOut} />
      <main className="main">{children}</main>
    </div>
  );
}
