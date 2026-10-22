import Link from "next/link";
import { redirect } from "next/navigation";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient, fmtDate, hasPendingChanges, SECTION_TR_FIELDS, SERVICE_TR_FIELDS } from "@/lib/admin";

export const metadata = { title: "Dashboard" };

type Stats = { total: number; new: number; last_30_days: number; by_type: Record<string, number>; by_status: Record<string, number>; by_service: { service: string; count: number }[] };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const user = await requireStaff();
  if (!can.backOffice(user)) redirect(can.partner(user) ? "/admin/work" : "/admin/cases");
  const sp = await searchParams;
  const db = await createSessionClient();

  const [statsRes, recentRes, pagesRes, sectionsRes, servicesRes, faqsRes, activityRes] = await Promise.all([
    can.inquiries(user) ? db.rpc("inquiry_stats") : Promise.resolve({ data: null }),
    can.inquiries(user) ? db.from("inquiries").select("id,name,organization,type,status,service_label,created_at").order("created_at", { ascending: false }).limit(6) : Promise.resolve({ data: [] }),
    db.from("pages").select("status").is("deleted_at", null),
    db.from("content_sections").select("id,status,content_section_translations(*)").is("deleted_at", null),
    db.from("services").select("id,status,service_translations(*)").is("deleted_at", null),
    db.from("faqs").select("status").is("deleted_at", null),
    db.from("audit_logs").select("id,action,entity_type,summary,created_at,actor_id").order("created_at", { ascending: false }).limit(10),
  ]);
  const stats = statsRes.data as Stats | null;
  let caseStats: { open: number; awaiting: number; production: number; delivered30: number } | null = null;
  if (can.caseStaff(user)) {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const head = { count: "exact" as const, head: true };
    const [a, b, c, d] = await Promise.all([
      db.from("cases").select("id", head).not("status", "in", "(delivered,cancelled)"),
      db.from("cases").select("id", head).eq("status", "awaiting_approval"),
      db.from("cases").select("id", head).eq("status", "production"),
      db.from("cases").select("id", head).gte("delivered_at", since),
    ]);
    caseStats = { open: a.count ?? 0, awaiting: b.count ?? 0, production: c.count ?? 0, delivered30: d.count ?? 0 };
  }
  const count = (rows: { status: string }[] | null, s: string) => (rows ?? []).filter((r) => r.status === s).length;
  const pending =
    (sectionsRes.data ?? []).filter((s) => s.status === "published" && hasPendingChanges(s.content_section_translations as Record<string, unknown>[], SECTION_TR_FIELDS)).length +
    (servicesRes.data ?? []).filter((s) => s.status === "published" && hasPendingChanges(s.service_translations as Record<string, unknown>[], SERVICE_TR_FIELDS)).length;

  const actorIds = [...new Set((activityRes.data ?? []).map((a) => a.actor_id).filter(Boolean))];
  const { data: actors } = actorIds.length ? await db.from("profiles").select("id,email").in("id", actorIds) : { data: [] };
  const actorName = (id: string | null) => (id ? actors?.find((a) => a.id === id)?.email ?? "Staff" : "System");
  const maxService = Math.max(1, ...(stats?.by_service ?? []).map((s) => s.count));

  return (
    <>
      <div className="topbar">
        <div><h1>Dashboard</h1><div className="sub">Welcome{user.fullName ? `, ${user.fullName}` : ""}. All figures below are live from the database.</div></div>
      </div>
      {sp.denied ? <div className="flash warn">Your role does not have access to that area.</div> : null}

      {caseStats ? (
        <div className="stats">
          <div className="stat"><div className="k">Open cases</div><div className="v"><Link href="/admin/cases?open=1">{caseStats.open}</Link></div></div>
          <div className="stat"><div className="k">Awaiting doctor approval</div><div className="v"><Link href="/admin/cases?status=awaiting_approval">{caseStats.awaiting}</Link></div></div>
          <div className="stat"><div className="k">In production</div><div className="v"><Link href="/admin/cases?status=production">{caseStats.production}</Link></div></div>
          <div className="stat"><div className="k">Delivered (30 days)</div><div className="v">{caseStats.delivered30}</div></div>
        </div>
      ) : null}
      {stats ? (
        <div className="stats">
          <div className="stat"><div className="k">Total inquiries</div><div className="v">{stats.total}</div></div>
          <div className="stat"><div className="k">New (unhandled)</div><div className="v">{stats.new}</div></div>
          <div className="stat"><div className="k">Last 30 days</div><div className="v">{stats.last_30_days}</div></div>
          <div className="stat"><div className="k">Case / Partnership / Contact</div><div className="v" style={{ fontSize: "1.2rem", paddingTop: 8 }}>{stats.by_type.case ?? 0} / {stats.by_type.partnership ?? 0} / {stats.by_type.contact ?? 0}</div></div>
        </div>
      ) : null}

      <div className="cols">
        {stats ? (
          <section className="panel">
            <div className="panel-head"><h2>Inquiries by service</h2><Link href="/admin/inquiries">Open inquiries →</Link></div>
            {stats.by_service.length === 0 ? <p className="muted">No inquiries have been received yet.</p> : (
              <div style={{ display: "grid", gap: 10 }}>
                {stats.by_service.map((s) => (
                  <div key={s.service}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span>{s.service}</span><strong>{s.count}</strong></div>
                    <div className="bar"><span style={{ width: `${(s.count / maxService) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}
        {stats ? (
          <section className="panel tight">
            <div className="panel-head" style={{ padding: "16px 18px 0" }}><h2>Recent submissions</h2></div>
            {(recentRes.data ?? []).length === 0 ? <div className="empty">No submissions yet.</div> : (
              <table className="data"><tbody>
                {(recentRes.data ?? []).map((i) => (
                  <tr key={i.id}>
                    <td><Link href={`/admin/inquiries/${i.id}`}>{i.name}</Link><div className="small muted">{i.organization ?? i.type}</div></td>
                    <td><span className={`pill ${i.status}`}>{i.status.replace("_", " ")}</span></td>
                    <td className="small muted">{fmtDate(i.created_at)}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </section>
        ) : null}

        <section className="panel">
          <h2>Content status</h2>
          <table className="data">
            <thead><tr><th>Type</th><th>Published</th><th>Draft</th><th>Archived</th></tr></thead>
            <tbody>
              <tr><td>Pages</td><td>{count(pagesRes.data, "published")}</td><td>{count(pagesRes.data, "draft")}</td><td>{count(pagesRes.data, "archived")}</td></tr>
              <tr><td>Page sections</td><td>{count(sectionsRes.data, "published")}</td><td>{count(sectionsRes.data, "draft")}</td><td>{count(sectionsRes.data, "archived")}</td></tr>
              <tr><td>Services</td><td>{count(servicesRes.data, "published")}</td><td>{count(servicesRes.data, "draft")}</td><td>{count(servicesRes.data, "archived")}</td></tr>
              <tr><td>FAQs</td><td>{count(faqsRes.data, "published")}</td><td>{count(faqsRes.data, "draft")}</td><td>{count(faqsRes.data, "archived")}</td></tr>
            </tbody>
          </table>
          {pending > 0 ? <p className="flash warn" style={{ marginTop: 14 }}>{pending} published item(s) have unpublished draft changes.</p> : null}
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Recent administrative activity</h2><Link href="/admin/activity">Full log →</Link></div>
          {(activityRes.data ?? []).length === 0 ? <p className="muted">No activity visible for your role yet.</p> : (
            <ul className="timeline">
              {(activityRes.data ?? []).map((a) => (
                <li key={a.id}><strong>{a.action}</strong> {a.entity_type.replace(/_/g, " ")} <span className="muted">{a.summary ?? ""}</span><div className="small muted">{actorName(a.actor_id)} · {fmtDate(a.created_at)}</div></li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
