import { redirect } from "next/navigation";
import { can, getStaffUser } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { fmtDay, fmtMoney } from "@/lib/cases";
import { mm, PARTNER_KINDS, partnerStatement } from "@/lib/partners";
import { CURRENCY_AR, groupByCurrency } from "@/lib/currency-groups";
import { PrintShell } from "../PrintShell";
import { loadCompany } from "../company";

export const metadata = { title: "Partner statement", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function PrintPartnerStatement({ searchParams }: { searchParams: Promise<{ partner?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const user = await getStaffUser();
  if (!user) redirect("/admin/login");
  if (!can.finance(user) && !can.partner(user)) redirect("/admin?denied=1");
  const db = await createSessionClient();
  let partnerId = sp.partner && /^[0-9a-f-]{36}$/i.test(sp.partner) ? sp.partner : null;
  if (!can.finance(user)) { const { data: me } = await db.from("profiles").select("partner_id").eq("id", user.id).single(); partnerId = me?.partner_id ?? null; }
  if (!partnerId) redirect("/admin");
  const [{ data: partner }, st, company] = await Promise.all([db.from("partners").select("*").eq("id", partnerId).single(), partnerStatement(db, partnerId, sp.from, sp.to), loadCompany(db)]);
  const period = `${st.from ? fmtDay(st.from) : "Start"} → ${st.to ? fmtDay(st.to) : "Today"}`;
  return (
    <PrintShell back="/admin/partner-statement" company={company} docRef={`Statement · ${partner?.name}`}>
      <div className="doc-title">
        <h1>Partner Statement<span className="ar">كشف حساب مورد — {PARTNER_KINDS[partner?.kind ?? "lab"]?.ar}</span></h1>
        <div className="doc-no"><div className="date"><strong>{partner?.name}</strong></div><div className="date">{period}</div></div>
      </div>
      <div className="stats" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="s"><b style={{ fontSize: "11pt" }}>{mm(st.totals.billed, fmtMoney)}</b><span>Approved bills · فواتير معتمدة</span></div>
        <div className="s"><b style={{ fontSize: "11pt", color: "#067647" }}>{mm(st.totals.paid, fmtMoney)}</b><span>Paid by RUKN · المدفوع</span></div>
        <div className="s"><b style={{ fontSize: "11pt", color: "#b42318" }}>{mm(st.closing, fmtMoney)}</b><span>Balance due · الرصيد المستحق</span></div>
      </div>
      {groupByCurrency(st.lines, st.opening).map((g) => {
        const bi = g.lines.reduce((a, l) => a + l.billed, 0); const pa = g.lines.reduce((a, l) => a + l.paid, 0);
        const closing = g.lines.length ? g.lines[g.lines.length - 1].balance : g.opening;
        return (
      <div className="section" key={g.currency}>
      <h2 style={{ margin: "10px 0 4px", fontSize: "11pt" }}>{g.currency} account · <span className="ar">الحساب — {CURRENCY_AR[g.currency] ?? g.currency}</span></h2>
      <table className="t">
        <thead><tr><th>Date</th><th>Document</th><th>Reference</th><th className="num">Billed · دائن</th><th className="num">Paid · مدين</th><th className="num">Balance · الرصيد</th></tr></thead>
        <tbody>
          {g.opening ? <tr><td /><td colSpan={4}><strong>Opening balance · رصيد سابق</strong></td><td className="num"><strong>{fmtMoney(g.opening, g.currency)}</strong></td></tr> : null}
          {g.lines.map((l) => (
            <tr key={`${l.kind}-${l.id}-${l.currency}`}>
              <td style={{ whiteSpace: "nowrap" }}>{fmtDay(l.date)}</td>
              <td style={{ fontFamily: "ui-monospace, monospace", maxWidth: 260 }}><span style={{ whiteSpace: "nowrap" }}>{l.doc}</span><div style={{ fontFamily: "\"Inter Variable\", \"IBM Plex Sans Arabic\", sans-serif", fontSize: "8pt", color: "#526173", whiteSpace: "normal" }}>{l.kind === "bill" ? "Bill · فاتورة" : l.kind === "refund" ? "Returned · مرتجع" : l.kind === "journal" ? (l.note ?? "Journal · قيد") : "Payment · سداد"}</div></td>
              <td>{l.ref ?? ""}</td>
              <td className="num">{l.billed ? fmtMoney(l.billed, l.currency) : ""}</td>
              <td className="num">{l.paid ? fmtMoney(l.paid, l.currency) : ""}</td>
              <td className="num"><strong>{fmtMoney(l.balance, l.currency)}</strong></td>
            </tr>
          ))}
          <tr><td /><td colSpan={2}><strong>Total · الإجمالي</strong></td><td className="num"><strong>{fmtMoney(bi, g.currency)}</strong></td><td className="num"><strong>{fmtMoney(pa, g.currency)}</strong></td><td className="num"><strong>{fmtMoney(closing, g.currency)}</strong></td></tr>
        </tbody>
      </table>
      </div>
        );
      })}
      {st.lines.length === 0 && !st.opening.size ? <p style={{ textAlign: "center" }}>No movements in this period.</p> : null}
      <div className="sign two"><div>For RUKN · عن ركن</div><div>Partner acknowledgement · إقرار المورد<br /><strong style={{ color: "#1d2939" }}>{partner?.name}</strong></div></div>
    </PrintShell>
  );
}
