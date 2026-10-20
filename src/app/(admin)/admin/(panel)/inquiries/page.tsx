import Link from "next/link";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient, fmtDate } from "@/lib/admin";
import { applyFilters, type InquiryFilters } from "./filters";

export const metadata = { title: "Inquiries" };
const PER_PAGE = 50;
const STATUSES = ["new", "in_review", "contacted", "qualified", "converted", "closed"];

export default async function Inquiries({ searchParams }: { searchParams: Promise<InquiryFilters> }) {
  await requireStaff(can.inquiries);
  const f = await searchParams;
  const page = Math.max(1, Number(f.page ?? 1) || 1);
  const db = await createSessionClient();
  const [{ data, error, count }, { data: services }] = await Promise.all([
    applyFilters(db, f, "id,type,status,name,email,country,organization,professional_role,service_label,created_at").range((page - 1) * PER_PAGE, page * PER_PAGE - 1),
    db.from("services").select("id,slug").is("deleted_at", null).order("sort_order"),
  ]);
  const rows = (data ?? []) as unknown as { id: string; type: string; status: string; name: string; email: string; country: string | null; organization: string | null; professional_role: string | null; service_label: string | null; created_at: string }[];
  const qs = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && k !== "page") as [string, string][]).toString();
  const pages = Math.max(1, Math.ceil((count ?? 0) / PER_PAGE));
  return (
    <>
      <div className="topbar">
        <div><h1>Inquiries</h1><div className="sub">{count ?? 0} matching · private — visible to Sales Managers and Super Administrators only</div></div>
        <a className="btn secondary" href={`/admin/inquiries/export${qs ? `?${qs}` : ""}`}>Export CSV</a>
      </div>
      <section className="panel tight">
        <form className="filters" method="get">
          <div className="field grow"><label htmlFor="q">Search</label><input id="q" name="q" type="search" defaultValue={f.q} placeholder="Name, e-mail, organization, country" /></div>
          <div className="field"><label htmlFor="status">Status</label><select id="status" name="status" defaultValue={f.status ?? ""}><option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select></div>
          <div className="field"><label htmlFor="type">Type</label><select id="type" name="type" defaultValue={f.type ?? ""}><option value="">All</option><option value="case">Case</option><option value="partnership">Partnership</option><option value="contact">Contact</option></select></div>
          <div className="field"><label htmlFor="service">Service</label><select id="service" name="service" defaultValue={f.service ?? ""}><option value="">All</option><option value="none">Not specified</option>{(services ?? []).map((s) => <option key={s.id} value={s.id}>{s.slug}</option>)}</select></div>
          <div className="field"><label htmlFor="from">From</label><input id="from" name="from" type="date" defaultValue={f.from} /></div>
          <div className="field"><label htmlFor="to">To</label><input id="to" name="to" type="date" defaultValue={f.to} /></div>
          <button className="btn" type="submit">Apply</button>
          <Link className="btn secondary" href="/admin/inquiries">Reset</Link>
        </form>
        {error ? <div className="flash err" style={{ margin: 16 }}>Could not load inquiries: {error.message}</div> : null}
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Received</th><th>Name</th><th>Organization</th><th>Country</th><th>Type</th><th>Service</th><th>Status</th></tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={7} className="empty">No inquiries match these filters.</td></tr> : null}
              {rows.map((i) => (
                <tr key={i.id}>
                  <td className="small">{fmtDate(i.created_at)}</td>
                  <td><Link href={`/admin/inquiries/${i.id}`}><strong>{i.name}</strong></Link><div className="small muted">{i.email}</div></td>
                  <td>{i.organization ?? "—"}<div className="small muted">{i.professional_role ?? ""}</div></td>
                  <td>{i.country ?? "—"}</td>
                  <td><span className="pill">{i.type}</span></td>
                  <td>{i.service_label ?? "—"}</td>
                  <td><span className={`pill ${i.status}`}>{i.status.replace("_", " ")}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 ? (
          <div className="btn-row" style={{ padding: 14 }}>
            {page > 1 ? <Link className="btn secondary small" href={`?${qs}${qs ? "&" : ""}page=${page - 1}`}>← Previous</Link> : null}
            <span className="small muted">Page {page} of {pages}</span>
            {page < pages ? <Link className="btn secondary small" href={`?${qs}${qs ? "&" : ""}page=${page + 1}`}>Next →</Link> : null}
          </div>
        ) : null}
      </section>
    </>
  );
}
