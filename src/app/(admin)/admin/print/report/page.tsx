import { redirect } from "next/navigation";
import { can, getStaffUser } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { profileMap } from "@/lib/case-data";
import { loadReport, type ReportFilters } from "@/lib/case-report";
import { countryName, fmtDay, fmtMoney, STATUS, type CaseStatus } from "@/lib/cases";
import { PrintShell } from "../PrintShell";
import { loadCompany } from "../company";

export const metadata = { title: "Case report", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function PrintReport({ searchParams }: { searchParams: Promise<ReportFilters> }) {
  const f = await searchParams;
  const user = await getStaffUser();
  if (!user) redirect("/admin/login?next=/admin/reports");
  if (!can.staff(user) || !can.cases(user)) redirect("/admin?denied=1");
  const staff = can.caseStaff(user);
  const showMoney = !staff || can.finance(user);
  const db = await createSessionClient();
  const [r, company] = await Promise.all([loadReport(db, f, staff), loadCompany(db)]);
  const people = await profileMap(db, [...r.byAgent.keys(), user.id]);
  const money = (m: Map<string, number>) => (m.size ? [...m.entries()].map(([c, v]) => fmtMoney(v, c)).join(" + ") : "—");
  const period = `${f.from ? fmtDay(f.from) : "Start"} → ${f.to ? fmtDay(f.to) : "Today"}`;
  const scope = staff ? (f.agent ? `Agent: ${people.get(f.agent)?.name ?? "—"}` : "All agents") : `Agent: ${people.get(user.id)?.name}`;
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <PrintShell back={`/admin/reports${qs ? `?${qs}` : ""}`} company={company} docRef="Case report">
      <div className="doc-title">
        <h1>Case Report<span className="ar">تقرير الحالات</span></h1>
        <div className="doc-no"><div className="date">{period}</div><div className="date">{scope}{f.status ? ` · ${STATUS[f.status as CaseStatus]?.en}` : ""}{f.open === "1" ? " · open only" : ""}</div></div>
      </div>
      <div className="stats">
        <div className="s"><b>{r.rows.length}</b><span>Cases · الحالات</span></div>
        <div className="s"><b>{r.open}</b><span>Open · مفتوحة</span></div>
        <div className="s"><b>{r.delivered}</b><span>Delivered · مُسلَّمة</span></div>
        <div className="s"><b>{r.avgDays === null ? "—" : r.avgDays.toFixed(1)}</b><span>Avg. days to delivery · متوسط أيام التسليم</span></div>
      </div>
      <div className="grid2">
        <div className="box"><h2><span>By status</span><span className="ar">حسب الحالة</span></h2>
          <table className="t"><tbody>{[...r.byStatus.entries()].map(([s, n]) => <tr key={s}><td>{STATUS[s as CaseStatus].en} · <span className="ar">{STATUS[s as CaseStatus].ar}</span></td><td className="num">{n}</td></tr>)}</tbody></table>
        </div>
        <div className="box"><h2><span>By service</span><span className="ar">حسب الخدمة</span></h2>
          <table className="t"><tbody>{[...r.byService.entries()].map(([s, n]) => <tr key={s}><td>{s}</td><td className="num">{n}</td></tr>)}</tbody></table>
          {showMoney ? <dl className="kv2" style={{ marginTop: 8 }}><dt>Quoted · المسعّر</dt><dd>{money(r.quoted)}</dd><dt>Invoiced · المفوتر</dt><dd>{money(r.invoiced)}</dd><dt>Received · المحصّل</dt><dd>{money(r.paid)}</dd></dl> : null}
        </div>
        {staff ? (
          <div className="box"><h2><span>By agent</span><span className="ar">حسب المندوب</span></h2>
            <table className="t"><tbody>{[...r.byAgent.entries()].sort((a, b) => b[1] - a[1]).map(([a, n]) => <tr key={a}><td>{people.get(a)?.name ?? "—"}</td><td className="num">{n}</td></tr>)}</tbody></table>
          </div>
        ) : null}
        <div className="box"><h2><span>By country</span><span className="ar">حسب الدولة</span></h2>
          <table className="t"><tbody>{[...r.byCountry.entries()].sort((a, b) => b[1] - a[1]).map(([cc, n]) => <tr key={cc}><td>{countryName(cc)}</td><td className="num">{n}</td></tr>)}</tbody></table>
        </div>
      </div>
      <div className="section">
        <table className="t">
          <thead><tr><th>Case</th><th>Created</th><th>Clinic / doctor</th><th>Service</th>{staff ? <th>Agent</th> : null}<th>Status</th>{showMoney ? <th className="num">Quoted</th> : null}</tr></thead>
          <tbody>
            {r.rows.map((c) => (
              <tr key={c.id}>
                <td style={{ fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap" }}>{c.code}</td>
                <td style={{ whiteSpace: "nowrap" }}>{fmtDay(c.created_at)}</td>
                <td>{c.clinic_name}<br /><span style={{ color: "#526173" }}>{c.doctor_name}</span></td>
                <td>{c.service_label ?? "—"}</td>
                {staff ? <td>{people.get(c.agent_id)?.name ?? "—"}</td> : null}
                <td>{STATUS[c.status].en}</td>
                {showMoney ? <td className="num">{fmtMoney(c.quote_amount, c.quote_currency)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sign two"><div>Prepared by · أعدّه<br /><strong style={{ color: "#1d2939" }}>{people.get(user.id)?.name}</strong></div><div>Approved by · اعتمده</div></div>
    </PrintShell>
  );
}
