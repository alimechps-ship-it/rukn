import Link from "next/link";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { fmtMoney } from "@/lib/cases";
import { mm, PARTNER_KINDS, partnerBalances, type Partner } from "@/lib/partners";
import { PartnerForm } from "./PartnerParts";

export const metadata = { title: "Planners & labs" };

export default async function PartnersPage() {
  const user = await requireStaff(can.caseStaff);
  const fin = can.finance(user);
  const db = await createSessionClient();
  const [{ data }, bal, { data: users }] = await Promise.all([
    db.from("partners").select("*").order("kind").order("name"),
    fin ? partnerBalances(db) : Promise.resolve(new Map() as Awaited<ReturnType<typeof partnerBalances>>),
    db.from("profiles").select("partner_id").not("partner_id", "is", null),
  ]);
  const partners = (data ?? []) as Partner[];
  const logins = new Map<string, number>();
  for (const u of users ?? []) logins.set(u.partner_id as string, (logins.get(u.partner_id as string) ?? 0) + 1);
  return (
    <>
      <div className="topbar"><div><h1>Planners & labs · المخططون والمعامل</h1><div className="sub">{fin ? "External treatment-planning doctors / clinics and production labs: bills and what RUKN owes them." : "External treatment-planning doctors / clinics and production labs that receive work orders."}</div></div></div>
      {Object.entries(PARTNER_KINDS).map(([kind, k]) => {
        const list = partners.filter((p) => p.kind === kind);
        return (
          <section className="panel" key={kind}>
            <h2>{k.en}s · {k.ar}</h2>
            {list.length ? (
              <div className="table-scroll">
                <table className="data">
                  <thead><tr><th>Name</th><th>Contact</th>{fin ? <><th className="num">Open orders</th><th className="num">Done, not billed</th><th className="num">Bills awaiting review</th><th className="num">RUKN owes</th></> : null}<th className="num">Logins</th></tr></thead>
                  <tbody>
                    {list.map((p) => {
                      const b = bal.get(p.id);
                      return (
                        <tr key={p.id} className="row-link" style={p.active ? undefined : { opacity: 0.5 }}>
                          <td><Link className="stretched" href={`/admin/partners/${p.id}`}><strong>{p.name}</strong></Link><div className="small muted">{[p.city, p.country].filter(Boolean).join(", ")}</div></td>
                          <td className="small">{p.contact_name}<div className="muted">{p.phone}</div></td>
                          {fin ? <>
                          <td className="num">{b?.openOrders ?? 0}</td>
                          <td className="num small">{mm(b?.unbilled, fmtMoney)}</td>
                          <td className="num small">{mm(b?.pending, fmtMoney)}</td>
                          <td className="num"><strong style={{ color: "#b42318" }}>{mm(b?.owed, fmtMoney)}</strong></td>
                          </> : null}
                          <td className="num">{logins.get(p.id) ?? 0}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <p className="small muted">None yet.</p>}
          </section>
        );
      })}
      <section className="panel">
        <details>
          <summary><strong>+ Add a planner or lab · إضافة شريك</strong></summary>
          <PartnerForm />
        </details>
        <p className="small muted">To give them a login: Users & roles → Add user → role <em>Treatment planner</em> or <em>Production lab</em> → choose the partner.</p>
      </section>
    </>
  );
}
