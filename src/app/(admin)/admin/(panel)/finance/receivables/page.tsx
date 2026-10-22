import Link from "next/link";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { peopleWithRole, profileMap } from "@/lib/case-data";
import { COUNTRIES, countryName, fmtDay, fmtMoney, STATUS, type CaseStatus } from "@/lib/cases";
import { AGING, loadReceivables, moneyMap, type ReceivableFilters } from "@/lib/finance";

export const metadata = { title: "Receivables" };
const BAR = ["#16809a", "#f5b100", "#f08c00", "#e8590c", "#b42318"];

export default async function Receivables({ searchParams }: { searchParams: Promise<ReceivableFilters> }) {
  await requireStaff(can.finance);
  const f = await searchParams;
  const db = await createSessionClient();
  const [r, agents] = await Promise.all([loadReceivables(db, f), peopleWithRole(db, ["agent"])]);
  const people = await profileMap(db, [...r.byAgent.keys(), ...r.unbilled.map((c) => c.agent_id as string)]);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  const usedCountries = COUNTRIES.filter(([c]) => r.rows.some((x) => x.country_code === c) || f.country === c);
  // share of each bucket in the main currency (for the bar)
  const main = [...r.byCurrency.entries()].sort((a, b) => b[1] - a[1])[0];
  return (
    <>
      <div className="topbar">
        <div><h1>Receivables · المستحقات غير المحصلة</h1><div className="sub">Issued invoices that are not fully paid, oldest debt first. {r.rows.length} open invoice(s).</div></div>
        <div className="btn-row">
          <a className="btn secondary" href={`/admin/finance/receivables/export${qs ? `?${qs}` : ""}`}>Export CSV</a>
          <a className="btn teal" href={`/admin/print/finance/receivables${qs ? `?${qs}` : ""}`} target="_blank" rel="noopener">🖨 Print report</a>
        </div>
      </div>
      <section className="panel tight">
        <form className="filters" method="get">
          <div className="field grow"><label htmlFor="q">Search</label><input id="q" type="search" name="q" defaultValue={f.q ?? ""} placeholder="Invoice, case code, clinic, doctor, patient" /></div>
          <div className="field"><label htmlFor="agent">Agent</label><select id="agent" name="agent" defaultValue={f.agent ?? ""}><option value="">All agents</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></div>
          <div className="field"><label htmlFor="country">Country</label><select id="country" name="country" defaultValue={f.country ?? ""}><option value="">All</option>{usedCountries.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></div>
          <div className="field"><label htmlFor="bucket">Age</label><select id="bucket" name="bucket" defaultValue={f.bucket ?? ""}><option value="">All</option><option value="overdue">Overdue only</option>{AGING.map((a) => <option key={a.key} value={a.key}>{a.en}</option>)}</select></div>
          <button className="btn" type="submit">Apply</button>
          <Link className="btn secondary" href="/admin/finance/receivables">Reset</Link>
        </form>
      </section>

      <div className="stats">
        <div className="stat"><div className="k">Total outstanding · إجمالي المستحق</div><div className="v" style={{ fontSize: "1.2rem", color: "#b42318" }}>{moneyMap(r.byCurrency, fmtMoney)}</div>
          {main ? <div className="aging-bar" title="Ageing of the main currency">{AGING.map((a, i) => { const v = r.byBucket.get(a.key)?.get(main[0]) ?? 0; return v ? <span key={a.key} style={{ width: `${(v / main[1]) * 100}%`, background: BAR[i] }} title={`${a.en}: ${fmtMoney(v, main[0])}`} /> : null; })}</div> : null}
        </div>
        {AGING.map((a, i) => (
          <div key={a.key} className="stat" style={{ borderTop: `3px solid ${BAR[i]}` }}>
            <div className="k">{a.en} · {a.ar}</div>
            <div className="v" style={{ fontSize: "1.05rem", paddingTop: 6 }}>{moneyMap(r.byBucket.get(a.key), fmtMoney)}</div>
          </div>
        ))}
      </div>

      <section className="panel">
        <h2>Open invoices · فواتير غير محصلة</h2>
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Invoice</th><th style={{ minWidth: 200 }}>Case / clinic / agent</th><th>Due</th><th className="num">Days late</th><th className="num">Total</th><th className="num">Paid</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {r.rows.length === 0 ? <tr><td colSpan={7} className="empty">Nothing outstanding 🎉</td></tr> : null}
              {r.rows.map((x) => (
                <tr key={x.invoice_id} className="row-link">
                  <td className="mono nowrap"><Link className="stretched" href={`/admin/cases/${x.case_id}/invoices/${x.invoice_id}`}>{x.invoice_no}</Link>{x.revision ? <span className="small muted"> rev.{x.revision}</span> : null}</td>
                  <td><span className="mono small nowrap">{x.code}</span> <span className={`pill ${STATUS[x.status as CaseStatus]?.tone}`}>{STATUS[x.status as CaseStatus]?.en}</span><div className="small">{x.clinic_name} — {x.doctor_name} · {countryName(x.country_code)}</div><div className="small muted">Agent: {people.get(x.agent_id)?.name ?? "—"}</div></td>
                  <td className="small nowrap">{x.due_date ? fmtDay(x.due_date) : "—"}<div className="muted">issued {fmtDay(x.issue_date)}</div></td>
                  <td className="num"><span className={x.days > 60 ? "pill closed" : x.days > 0 ? "pill changes" : "pill published"}>{x.days > 0 ? x.days : "not due"}</span></td>
                  <td className="num nowrap">{fmtMoney(x.total, x.currency)}</td>
                  <td className="num nowrap">{fmtMoney(x.paid, x.currency)}</td>
                  <td className="num nowrap"><strong>{fmtMoney(x.balance, x.currency)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="cols">
        <section className="panel">
          <h2>By agent · حسب المندوب</h2>
          <table className="data report-table"><tbody>
            {[...r.byAgent.entries()].map(([a, m]) => <tr key={a}><td><Link href={`/admin/finance/receivables?agent=${a}`}>{people.get(a)?.name ?? "—"}</Link></td><td className="num"><strong>{moneyMap(m, fmtMoney)}</strong></td></tr>)}
            {r.byAgent.size === 0 ? <tr><td className="muted">—</td></tr> : null}
          </tbody></table>
        </section>
        <section className="panel">
          <h2>Cases without an invoice · حالات بدون فاتورة</h2>
          <p className="small muted" style={{ marginTop: -6 }}>Open cases that have no issued invoice yet — work that is not billed.</p>
          <table className="data report-table"><tbody>
            {r.unbilled.slice(0, 50).map((c) => (
              <tr key={c.id as string} className="row-link">
                <td><Link className="stretched mono small" href={`/admin/cases/${c.id}`}>{c.code as string}</Link><div className="small">{c.clinic_name as string} · {people.get(c.agent_id as string)?.name ?? ""}</div></td>
                <td><span className={`pill ${STATUS[c.status as CaseStatus]?.tone}`}>{STATUS[c.status as CaseStatus]?.en}</span></td>
                <td className="num small">{c.quote_amount ? fmtMoney(c.quote_amount as number, c.quote_currency as string) : "no price"}</td>
              </tr>
            ))}
            {r.unbilled.length === 0 ? <tr><td className="muted">Every open case has an invoice.</td></tr> : null}
          </tbody></table>
          {r.unbilled.length > 50 ? <p className="small muted">…and {r.unbilled.length - 50} more.</p> : null}
        </section>
      </div>
    </>
  );
}
