import Link from "next/link";
import { redirect } from "next/navigation";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { fmtDay, fmtMoney, PAYMENT_METHODS } from "@/lib/cases";
import { mm, partnerBalances, partnerStatement } from "@/lib/partners";

export const metadata = { title: "Statement" };

export default async function PartnerStatementPage({ searchParams }: { searchParams: Promise<{ partner?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const user = await requireStaff((u) => can.finance(u) || can.partner(u));
  const staff = can.finance(user);
  const db = await createSessionClient();
  let partnerId = sp.partner && /^[0-9a-f-]{36}$/i.test(sp.partner) ? sp.partner : null;
  if (!staff) { const { data: me } = await db.from("profiles").select("partner_id").eq("id", user.id).single(); partnerId = me?.partner_id ?? null; }
  if (!partnerId) redirect(staff ? "/admin/partners" : "/admin/work");
  const [{ data: partner }, st, bal] = await Promise.all([
    db.from("partners").select("id,name,currency").eq("id", partnerId).single(),
    partnerStatement(db, partnerId, sp.from, sp.to),
    partnerBalances(db, partnerId),
  ]);
  const b = bal.get(partnerId);
  const qs = new URLSearchParams(Object.entries({ partner: staff ? partnerId : "", from: sp.from ?? "", to: sp.to ?? "" }).filter(([, v]) => v)).toString();
  return (
    <>
      <div className="topbar">
        <div>
          {staff ? <div className="small"><Link href={`/admin/partners/${partnerId}`}>← {partner?.name}</Link></div> : null}
          <h1>Statement · كشف حساب — {partner?.name}</h1>
          <div className="sub">Approved bills (amounts RUKN owes) and payments made by RUKN.</div>
        </div>
        <div className="btn-row"><a className="btn teal" href={`/admin/print/partner-statement${qs ? `?${qs}` : ""}`} target="_blank" rel="noopener">🖨 Print statement</a></div>
      </div>
      <section className="panel tight">
        <form className="filters" method="get">
          {staff ? <input type="hidden" name="partner" value={partnerId} /> : null}
          <div className="field"><label htmlFor="ps-from">From</label><input id="ps-from" type="date" name="from" defaultValue={sp.from ?? ""} /></div>
          <div className="field"><label htmlFor="ps-to">To</label><input id="ps-to" type="date" name="to" defaultValue={sp.to ?? ""} /></div>
          <button className="btn" type="submit">Apply</button>
        </form>
      </section>
      <div className="stats">
        <div className="stat"><div className="k">Approved bills · فواتير معتمدة</div><div className="v" style={{ fontSize: "1.05rem", paddingTop: 6 }}>{mm(b?.approved, fmtMoney)}</div></div>
        <div className="stat"><div className="k">Paid by RUKN · المدفوع</div><div className="v" style={{ fontSize: "1.05rem", paddingTop: 6, color: "#067647" }}>{mm(b?.paid, fmtMoney)}</div></div>
        <div className="stat"><div className="k">Balance due to you · الرصيد المستحق</div><div className="v" style={{ fontSize: "1.05rem", paddingTop: 6, color: "#b42318" }}>{mm(b?.owed, fmtMoney)}</div></div>
        <div className="stat"><div className="k">Bills awaiting review</div><div className="v" style={{ fontSize: "1.05rem", paddingTop: 6 }}>{mm(b?.pending, fmtMoney)}</div></div>
      </div>
      <section className="panel">
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Date</th><th>Document</th><th>Reference</th><th className="num">Billed · فواتير</th><th className="num">Paid · مدفوع</th><th className="num">Balance · الرصيد</th></tr></thead>
            <tbody>
              {st.opening.size ? <tr><td /><td colSpan={4}><strong>Opening balance</strong></td><td className="num"><strong>{mm(st.opening, fmtMoney)}</strong></td></tr> : null}
              {st.lines.length === 0 ? <tr><td colSpan={6} className="empty">No approved bills or payments in this period.</td></tr> : null}
              {st.lines.map((l) => (
                <tr key={`${l.kind}-${l.id}`}>
                  <td className="small nowrap">{fmtDay(l.date)}</td>
                  <td className="mono nowrap"><a href={l.kind === "bill" ? `/admin/print/partner-bill/${l.id}` : l.kind === "refund" ? `/admin/print/cash/${l.id}` : l.kind === "journal" ? `/admin/print/journal/${l.id}` : `/admin/print/partner-payment/${l.id}`} target="_blank" rel="noopener">{l.doc}</a><div className="small muted">{l.kind === "bill" ? "Bill" : l.kind === "refund" ? "Returned to RUKN · مرتجع" : l.kind === "journal" ? (l.note ?? "Journal entry") : `Payment · ${PAYMENT_METHODS[l.note ?? ""]?.en ?? ""}`}</div></td>
                  <td className="small">{l.ref ?? ""}</td>
                  <td className="num nowrap">{l.billed ? fmtMoney(l.billed, l.currency) : ""}</td>
                  <td className="num nowrap" style={{ color: "#067647" }}>{l.paid ? fmtMoney(l.paid, l.currency) : ""}</td>
                  <td className="num nowrap"><strong>{fmtMoney(l.balance, l.currency)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
