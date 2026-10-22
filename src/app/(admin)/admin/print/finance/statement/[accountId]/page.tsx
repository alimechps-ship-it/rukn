import { notFound, redirect } from "next/navigation";
import { can, getStaffUser } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { fmtDay } from "@/lib/cases";
import { ALL_CATEGORIES, CASH_KINDS, loadStatement, teamPeople } from "@/lib/finance";
import { PrintShell } from "../../../PrintShell";
import { loadCompany } from "../../../company";

export const metadata = { title: "Cash statement", robots: { index: false } };
export const dynamic = "force-dynamic";
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function PrintStatement({ params, searchParams }: { params: Promise<{ accountId: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { accountId } = await params;
  const sp = await searchParams;
  const user = await getStaffUser();
  if (!user) redirect("/admin/login?next=/admin/finance/cash");
  if (!can.caseStaff(user)) redirect("/admin?denied=1");
  const db = await createSessionClient();
  const [st, { names }, company] = await Promise.all([loadStatement(db, accountId, sp.from, sp.to), teamPeople(db), loadCompany(db)]);
  if (!st) notFound();
  const a = st.account;
  const period = `${st.from ? fmtDay(st.from) : "Start"} → ${st.to ? fmtDay(st.to) : "Today"}`;
  return (
    <PrintShell back={`/admin/finance/cash/${a.id}`} company={company} docRef={`Statement · ${a.name}`}>
      <div className="doc-title">
        <h1>Cash Statement<span className="ar">كشف حساب صندوق</span></h1>
        <div className="doc-no"><div className="date"><strong>{a.name}</strong> · {CASH_KINDS[a.kind]?.en} · {a.currency}</div><div className="date">{period}</div></div>
      </div>
      <div className="stats">
        <div className="s"><b>{fmt(st.opening)}</b><span>Opening · رصيد أول المدة</span></div>
        <div className="s"><b style={{ color: "#067647" }}>{fmt(st.totalIn)}</b><span>In · وارد</span></div>
        <div className="s"><b style={{ color: "#b42318" }}>{fmt(st.totalOut)}</b><span>Out · منصرف</span></div>
        <div className="s"><b>{fmt(st.closing)}</b><span>Closing · الرصيد ({a.currency})</span></div>
      </div>
      <table className="t">
        <thead><tr><th>Date</th><th>Voucher</th><th>Type / person · البيان</th><th className="num">In · وارد</th><th className="num">Out · منصرف</th><th className="num">Balance · الرصيد</th></tr></thead>
        <tbody>
          <tr><td>{st.from ? fmtDay(st.from) : ""}</td><td /><td><strong>Opening balance · رصيد أول المدة</strong></td><td /><td /><td className="num"><strong>{fmt(st.opening)}</strong></td></tr>
          {st.entries.map((e) => (
            <tr key={e.id} style={e.voided ? { color: "#9aa5b1", textDecoration: "line-through" } : undefined}>
              <td style={{ whiteSpace: "nowrap" }}>{fmtDay(e.entry_date)}</td>
              <td style={{ fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap" }}>{e.entry_no}</td>
              <td>{ALL_CATEGORIES[e.category]?.en}{e.party_user || e.party_name ? ` — ${e.party_user ? names.get(e.party_user) : e.party_name}` : ""}{e.description ? <div style={{ color: "#526173", fontSize: "8.5pt" }}>{e.description}</div> : null}</td>
              <td className="num">{e.direction === "in" ? fmt(Number(e.amount)) : ""}</td>
              <td className="num">{e.direction === "out" ? fmt(Number(e.amount)) : ""}</td>
              <td className="num">{st.running.has(e.id) ? fmt(st.running.get(e.id)!) : "void"}</td>
            </tr>
          ))}
          <tr><td /><td /><td><strong>Totals · الإجمالي</strong></td><td className="num"><strong>{fmt(st.totalIn)}</strong></td><td className="num"><strong>{fmt(st.totalOut)}</strong></td><td className="num"><strong>{fmt(st.closing)}</strong></td></tr>
        </tbody>
      </table>
      <div className="sign">
        <div>Cashier · أمين الصندوق<br /><strong style={{ color: "#1d2939" }}>{a.custodian ? names.get(a.custodian) : ""}</strong></div>
        <div>Reviewed by · المراجع</div>
        <div>Approved by · اعتماد</div>
      </div>
    </PrintShell>
  );
}
