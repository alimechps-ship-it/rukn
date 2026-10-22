import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { CASH_KINDS, loadStatement, teamPeople } from "@/lib/finance";
import { EntriesTable, NewEntryForm } from "../../CashForms";
import { accountsWithBalance } from "@/lib/finance";

export const metadata = { title: "Cash statement" };
const fmt = (n: number, c: string) => `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;

export default async function Statement({ params, searchParams }: { params: Promise<{ accountId: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { accountId } = await params;
  const sp = await searchParams;
  await requireStaff(can.caseStaff);
  const db = await createSessionClient();
  const st = await loadStatement(db, accountId, sp.from, sp.to);
  if (!st) notFound();
  const [{ people, names }, accounts] = await Promise.all([teamPeople(db), accountsWithBalance(db)]);
  const a = st.account;
  const qs = new URLSearchParams(Object.entries({ from: sp.from ?? "", to: sp.to ?? "" }).filter(([, v]) => v)).toString();
  return (
    <>
      <div className="topbar">
        <div>
          <div className="small"><Link href="/admin/finance/cash">← Cash boxes</Link></div>
          <h1>{a.name}</h1>
          <div className="sub">{CASH_KINDS[a.kind]?.en} · {a.currency}{a.custodian ? ` · custodian ${names.get(a.custodian) ?? ""}` : ""}</div>
        </div>
        <div className="btn-row"><a className="btn secondary" href={`/admin/print/finance/statement/${a.id}${qs ? `?${qs}` : ""}`} target="_blank" rel="noopener">🖨 Print statement · كشف حساب</a></div>
      </div>
      <section className="panel tight"><form className="filters" method="get">
        <div className="field"><label htmlFor="f-from">From</label><input id="f-from" type="date" name="from" defaultValue={sp.from ?? ""} /></div>
        <div className="field"><label htmlFor="f-to">To</label><input id="f-to" type="date" name="to" defaultValue={sp.to ?? ""} /></div>
        <div className="field" style={{ alignSelf: "end" }}><button className="btn" type="submit">Apply</button> <Link className="btn secondary" href={`/admin/finance/cash/${a.id}`}>Reset</Link></div>
      </form></section>
      <div className="stats">
        <div className="stat"><div className="k">Opening · رصيد أول المدة</div><div className="v" style={{ fontSize: "1.2rem" }}>{fmt(st.opening, a.currency)}</div></div>
        <div className="stat"><div className="k">Total in · وارد</div><div className="v" style={{ fontSize: "1.2rem", color: "#067647" }}>{fmt(st.totalIn, a.currency)}</div></div>
        <div className="stat"><div className="k">Total out · منصرف</div><div className="v" style={{ fontSize: "1.2rem", color: "#b42318" }}>{fmt(st.totalOut, a.currency)}</div></div>
        <div className="stat"><div className="k">Closing · الرصيد</div><div className="v" style={{ fontSize: "1.2rem" }}>{fmt(st.closing, a.currency)}</div></div>
      </div>
      <section className="panel">
        <h2>Statement · كشف الحساب</h2>
        <EntriesTable entries={st.entries} accounts={new Map([[a.id, { name: a.name, currency: a.currency }]])} people={people} names={names} running={st.running} />
      </section>
      {a.active ? (
        <div className="case-cols">
          <section className="panel"><h2>Payment / withdrawal · سند صرف</h2><NewEntryForm direction="out" accounts={accounts} people={people} defaultAccount={a.id} /></section>
          <section className="panel"><h2>Receipt · سند قبض</h2><NewEntryForm direction="in" accounts={accounts} people={people} defaultAccount={a.id} /></section>
        </div>
      ) : null}
    </>
  );
}
