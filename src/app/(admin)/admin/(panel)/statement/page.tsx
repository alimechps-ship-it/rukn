import Link from "next/link";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { peopleWithRole, profileMap } from "@/lib/case-data";
import { fmtDay, fmtMoney } from "@/lib/cases";
import { loadStatements, mapText } from "@/lib/statement";

export const metadata = { title: "Account statement" };

export default async function StatementPage({ searchParams }: { searchParams: Promise<{ agent?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const user = await requireStaff(can.cases);
  const staff = can.caseStaff(user);
  const agent = staff ? (sp.agent && /^[0-9a-f-]{36}$/i.test(sp.agent) ? sp.agent : null) : user.id;
  const db = await createSessionClient();
  const [st, agents] = await Promise.all([loadStatements(db, { agent, from: sp.from, to: sp.to }), staff ? peopleWithRole(db, ["agent"]) : Promise.resolve([])]);
  const people = await profileMap(db, [...st.totals.map((t) => t.agent), user.id]);
  const mine = agent ? st.totals.find((t) => t.agent === agent) : undefined;
  const qs = new URLSearchParams(Object.entries({ agent: staff ? agent ?? "" : "", from: sp.from ?? "", to: sp.to ?? "" }).filter(([, v]) => v)).toString();

  return (
    <>
      <div className="topbar">
        <div>
          <h1>{agent ? `Account statement · كشف حساب` : "Agent statements · كشوف حسابات المناديب"}</h1>
          <div className="sub">{agent ? `${people.get(agent)?.name ?? ""} — invoices on your cases and payments received by RUKN.` : "Balance of every agent: invoiced, paid, open balance and payment notices awaiting confirmation."}</div>
        </div>
        {agent ? <div className="btn-row"><a className="btn teal" href={`/admin/print/statement${qs ? `?${qs}` : ""}`} target="_blank" rel="noopener">🖨 Print statement</a></div> : null}
      </div>
      <section className="panel tight">
        <form className="filters" method="get">
          {staff ? <div className="field grow"><label htmlFor="st-agent">Agent</label><select id="st-agent" name="agent" defaultValue={agent ?? ""}><option value="">All agents (summary)</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></div> : null}
          <div className="field"><label htmlFor="st-from">From</label><input id="st-from" type="date" name="from" defaultValue={sp.from ?? ""} /></div>
          <div className="field"><label htmlFor="st-to">To</label><input id="st-to" type="date" name="to" defaultValue={sp.to ?? ""} /></div>
          <button className="btn" type="submit">Apply</button>
          <Link className="btn secondary" href="/admin/statement">Reset</Link>
        </form>
      </section>

      {agent ? (
        <>
          <div className="stats">
            <div className="stat"><div className="k">Invoiced · المفوتر</div><div className="v" style={{ fontSize: "1.1rem" }}>{mine ? mapText(mine.invoiced, fmtMoney) : "—"}</div></div>
            <div className="stat"><div className="k">Paid · المدفوع</div><div className="v" style={{ fontSize: "1.1rem", color: "#067647" }}>{mine ? mapText(mine.paid, fmtMoney) : "—"}</div></div>
            <div className="stat"><div className="k">Balance due · الرصيد المستحق</div><div className="v" style={{ fontSize: "1.1rem", color: "#b42318" }}>{mine ? mapText(mine.balance, fmtMoney) : "—"}</div></div>
            <div className="stat"><div className="k">Payments awaiting confirmation · قيد التأكيد</div><div className="v" style={{ fontSize: "1.1rem" }}>{mine ? mapText(mine.pending, fmtMoney) : "—"}</div></div>
          </div>
          <section className="panel">
            <h2>Movements · الحركات</h2>
            <div className="table-scroll">
              <table className="data">
                <thead><tr><th>Date</th><th>Document</th><th>Case</th><th className="num">Invoiced · مدين</th><th className="num">Paid · دائن</th><th className="num">Balance · الرصيد</th></tr></thead>
                <tbody>
                  {st.opening.size ? <tr><td className="small">{sp.from ? fmtDay(sp.from) : ""}</td><td colSpan={4}><strong>Opening balance · رصيد سابق</strong></td><td className="num"><strong>{mapText(st.opening, fmtMoney)}</strong></td></tr> : null}
                  {st.lines.length === 0 ? <tr><td colSpan={6} className="empty">No invoices or payments in this period.</td></tr> : null}
                  {st.lines.map((l) => (
                    <tr key={`${l.kind}-${l.doc_id}`}>
                      <td className="small nowrap">{fmtDay(l.date)}</td>
                      <td className="mono nowrap">{l.kind === "invoice" ? <Link href={`/admin/cases/${l.case_id}/invoices/${l.doc_id}`}>{l.doc}</Link> : <a href={`/admin/print/case/${l.case_id}/receipt?p=${l.doc_id}`} target="_blank" rel="noopener">{l.doc}</a>}{l.note ? <div className="small muted">{l.note}</div> : null}</td>
                      <td className="small"><Link className="mono" href={`/admin/cases/${l.case_id}`}>{l.code}</Link><div>{l.clinic}</div></td>
                      <td className="num nowrap">{l.debit ? fmtMoney(l.debit, l.currency) : ""}</td>
                      <td className="num nowrap" style={{ color: "#067647" }}>{l.credit ? fmtMoney(l.credit, l.currency) : ""}</td>
                      <td className="num nowrap"><strong>{fmtMoney(l.balance, l.currency)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="panel">
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th>Agent</th><th className="num">Cases</th><th className="num">Invoiced</th><th className="num">Paid</th><th className="num">Balance due</th><th className="num">Awaiting confirmation</th><th /></tr></thead>
              <tbody>
                {st.totals.sort((a, b) => (people.get(a.agent)?.name ?? "").localeCompare(people.get(b.agent)?.name ?? "")).map((t) => (
                  <tr key={t.agent}>
                    <td><strong>{people.get(t.agent)?.name ?? "—"}</strong><div className="small muted">{people.get(t.agent)?.organization ?? ""}{people.get(t.agent)?.country ? ` · ${people.get(t.agent)?.country}` : ""}</div></td>
                    <td className="num">{t.cases}</td>
                    <td className="num">{mapText(t.invoiced, fmtMoney)}</td>
                    <td className="num" style={{ color: "#067647" }}>{mapText(t.paid, fmtMoney)}</td>
                    <td className="num"><strong style={{ color: "#b42318" }}>{mapText(t.balance, fmtMoney)}</strong></td>
                    <td className="num">{mapText(t.pending, fmtMoney)}</td>
                    <td><Link className="btn secondary small" href={`/admin/statement?agent=${t.agent}`}>Statement</Link></td>
                  </tr>
                ))}
                {st.totals.length === 0 ? <tr><td colSpan={7} className="empty">No cases yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
