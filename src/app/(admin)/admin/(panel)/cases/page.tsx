import Link from "next/link";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient, fmtDate } from "@/lib/admin";
import { profileMap, peopleWithRole } from "@/lib/case-data";
import { ALL_STATUSES, countryName, STATUS, type CaseStatus } from "@/lib/cases";

export const metadata = { title: "Cases" };
const PER = 50;
type F = { q?: string; status?: string; agent?: string; country?: string; from?: string; to?: string; open?: string; page?: string };

export default async function Cases({ searchParams }: { searchParams: Promise<F> }) {
  const user = await requireStaff(can.cases);
  const f = await searchParams;
  const staff = can.caseStaff(user);
  const page = Math.max(1, Number(f.page ?? 1) || 1);
  const db = await createSessionClient();
  let q = db.from("cases").select("id,code,status,priority,clinic_name,doctor_name,patient_ref,service_label,agent_id,country_code,due_date,created_at,updated_at", { count: "exact" }).order("created_at", { ascending: false });
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
  const [{ data, count, error }, agents] = await Promise.all([q.range((page - 1) * PER, page * PER - 1), staff ? peopleWithRole(db, ["agent"]) : Promise.resolve([])]);
  const rows = data ?? [];
  const people = await profileMap(db, rows.map((r) => r.agent_id));
  const qs = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && k !== "page") as [string, string][]).toString();
  const pages = Math.max(1, Math.ceil((count ?? 0) / PER));

  return (
    <>
      <div className="topbar">
        <div><h1>{staff ? "Cases" : "My cases"}</h1><div className="sub">{count ?? 0} case(s){staff ? "" : " · only your own cases are visible to you"}</div></div>
        <div className="btn-row">
          <a className="btn secondary" href={`/admin/reports${qs ? `?${qs}` : ""}`}>Report</a>
          <Link className="btn teal" href="/admin/cases/new">+ New case</Link>
        </div>
      </div>
      <section className="panel tight">
        <form className="filters" method="get">
          <div className="field grow"><label htmlFor="q">Search</label><input id="q" name="q" type="search" defaultValue={f.q} placeholder="Case code, clinic, doctor, patient ref" /></div>
          <div className="field"><label htmlFor="status">Status</label><select id="status" name="status" defaultValue={f.status ?? ""}><option value="">All</option>{ALL_STATUSES.map((s) => <option key={s} value={s}>{STATUS[s].en}</option>)}</select></div>
          {staff ? <div className="field"><label htmlFor="agent">Agent</label><select id="agent" name="agent" defaultValue={f.agent ?? ""}><option value="">All agents</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></div> : null}
          <div className="field"><label htmlFor="from">From</label><input id="from" name="from" type="date" defaultValue={f.from} /></div>
          <div className="field"><label htmlFor="to">To</label><input id="to" name="to" type="date" defaultValue={f.to} /></div>
          <label className="check" style={{ paddingBottom: 8 }}><input type="checkbox" name="open" value="1" defaultChecked={f.open === "1"} /> Open only</label>
          <button className="btn" type="submit">Apply</button>
          <Link className="btn secondary" href="/admin/cases">Reset</Link>
        </form>
        {error ? <div className="flash err" style={{ margin: 16 }}>Could not load cases: {error.message}</div> : null}
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Case</th><th>Clinic / doctor</th><th>Patient</th><th>Service</th>{staff ? <th>Agent</th> : null}<th>Status</th><th>Created</th></tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={7} className="empty">No cases yet. <Link href="/admin/cases/new">Create the first case →</Link></td></tr> : null}
              {rows.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/admin/cases/${c.id}`} className="mono"><strong>{c.code}</strong></Link>{c.priority === "urgent" ? <div><span className="pill changes">urgent</span></div> : null}</td>
                  <td>{c.clinic_name}<div className="small muted">{c.doctor_name} · {countryName(c.country_code)}</div></td>
                  <td className="mono">{c.patient_ref}</td>
                  <td>{c.service_label ?? "—"}</td>
                  {staff ? <td className="small">{people.get(c.agent_id)?.name ?? "—"}</td> : null}
                  <td><span className={`pill ${STATUS[c.status as CaseStatus].tone}`}>{STATUS[c.status as CaseStatus].en}</span></td>
                  <td className="small muted">{fmtDate(c.created_at)}</td>
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
