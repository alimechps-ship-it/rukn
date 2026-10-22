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

  const groups: NavGroup[] = can.backOffice(user) ? [{ label: "Overview", items: [{ href: "/admin", label: "Dashboard" }] }] : [];
  if (can.cases(user)) {
    const db = await createSessionClient();
    const { count: openCases } = await db.from("cases").select("id", { count: "exact", head: true }).not("status", "in", "(delivered,cancelled)");
    groups.push({
      label: can.caseStaff(user) ? "Cases" : "Agent portal",
      items: [
        { href: "/admin/cases", label: can.caseStaff(user) ? "All cases" : "My cases", badge: openCases ?? 0 },
        { href: "/admin/cases/new", label: "New case" },
        { href: "/admin/reports", label: "Reports" },
      ],
    });
  }
  if (can.caseStaff(user)) {
    groups.push({
      label: "Finance · المالية",
      items: [
        { href: "/admin/finance/receivables", label: "Receivables · المستحقات" },
        { href: "/admin/finance/cash", label: "Cash boxes · الصناديق" },
        { href: "/admin/finance/people", label: "Person accounts · العهد" },
        { href: "/admin/price-list", label: "Price list & billing" },
      ],
    });
  }
  if (can.translate(user)) {
    groups.push({
      label: "Website content",
      items: [
        { href: "/admin/pages", label: "Pages & sections" },
        { href: "/admin/services", label: "Services" },
        { href: "/admin/faqs", label: "FAQs" },
        { href: "/admin/team", label: "Team profiles" },
        { href: "/admin/navigation", label: "Navigation & footer" },
        { href: "/admin/announcements", label: "Announcements" },
        { href: "/admin/strings", label: "Interface text" },
        ...(can.content(user) ? [{ href: "/admin/media", label: "Media library" }, { href: "/admin/trash", label: "Trash" }] : []),
      ],
    });
  }
  if (can.inquiries(user)) groups.push({ label: "Leads", items: [{ href: "/admin/inquiries", label: "Inquiries", badge: newInquiries }] });
  const system = [
    ...(can.translate(user) ? [{ href: "/admin/settings", label: "Settings" }] : []),
    ...(can.admin(user) ? [{ href: "/admin/users", label: "Users & roles" }] : []),
    ...(can.backOffice(user) ? [{ href: "/admin/activity", label: "Activity log" }] : []),
  ];
  if (system.length) groups.push({ label: "System", items: system });

  return (
    <div className="shell">
      <Sidebar groups={groups} user={{ email: user.email, roles: user.roles.map((r) => ROLE_LABELS[r]).join(", ") }} signOut={signOut} />
      <main className="main">{children}</main>
    </div>
  );
}
