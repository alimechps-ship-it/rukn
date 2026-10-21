import Link from "next/link";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { peopleWithRole, profileMap } from "@/lib/case-data";
import { loadReport, type ReportFilters } from "@/lib/case-report";
import { ALL_STATUSES, countryName, fmtDay, fmtMoney, STATUS, type CaseStatus } from "@/lib/cases";

export const metadata = { title: "Reports" };

export default async function Reports({ searchParams }: { searchParams: Promise<ReportFilters> }) {
  const user = await requireStaff(can.cases);
  const staff = can.caseStaff(user);
  const f = await searchParams;
  const db = await createSessionClient();
  const [r, agents] = await Promise.all([loadReport(db, f, staff), staff ? peopleWithRole(db, ["agent"]) : Promise.resolve([])]);
  const people = await profileMap(db, [...r.byAgent.keys()]);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  const money = (m: Map<string, number>) => (m.size ? [...m.entries()].map(([c, v]) => fmtMoney(v, c)).join(" + ") : "—");
  return (
    <>
      <div className="topbar">
        <div><h1>Case reports</h1><div className="sub">{staff ? "All agents" : "Your cases"} · {r.rows.length} case(s) in this report</div></div>
        <div className="btn-row">
          <a className="btn secondary" href={`/admin/reports/export${qs ? `?${qs}` : ""}`}>Export CSV</a>
          <a className="btn teal" href={`/admin/print/report${qs ? `?${qs}` : ""}`} target="_blank" rel="noopener">🖨 Print report</a>
        </div>
      </div>
      <section className="panel tight">
        <form className="filters" method="get">
          <div className="field"><label htmlFor="from">From</label><input id="from" name="from" type="date" defaultValue={f.from} /></div>
          <div className="field"><label htmlFor="to">To</label><input id="to" name="to" type="date" defaultValue={f.to} /></div>
          <div className="field"><label htmlFor="status">Status</label><select id="status" name="status" defaultValue={f.status ?? ""}><option value="">All</option>{ALL_STATUSES.map((s) => <option key={s} value={s}>{STATUS[s].en}</option>)}</select></div>
          {staff ? <div className="field"><label htmlFor="agent">Agent</label><select id="agent" name="agent" defaultValue={f.agent ?? ""}><option value="">All agents</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></div> : null}
          <label className="check" style={{ paddingBottom: 8 }}><input type="checkbox" name="open" value="1" defaultChecked={f.open === "1"} /> Open only</label>
          <button className="btn" type="submit">Apply</button>
          <Link className="btn secondary" href="/admin/reports">Reset</Link>
        </form>
      </section>
      {r.error ? <div className="flash err">{r.error}</div> : null}
      <div className="stats">
        <div className="stat"><div className="k">Cases</div><div className="v">{r.rows.length}</div></div>
        <div className="stat"><div className="k">Open</div><div className="v">{r.open}</div></div>
        <div className="stat"><div className="k">Delivered</div><div className="v">{r.delivered}</div></div>
        <div className="stat"><div className="k">Avg. days to delivery</div><div className="v">{r.avgDays === null ? "—" : r.avgDays.toFixed(1)}</div></div>
        <div className="stat"><div className="k">Quoted</div><div className="v" style={{ fontSize: "1.05rem", paddingTop: 8 }}>{money(r.quoted)}</div></div>
        <div className="stat"><div className="k">Received</div><div className="v" style={{ fontSize: "1.05rem", paddingTop: 8 }}>{money(r.paid)}</div></div>
      </div>
      <div className="cols">
        <section className="panel"><h2>By status</h2><table className="data report-table"><tbody>{[...r.byStatus.entries()].map(([s, n]) => <tr key={s}><td><span className={`pill ${STATUS[s as CaseStatus].tone}`}>{STATUS[s as CaseStatus].en}</span></td><td className="num">{n}</td></tr>)}</tbody></table></section>
        <section className="panel"><h2>By service</h2><table className="data report-table"><tbody>{[...r.byService.entries()].map(([s, n]) => <tr key={s}><td>{s}</td><td className="num">{n}</td></tr>)}</tbody></table></section>
        {staff ? <section className="panel"><h2>By agent</h2><table className="data report-table"><tbody>{[...r.byAgent.entries()].sort((a, b) => b[1] - a[1]).map(([a, n]) => <tr key={a}><td>{people.get(a)?.name ?? "—"}</td><td className="num">{n}</td></tr>)}</tbody></table></section> : null}
        <section className="panel"><h2>By country</h2><table className="data report-table"><tbody>{[...r.byCountry.entries()].sort((a, b) => b[1] - a[1]).map(([cc, n]) => <tr key={cc}><td>{countryName(cc)}</td><td className="num">{n}</td></tr>)}</tbody></table></section>
      </div>
      <section className="panel tight">
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Case</th><th>Created</th><th>Clinic</th><th>Service</th>{staff ? <th>Agent</th> : null}<th>Status</th><th className="num">Quoted</th></tr></thead>
            <tbody>
              {r.rows.slice(0, 300).map((c) => (
                <tr key={c.id}>
                  <td><Link className="mono" href={`/admin/cases/${c.id}`}>{c.code}</Link></td>
                  <td className="small">{fmtDay(c.created_at)}</td>
                  <td>{c.clinic_name}</td>
                  <td>{c.service_label ?? "—"}</td>
                  {staff ? <td className="small">{people.get(c.agent_id)?.name ?? "—"}</td> : null}
                  <td><span className={`pill ${STATUS[c.status].tone}`}>{STATUS[c.status].en}</span></td>
                  <td className="num">{fmtMoney(c.quote_amount, c.quote_currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {r.rows.length > 300 ? <p className="small muted" style={{ padding: 12 }}>Showing the latest 300 rows. Use CSV export or Print for the full report.</p> : null}
      </section>
    </>
  );
}
