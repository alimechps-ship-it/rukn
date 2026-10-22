import { redirect } from "next/navigation";
import { can, getStaffUser } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { profileMap } from "@/lib/case-data";
import { fmtDay, fmtMoney } from "@/lib/cases";
import { loadStatements, mapText } from "@/lib/statement";
import { PrintShell } from "../PrintShell";
import { loadCompany } from "../company";

export const metadata = { title: "Account statement", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function PrintStatement({ searchParams }: { searchParams: Promise<{ agent?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const user = await getStaffUser();
  if (!user) redirect("/admin/login?next=/admin/statement");
  if (!can.finance(user) && !(can.cases(user) && !can.caseStaff(user))) redirect("/admin?denied=1");
  const staff = can.finance(user);
  const agent = staff ? (sp.agent && /^[0-9a-f-]{36}$/i.test(sp.agent) ? sp.agent : null) : user.id;
  if (!agent) redirect("/admin/statement");
  const db = await createSessionClient();
  const [st, company] = await Promise.all([loadStatements(db, { agent, from: sp.from, to: sp.to }), loadCompany(db)]);
  const people = await profileMap(db, [agent, user.id]);
  const a = people.get(agent);
  const t = st.totals.find((x) => x.agent === agent);
  const period = `${st.from ? fmtDay(st.from) : "Start"} → ${st.to ? fmtDay(st.to) : "Today"}`;
  const qs = new URLSearchParams(Object.entries({ agent: staff ? agent : "", from: sp.from ?? "", to: sp.to ?? "" }).filter(([, v]) => v)).toString();
  return (
    <PrintShell back={`/admin/statement${qs ? `?${qs}` : ""}`} company={company} docRef={`Statement · ${a?.name ?? ""}`}>
      <div className="doc-title">
        <h1>Account Statement<span className="ar">كشف حساب مندوب</span></h1>
        <div className="doc-no"><div className="date"><strong>{a?.name}</strong>{a?.organization ? ` · ${a.organization}` : ""}</div><div className="date">{a?.country ?? ""}{a?.phone ? <> · <bdi dir="ltr">{a.phone}</bdi></> : null}</div><div className="date">{period}</div></div>
      </div>
      <div className="stats">
        <div className="s"><b style={{ fontSize: "11pt" }}>{t ? mapText(t.invoiced, fmtMoney) : "—"}</b><span>Invoiced · المفوتر</span></div>
        <div className="s"><b style={{ fontSize: "11pt", color: "#067647" }}>{t ? mapText(t.paid, fmtMoney) : "—"}</b><span>Paid · المدفوع</span></div>
        <div className="s"><b style={{ fontSize: "11pt", color: "#b42318" }}>{t ? mapText(t.balance, fmtMoney) : "—"}</b><span>Balance due · الرصيد المستحق</span></div>
        <div className="s"><b style={{ fontSize: "11pt" }}>{t ? mapText(t.pending, fmtMoney) : "—"}</b><span>Awaiting confirmation · قيد التأكيد</span></div>
      </div>
      <table className="t">
        <thead><tr><th>Date · التاريخ</th><th>Document · المستند</th><th>Case · الحالة</th><th className="num">Debit · مدين</th><th className="num">Credit · دائن</th><th className="num">Balance · الرصيد</th></tr></thead>
        <tbody>
          {st.opening.size ? <tr><td>{st.from ? fmtDay(st.from) : ""}</td><td colSpan={4}><strong>Opening balance · رصيد سابق</strong></td><td className="num"><strong>{mapText(st.opening, fmtMoney)}</strong></td></tr> : null}
          {st.lines.map((l) => (
            <tr key={`${l.kind}-${l.doc_id}`}>
              <td style={{ whiteSpace: "nowrap" }}>{fmtDay(l.date)}</td>
              <td style={{ fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap" }}>{l.doc}<div style={{ fontFamily: "inherit", fontSize: "8pt", color: "#526173" }}>{l.kind === "invoice" ? "Invoice · فاتورة" : l.kind === "adjustment" ? "Adjustment · تسوية" : "Payment · سداد"}{l.note ? ` · ${l.note}` : ""}</div></td>
              <td>{l.code}<div style={{ fontSize: "8.5pt", color: "#526173" }}>{l.clinic}</div></td>
              <td className="num">{l.debit ? fmtMoney(l.debit, l.currency) : ""}</td>
              <td className="num">{l.credit ? fmtMoney(l.credit, l.currency) : ""}</td>
              <td className="num"><strong>{fmtMoney(l.balance, l.currency)}</strong></td>
            </tr>
          ))}
          {st.lines.length === 0 ? <tr><td colSpan={6} style={{ textAlign: "center" }}>No movements in this period.</td></tr> : null}
        </tbody>
      </table>
      <div className="note">Payments awaiting confirmation are not included in the balance until RUKN confirms them. · الدفعات قيد التأكيد لا تُحتسب في الرصيد حتى تأكيدها.</div>
      <div className="sign two">
        <div>For RUKN · عن ركن<br /><strong style={{ color: "#1d2939" }}>{people.get(user.id)?.name}</strong></div>
        <div>Agent acknowledgement · إقرار المندوب<br /><strong style={{ color: "#1d2939" }}>{a?.name}</strong></div>
      </div>
    </PrintShell>
  );
}
