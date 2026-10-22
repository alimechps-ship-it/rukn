import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { AdjustmentForm, type AdjAccount, type AdjDoc } from "@/components/admin/AdjustmentForm";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { peopleWithRole, profileMap } from "@/lib/case-data";
import { fmtDay, fmtMoney } from "@/lib/cases";
import { ADJ_KINDS, EFFECT_LABEL, type Adjustment } from "@/lib/adjustments";
import { loadReceivables, voucherParties } from "@/lib/finance";
import { loadRates } from "@/lib/fx";
import { createAdjustment, createOffset, voidAdjustment } from "../../_actions/adjustments";

export const metadata = { title: "Adjustments" };

export default async function AdjustmentsPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; agent?: string; partner?: string }> }) {
  const sp = await searchParams;
  await requireStaff(can.finance);
  const db = await createSessionClient();
  const [agents, parties, rec, rates, { data: rows }] = await Promise.all([
    peopleWithRole(db, ["agent"]),
    voucherParties(db),
    loadReceivables(db, {}),
    loadRates(db),
    db.from("account_adjustments").select("*").order("created_at", { ascending: false }).limit(500),
  ]);
  const accounts: AdjAccount[] = [
    ...agents.map((a) => ({ key: `agent:${a.id}`, type: "agent" as const, id: a.id, name: a.name, sub: a.label.replace(a.name, "").replace(/^ · /, ""), badge: "Agent · مندوب", currency: null })),
    ...parties.partners.filter((p) => p.active).map((p) => ({ key: `partner:${p.id}`, type: "partner" as const, id: p.id, name: p.name, sub: [p.contact, p.phone, p.city].filter(Boolean).join(" · "), badge: p.kind === "lab" ? "Lab · معمل" : "Clinic · عيادة", currency: p.currency })),
  ];
  const docs: AdjDoc[] = [
    ...rec.rows.map((r) => ({ id: r.invoice_id, key: `agent:${r.agent_id}`, no: r.invoice_no, currency: r.currency, due: r.balance, label: `${r.invoice_no} · ${r.code} · due ${fmtMoney(r.balance, r.currency)}` })),
    ...parties.bills.map((b) => ({ id: b.id, key: `partner:${b.partner_id}`, no: b.bill_no, currency: b.currency, due: b.due, label: `${b.bill_no} · due ${fmtMoney(b.due, b.currency)}` })),
  ];
  const all = (rows ?? []) as Adjustment[];
  const nameOf = (a: Adjustment) => (a.party_type === "agent" ? agents.find((x) => x.id === a.agent_id)?.name : parties.partners.find((x) => x.id === a.partner_id)?.name) ?? "—";
  const q = (sp.q ?? "").trim().toLowerCase();
  const list = all.filter((a) => (!sp.kind || a.kind === sp.kind) && (!q || [a.adj_no, nameOf(a), a.description, a.reference].some((v) => v?.toLowerCase().includes(q))));
  const people = await profileMap(db, all.map((a) => a.created_by));
  const preset = sp.agent ? `agent:${sp.agent}` : sp.partner ? `partner:${sp.partner}` : undefined;

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Adjustments · التسويات</h1>
          <div className="sub">Discounts allowed and earned, additions for other services, currency differences and offsets between accounts — without cash. Each is numbered (AJ-), printable, appears in the agent / partner statement, and when linked to an invoice or bill changes its balance too.</div>
        </div>
      </div>

      <section className="panel">
        <h2>New · جديد</h2>
        <AdjustmentForm adjust={createAdjustment} offset={createOffset} kinds={ADJ_KINDS} accounts={accounts} docs={docs} perUsd={Object.fromEntries(rates.map((r) => [r.currency, r.per_usd]))} preset={preset} />
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Adjustments · السجل ({list.length})</h2></div>
        <form className="voucher-search" method="get" role="search">
          <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Search: agent, lab, clinic, AJ- number, description… · ابحث" aria-label="Search adjustments" />
          <select name="kind" defaultValue={sp.kind ?? ""} aria-label="Type"><option value="">All types</option>{Object.entries(ADJ_KINDS).map(([k, d]) => <option key={k} value={k}>{d.ar} · {d.en}</option>)}</select>
          <button className="btn secondary" type="submit">Search · بحث</button>
          {sp.q || sp.kind ? <Link className="btn secondary" href="/admin/finance/adjustments">Clear</Link> : null}
        </form>
        {list.length ? (
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th>No.</th><th>Date</th><th>Type</th><th>Account</th><th>Effect</th><th className="num">Amount</th><th>Description</th><th /></tr></thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id} style={a.voided ? { opacity: 0.5 } : undefined}>
                    <td className="mono nowrap">{a.adj_no}{a.voided ? <div><span className="pill closed">void</span></div> : null}</td>
                    <td className="small nowrap">{fmtDay(a.adj_date)}</td>
                    <td className="small">{ADJ_KINDS[a.kind]?.ar}<div className="muted">{ADJ_KINDS[a.kind]?.en}{a.offset_group ? " · paired" : ""}</div></td>
                    <td className="small">
                      {a.party_type === "agent" ? <Link href={`/admin/statement?agent=${a.agent_id}`}><strong>{nameOf(a)}</strong></Link> : <Link href={`/admin/partners/${a.partner_id}`}><strong>{nameOf(a)}</strong></Link>}
                      <div className="muted">{a.party_type === "agent" ? "agent · مندوب" : "lab / clinic · شريك"}</div>
                    </td>
                    <td className="small">{EFFECT_LABEL[a.party_type][a.effect].ar}</td>
                    <td className="num nowrap" style={{ color: a.effect === "decrease" ? "#067647" : "#b42318" }}>{a.effect === "decrease" ? "− " : "+ "}{fmtMoney(a.amount, a.currency)}{a.fx_rate ? <div className="small muted">rate {Number(a.fx_rate)}</div> : null}</td>
                    <td className="small">{a.description}{a.reference ? <div className="muted">Ref. {a.reference}</div> : null}{a.voided && a.void_reason ? <div className="muted">Void: {a.void_reason}</div> : null}<div className="muted">{people.get(a.created_by ?? "")?.name ?? ""}</div></td>
                    <td className="nowrap">
                      <a className="btn secondary small" href={`/admin/print/adjustment/${a.id}`} target="_blank" rel="noopener" title="Print">🖨</a>{" "}
                      {!a.voided ? (
                        <details className="inline-details" style={{ display: "inline-block" }}>
                          <summary className="btn danger small">Void</summary>
                          <ActionForm action={voidAdjustment} className="inline-form">
                            <input type="hidden" name="id" value={a.id} />
                            <input type="text" name="reason" placeholder="Reason for voiding" aria-label="Reason" maxLength={300} required />
                            <SubmitButton className="btn danger small">Void</SubmitButton>
                          </ActionForm>
                        </details>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="small muted">No adjustments{q || sp.kind ? " match" : " yet"}.</p>}
      </section>
    </>
  );
}
