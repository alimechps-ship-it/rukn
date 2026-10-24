import Link from "next/link";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { peopleWithRole, profileMap } from "@/lib/case-data";
import { fmtDay, fmtMoney } from "@/lib/cases";
import { loadStatements, mapText } from "@/lib/statement";
import { CURRENCY_AR, groupByCurrency } from "@/lib/currency-groups";
import { loadReceivables } from "@/lib/finance";
import { isAiConfigured } from "@/lib/ai";
import { PaymentNoticeForm } from "@/components/admin/PaymentNoticeForm";
import { NoticesTable, type Notice } from "../finance/Notices";
import { loadCurrencies } from "@/lib/currency-list";

export const metadata = { title: "Account statement" };

export default async function StatementPage({ searchParams }: { searchParams: Promise<{ agent?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const user = await requireStaff((u) => can.finance(u) || (can.cases(u) && !can.caseStaff(u)));
  const staff = can.finance(user);
  const agent = staff ? (sp.agent && /^[0-9a-f-]{36}$/i.test(sp.agent) ? sp.agent : null) : user.id;
  const db = await createSessionClient();
  const [st, agents] = await Promise.all([loadStatements(db, { agent, from: sp.from, to: sp.to }), staff ? peopleWithRole(db, ["agent"]) : Promise.resolve([])]);
  const people = await profileMap(db, [...st.totals.map((t) => t.agent), user.id]);
  const mine = agent ? st.totals.find((t) => t.agent === agent) : undefined;
  // Payment notices of this agent (any case, or on account) and his open invoices
  const [{ data: notices }, rec, { data: boxes }] = agent ? await Promise.all([
    db.from("case_payment_claims").select("*").eq("agent_id", agent).order("created_at", { ascending: false }).limit(50),
    loadReceivables(db, { agent }),
    staff ? db.from("cash_accounts").select("id,name,currency").eq("active", true).order("sort_order") : Promise.resolve({ data: [] }),
  ]) : [{ data: [] }, { rows: [] as Awaited<ReturnType<typeof loadReceivables>>["rows"] }, { data: [] }];
  const noticeList = (notices ?? []) as Notice[];
  // pending first, then the 10 latest — older ones stay out of the way
  const recentNotices = [...noticeList.filter((n) => n.status === "pending"), ...noticeList.filter((n) => n.status !== "pending").slice(0, 10)];
  const olderNotices = noticeList.filter((n) => !recentNotices.includes(n));
  const nIds = { inv: [...new Set(noticeList.map((n) => n.invoice_id).filter(Boolean))] as string[], pay: [...new Set(noticeList.map((n) => n.payment_id).filter(Boolean))] as string[] };
  const nCases = [...new Set(noticeList.map((n) => n.case_id).filter(Boolean))] as string[];
  const [{ data: nInv }, { data: nPay }, { data: nCase }] = await Promise.all([
    nIds.inv.length ? db.from("case_invoices").select("id,invoice_no").in("id", nIds.inv) : Promise.resolve({ data: [] }),
    nIds.pay.length ? db.from("case_payments").select("id,receipt_no").in("id", nIds.pay) : Promise.resolve({ data: [] }),
    nCases.length ? db.from("cases").select("id,code").in("id", nCases) : Promise.resolve({ data: [] }),
  ]);
  const openInvoices = rec.rows.map((r) => ({ id: r.invoice_id, invoice_no: r.invoice_no, currency: r.currency, balance: r.balance, case_id: r.case_id, code: r.code }));
  const owes = mine ? [...mine.balance.entries()].filter(([, v]) => v > 0) : [];
  const qs = new URLSearchParams(Object.entries({ agent: staff ? agent ?? "" : "", from: sp.from ?? "", to: sp.to ?? "" }).filter(([, v]) => v)).toString();

  return (
    <>
      <div className="topbar">
        <div>
          <h1>{agent ? `Account statement · كشف حساب` : "Agent statements · كشوف حسابات المناديب"}</h1>
          <div className="sub">{agent ? `${people.get(agent)?.name ?? ""} — invoices on your cases and payments received by RUKN.` : "Balance of every agent: invoiced, paid, open balance and payment notices awaiting confirmation."}</div>
        </div>
        {agent ? <div className="btn-row">{staff ? <Link className="btn secondary" href={`/admin/finance/journal?account=agent:${agent}`}>± Journal entry · قيد</Link> : null}<a className="btn teal" href={`/admin/print/statement${qs ? `?${qs}` : ""}`} target="_blank" rel="noopener">🖨 Print statement</a></div> : null}
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
            {mine && mine.journal.size ? <div className="stat"><div className="k">Journal entries & vouchers · قيود وسندات (+/−)</div><div className="v" style={{ fontSize: "1.1rem" }}>{mapText(mine.journal, fmtMoney)}</div></div> : null}
            <div className="stat"><div className="k">Balance due · الرصيد المستحق</div><div className="v" style={{ fontSize: "1.1rem", color: "#b42318" }}>{mine ? mapText(mine.balance, fmtMoney) : "—"}</div></div>
            <div className="stat"><div className="k">Payments awaiting confirmation · قيد التأكيد</div><div className="v" style={{ fontSize: "1.1rem" }}>{mine ? mapText(mine.pending, fmtMoney) : "—"}</div></div>
          </div>
          {!staff ? (
            <section className="panel" id="send-payment">
              <h2>💳 Send a payment to RUKN · إرسال دفعة للشركة</h2>
              <p className="small muted" style={{ marginTop: -6 }}>
                {owes.length ? <>You owe RUKN <strong style={{ color: "#b42318" }}>{owes.map(([c, v]) => fmtMoney(v, c)).join(" · ")}</strong>. </> : <>You have no open balance — you can still send an <strong>advance payment</strong>. </>}
                Choose an invoice, or leave it empty for a payment on account / advance. Attach the transfer receipt; the finance team confirms it and issues the official receipt.
              </p>
              <PaymentNoticeForm agentId={agent} invoices={openInvoices} defaultCurrency={owes[0]?.[0] ?? openInvoices[0]?.currency ?? "USD"} currencies={await loadCurrencies()} />
            </section>
          ) : null}

          {groupByCurrency(st.lines, st.opening).map((g) => {
            const dr = g.lines.reduce((a, l) => a + l.debit, 0); const cr = g.lines.reduce((a, l) => a + l.credit, 0);
            const closing = g.lines.length ? g.lines[g.lines.length - 1].balance : g.opening;
            return (
          <section className="panel" key={g.currency}>
            <h2>Movements in {g.currency} · حركات الحساب — {CURRENCY_AR[g.currency] ?? g.currency}</h2>
            <div className="table-scroll">
              <table className="data">
                <thead><tr><th>Date</th><th>Document</th><th>Case</th><th className="num">Debit · مدين</th><th className="num">Credit · دائن</th><th className="num">Balance · الرصيد</th></tr></thead>
                <tbody>
                  {g.opening ? <tr><td className="small">{sp.from ? fmtDay(sp.from) : ""}</td><td colSpan={4}><strong>Opening balance · رصيد سابق</strong></td><td className="num"><strong>{fmtMoney(g.opening, g.currency)}</strong></td></tr> : null}
                  {g.lines.map((l) => (
                    <tr key={`${l.kind}-${l.doc_id}-${l.currency}`}>
                      <td className="small nowrap">{fmtDay(l.date)}</td>
                      <td className="mono" style={{ maxWidth: 340 }}>{l.kind === "invoice" ? <Link href={`/admin/cases/${l.case_id}/invoices/${l.doc_id}`}>{l.doc}</Link> : l.kind === "journal" ? <a href={`/admin/print/journal/${l.doc_id}`} target="_blank" rel="noopener">{l.doc}</a> : l.kind === "voucher" ? <a href={`/admin/print/cash/${l.doc_id}`} target="_blank" rel="noopener">{l.doc}</a> : <a href={`/admin/print/payment/${l.doc_id}`} target="_blank" rel="noopener">{l.doc}</a>}{l.note ? <div className="small muted" style={{ fontFamily: "inherit", whiteSpace: "normal" }}>{l.note}</div> : null}</td>
                      <td className="small">{l.case_id ? <><Link className="mono" href={`/admin/cases/${l.case_id}`}>{l.code}</Link><div>{l.clinic}</div></> : "—"}</td>
                      <td className="num nowrap">{l.debit ? fmtMoney(l.debit, l.currency) : ""}</td>
                      <td className="num nowrap" style={{ color: "#067647" }}>{l.credit ? fmtMoney(l.credit, l.currency) : ""}</td>
                      <td className="num nowrap"><strong>{fmtMoney(l.balance, l.currency)}</strong></td>
                    </tr>
                  ))}
                  <tr className="total-row"><td /><td colSpan={2}><strong>Total · الإجمالي ({g.currency})</strong></td><td className="num nowrap"><strong>{fmtMoney(dr, g.currency)}</strong></td><td className="num nowrap"><strong>{fmtMoney(cr, g.currency)}</strong></td><td className="num nowrap"><strong style={{ color: closing > 0 ? "#b42318" : "#067647" }}>{fmtMoney(closing, g.currency)}</strong></td></tr>
                </tbody>
              </table>
            </div>
          </section>
            );
          })}
          {st.lines.length === 0 && !st.opening.size ? <section className="panel"><p className="small muted">No invoices, payments or journal entries in this period.</p></section> : null}
          <section className="panel">
            <h2>{staff ? "Payment notices of this agent" : "Your payment notices"} · إشعارات الدفع</h2>
            <NoticesTable notices={recentNotices} staff={staff} boxes={(boxes ?? []) as { id: string; name: string; currency: string }[]} showCase
              caseCodes={new Map((nCase ?? []).map((c) => [c.id as string, c.code as string]))} invoiceNos={new Map((nInv ?? []).map((i) => [i.id as string, i.invoice_no as string]))}
              receiptNos={new Map((nPay ?? []).map((p) => [p.id as string, { no: p.receipt_no as string, id: p.id as string }]))} names={new Map([...people.entries()].map(([k, v]) => [k, v.name]))}
              aiEnabled={staff && isAiConfigured()} />
            {olderNotices.length ? <p className="small muted" style={{ marginTop: 8 }}>+ {olderNotices.length} older notice(s) — see each case page or the receipts in the statement.</p> : null}
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
