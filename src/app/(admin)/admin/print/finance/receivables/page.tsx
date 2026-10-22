import { redirect } from "next/navigation";
import { can, getStaffUser } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { profileMap } from "@/lib/case-data";
import { countryName, fmtDay, fmtMoney } from "@/lib/cases";
import { AGING, loadReceivables, moneyMap, type ReceivableFilters } from "@/lib/finance";
import { PrintShell } from "../../PrintShell";
import { loadCompany } from "../../company";

export const metadata = { title: "Receivables", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function PrintReceivables({ searchParams }: { searchParams: Promise<ReceivableFilters> }) {
  const f = await searchParams;
  const user = await getStaffUser();
  if (!user) redirect("/admin/login?next=/admin/finance/receivables");
  if (!can.finance(user)) redirect("/admin?denied=1");
  const db = await createSessionClient();
  const [r, company] = await Promise.all([loadReceivables(db, f), loadCompany(db)]);
  const people = await profileMap(db, [...r.byAgent.keys(), user.id]);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  const scope = [f.agent ? `Agent: ${people.get(f.agent)?.name ?? ""}` : "All agents", f.country ? countryName(f.country) : null, f.bucket ? (f.bucket === "overdue" ? "Overdue only" : AGING.find((a) => a.key === f.bucket)?.en) : null].filter(Boolean).join(" · ");
  return (
    <PrintShell back={`/admin/finance/receivables${qs ? `?${qs}` : ""}`} company={company} docRef="Receivables">
      <div className="doc-title">
        <h1>Receivables Report<span className="ar">تقرير المستحقات غير المحصلة</span></h1>
        <div className="doc-no"><div className="date">As of {fmtDay(new Date().toISOString())}</div><div className="date">{scope}</div></div>
      </div>
      <div className="stats" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="s"><b style={{ fontSize: "12pt", color: "#b42318" }}>{moneyMap(r.byCurrency, fmtMoney)}</b><span>Total outstanding · إجمالي المستحق</span></div>
        <div className="s"><b>{r.rows.length}</b><span>Open invoices · فواتير مفتوحة</span></div>
        <div className="s"><b>{r.rows.filter((x) => x.days > 0).length}</b><span>Overdue · متأخرة</span></div>
      </div>
      <table className="t" style={{ marginBottom: 10 }}>
        <thead><tr>{AGING.map((a) => <th key={a.key} className="num">{a.en}<br /><span className="ar">{a.ar}</span></th>)}</tr></thead>
        <tbody><tr>{AGING.map((a) => <td key={a.key} className="num"><strong>{moneyMap(r.byBucket.get(a.key), fmtMoney)}</strong></td>)}</tr></tbody>
      </table>
      <table className="t">
        <thead><tr><th>Invoice</th><th>Case / clinic</th><th>Agent</th><th>Due</th><th className="num">Days</th><th className="num">Total</th><th className="num">Paid</th><th className="num">Balance</th></tr></thead>
        <tbody>
          {r.rows.map((x) => (
            <tr key={x.invoice_id}>
              <td style={{ fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap" }}>{x.invoice_no}</td>
              <td>{x.code}<div style={{ fontSize: "8.5pt", color: "#526173" }}>{x.clinic_name} · {countryName(x.country_code)}</div></td>
              <td>{people.get(x.agent_id)?.name ?? "—"}</td>
              <td style={{ whiteSpace: "nowrap" }}>{x.due_date ? fmtDay(x.due_date) : fmtDay(x.issue_date)}</td>
              <td className="num" style={{ color: x.days > 60 ? "#b42318" : undefined }}>{x.days > 0 ? x.days : "—"}</td>
              <td className="num">{fmtMoney(x.total, x.currency)}</td>
              <td className="num">{fmtMoney(x.paid, x.currency)}</td>
              <td className="num"><strong>{fmtMoney(x.balance, x.currency)}</strong></td>
            </tr>
          ))}
          {r.rows.length === 0 ? <tr><td colSpan={8} style={{ textAlign: "center" }}>Nothing outstanding.</td></tr> : null}
        </tbody>
      </table>
      {r.byAgent.size ? (
        <div className="section box">
          <h2><span>By agent</span><span className="ar">حسب المندوب</span></h2>
          <table className="t"><tbody>{[...r.byAgent.entries()].map(([a, m]) => <tr key={a}><td>{people.get(a)?.name ?? "—"}</td><td className="num"><strong>{moneyMap(m, fmtMoney)}</strong></td></tr>)}</tbody></table>
        </div>
      ) : null}
      <div className="sign two"><div>Prepared by · أعدّه<br /><strong style={{ color: "#1d2939" }}>{people.get(user.id)?.name}</strong></div><div>Approved by · اعتماد</div></div>
    </PrintShell>
  );
}
