import { redirect } from "next/navigation";
import { can, getStaffUser } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { fmtDay } from "@/lib/cases";
import { accountsWithBalance, ALL_CATEGORIES, loadPeople, netMap, teamPeople } from "@/lib/finance";
import { PrintShell } from "../../PrintShell";
import { loadCompany } from "../../company";

export const metadata = { title: "Person accounts", robots: { index: false } };
export const dynamic = "force-dynamic";
const fmt = (n: number, c: string) => `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;
const mm = (m: Map<string, number>) => (m.size ? [...m.entries()].map(([c, v]) => fmt(v, c)).join(" · ") : "—");

export default async function PrintPeople({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; p?: string }> }) {
  const sp = await searchParams;
  const user = await getStaffUser();
  if (!user) redirect("/admin/login?next=/admin/finance/people");
  if (!can.caseStaff(user)) redirect("/admin?denied=1");
  const db = await createSessionClient();
  const [{ people: list, from, to }, { names }, accounts, company] = await Promise.all([loadPeople(db, sp.from, sp.to), teamPeople(db), accountsWithBalance(db), loadCompany(db)]);
  const accName = new Map(accounts.map((a) => [a.id, a.name]));
  const label = (p: { user: string | null; name: string | null }) => (p.user ? names.get(p.user) ?? "Team member" : p.name ?? "—");
  const sel = sp.p ? list.find((x) => x.key === sp.p) : undefined;
  const period = `${from ? fmtDay(from) : "Start"} → ${to ? fmtDay(to) : "Today"}`;
  return (
    <PrintShell back={`/admin/finance/people${sp.p ? `?p=${encodeURIComponent(sp.p)}` : ""}`} company={company} docRef={sel ? `Account · ${label(sel)}` : "Person accounts"}>
      <div className="doc-title">
        <h1>{sel ? "Person Account" : "Person Accounts"}<span className="ar">{sel ? "كشف حساب شخص" : "حسابات الأشخاص (العهد والمسحوبات)"}</span></h1>
        <div className="doc-no">{sel ? <div className="date"><strong>{label(sel)}</strong></div> : null}<div className="date">{period}</div></div>
      </div>
      {sel ? (
        <>
          <div className="stats">
            <div className="s"><b style={{ fontSize: "11pt" }}>{mm(sel.taken)}</b><span>Took · أخذ</span></div>
            <div className="s"><b style={{ fontSize: "11pt" }}>{mm(sel.returned)}</b><span>Returned · رد</span></div>
            <div className="s"><b style={{ fontSize: "11pt" }}>{mm(netMap(sel.taken, sel.returned))}</b><span>Net · الصافي</span></div>
            <div className="s"><b>{sel.entries.length}</b><span>Vouchers · السندات</span></div>
          </div>
          <table className="t">
            <thead><tr><th>Date</th><th>Voucher</th><th>Box</th><th>Type · البيان</th><th className="num">Took · أخذ</th><th className="num">Returned · رد</th></tr></thead>
            <tbody>
              {sel.entries.map((e) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDay(e.entry_date)}</td>
                  <td style={{ fontFamily: "ui-monospace, monospace" }}>{e.entry_no}</td>
                  <td>{accName.get(e.account_id)}</td>
                  <td>{ALL_CATEGORIES[e.category]?.en} · <span className="ar">{ALL_CATEGORIES[e.category]?.ar}</span>{e.description ? <div style={{ color: "#526173", fontSize: "8.5pt" }}>{e.description}</div> : null}</td>
                  <td className="num">{e.direction === "out" ? fmt(Number(e.amount), e.currency) : ""}</td>
                  <td className="num">{e.direction === "in" ? fmt(Number(e.amount), e.currency) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="sign two"><div>Acknowledged by · إقرار المستلم<br /><strong style={{ color: "#1d2939" }}>{label(sel)}</strong></div><div>Approved by · اعتماد</div></div>
        </>
      ) : (
        <>
          <table className="t">
            <thead><tr><th>Person · الشخص</th><th className="num">Took · أخذ</th><th className="num">Returned · رد</th><th className="num">Net · الصافي</th><th className="num">Vouchers</th></tr></thead>
            <tbody>{list.map((p) => <tr key={p.key}><td><strong>{label(p)}</strong></td><td className="num">{mm(p.taken)}</td><td className="num">{mm(p.returned)}</td><td className="num"><strong>{mm(netMap(p.taken, p.returned))}</strong></td><td className="num">{p.entries.length}</td></tr>)}</tbody>
          </table>
          <div className="sign two"><div>Prepared by · أعدّه</div><div>Approved by · اعتماد</div></div>
        </>
      )}
    </PrintShell>
  );
}
