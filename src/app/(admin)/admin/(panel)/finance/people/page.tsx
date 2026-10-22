import Link from "next/link";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { accountsWithBalance, ALL_CATEGORIES, loadPeople, netMap, teamPeople, voucherParties } from "@/lib/finance";
import { EntriesTable } from "../CashForms";

export const metadata = { title: "Person accounts" };
const fmt = (n: number, c: string) => `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;
const mm = (m: Map<string, number>) => (m.size ? [...m.entries()].map(([c, v]) => fmt(v, c)).join(" · ") : "—");

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; p?: string }> }) {
  const sp = await searchParams;
  await requireStaff(can.finance);
  const db = await createSessionClient();
  const [{ people: list }, { people, names }, accounts, parties] = await Promise.all([loadPeople(db, sp.from, sp.to), teamPeople(db), accountsWithBalance(db), voucherParties(db)]);
  const label = (p: { user: string | null; name: string | null }) => (p.user ? names.get(p.user) ?? "Team member" : p.name ?? "—");
  const sel = sp.p ? list.find((x) => x.key === sp.p) : undefined;
  const base = new URLSearchParams(Object.entries({ from: sp.from ?? "", to: sp.to ?? "" }).filter(([, v]) => v));
  const link = (key?: string) => { const q = new URLSearchParams(base); if (key) q.set("p", key); const s = q.toString(); return s ? `?${s}` : ""; };
  const accMap = new Map(accounts.map((a) => [a.id, { name: a.name, currency: a.currency }]));
  return (
    <>
      <div className="topbar">
        <div>
          <div className="small"><Link href="/admin/finance/cash">← Cash boxes</Link></div>
          <h1>Person accounts · حسابات الأشخاص</h1>
          <div className="sub">What each person took from the boxes (custody, withdrawals, salaries…) and what they returned. Net = still with the person / owed.</div>
        </div>
        <div className="btn-row"><a className="btn secondary" href={`/admin/print/finance/people${link(sel?.key)}`} target="_blank" rel="noopener">🖨 Print{sel ? " this account" : " summary"}</a></div>
      </div>
      <section className="panel tight"><form className="filters" method="get">
        <div className="field"><label htmlFor="pf-from">From</label><input id="pf-from" type="date" name="from" defaultValue={sp.from ?? ""} /></div>
        <div className="field"><label htmlFor="pf-to">To</label><input id="pf-to" type="date" name="to" defaultValue={sp.to ?? ""} /></div>
        {sp.p ? <input type="hidden" name="p" value={sp.p} /> : null}
        <div className="field" style={{ alignSelf: "end" }}><button className="btn" type="submit">Apply</button> <Link className="btn secondary" href="/admin/finance/people">Reset</Link></div>
      </form></section>
      <section className="panel">
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Person · الشخص</th><th className="num">Took · أخذ</th><th className="num">Returned · رد</th><th className="num">Net · الصافي</th><th className="num">Vouchers</th><th /></tr></thead>
            <tbody>
              {list.length === 0 ? <tr><td colSpan={6} className="empty">No voucher names a person yet. Choose the person when you record a payment voucher.</td></tr> : null}
              {list.map((p) => (
                <tr key={p.key} style={sel?.key === p.key ? { background: "#f2fafc" } : undefined}>
                  <td><strong>{label(p)}</strong>{p.user ? null : <span className="small muted"> (not a team member)</span>}</td>
                  <td className="num">{mm(p.taken)}</td>
                  <td className="num">{mm(p.returned)}</td>
                  <td className="num"><strong>{mm(netMap(p.taken, p.returned))}</strong></td>
                  <td className="num">{p.entries.length}</td>
                  <td><Link className="btn secondary small" href={`/admin/finance/people${link(p.key)}`}>Details</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {sel ? (
        <section className="panel">
          <h2>{label(sel)} — account details</h2>
          <div className="stats" style={{ marginTop: 0 }}>
            {[...sel.byCategory.entries()].map(([cat, m]) => <div key={cat} className="stat"><div className="k">{ALL_CATEGORIES[cat]?.en} · {ALL_CATEGORIES[cat]?.ar}</div><div className="v" style={{ fontSize: "1.05rem", paddingTop: 6 }}>{mm(m)}</div></div>)}
          </div>
          <EntriesTable entries={sel.entries} accounts={accMap} people={people} parties={parties} names={names} />
        </section>
      ) : null}
    </>
  );
}
