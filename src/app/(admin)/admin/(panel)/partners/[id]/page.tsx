import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { can, requireStaff } from "@/lib/auth";
import { docCredits } from "@/lib/journal";
import { createSessionClient } from "@/lib/admin";
import { fmtDay, fmtMoney, PAYMENT_METHODS } from "@/lib/cases";
import { costsFor, mm, PARTNER_KINDS, partnerBalances, type Partner, type WorkOrder } from "@/lib/partners";
import { payPartner, voidPartnerPayment } from "../../_actions/partners";
import { BillsTable, NewBillForm, PartnerForm, WorkOrdersTable, type Bill } from "../PartnerParts";
import { CurrencyField } from "@/components/admin/CurrencyField";

export const metadata = { title: "Partner" };

export default async function PartnerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaff(can.caseStaff);
  const fin = can.finance(user);
  const db = await createSessionClient();
  const { data: p } = await db.from("partners").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();
  const partner = p as Partner;
  const [{ data: orders }, { data: bills }, { data: pays }, { data: users }, { data: boxes }, bal, { data: billLines }] = await Promise.all([
    db.from("case_assignments").select("*").eq("partner_id", id).order("created_at", { ascending: false }),
    db.from("partner_bills").select("*").eq("partner_id", id).order("created_at", { ascending: false }),
    db.from("partner_payments").select("*").eq("partner_id", id).order("paid_at", { ascending: false }),
    db.from("profiles").select("id,full_name,email,is_active").eq("partner_id", id),
    fin ? db.from("cash_accounts").select("id,name,currency").eq("active", true).order("sort_order") : Promise.resolve({ data: [] }),
    fin ? partnerBalances(db, id) : Promise.resolve(new Map() as Awaited<ReturnType<typeof partnerBalances>>),
    db.from("partner_bill_lines").select("assignment_id,partner_bills!inner(status,partner_id)").eq("partner_bills.partner_id", id).not("assignment_id", "is", null),
  ]);
  const wos = (orders ?? []) as WorkOrder[];
  const { data: cases } = wos.length ? await db.from("cases").select("id,code").in("id", [...new Set(wos.map((o) => o.case_id))]) : { data: [] };
  const caseCodes = new Map((cases ?? []).map((c) => [c.id as string, c.code as string]));
  const costs = fin ? await costsFor(db, wos.map((o) => o.id)) : undefined;
  const billed = new Set(((billLines ?? []) as unknown as { assignment_id: string; partner_bills: { status: string } }[]).filter((l) => ["submitted", "approved"].includes(l.partner_bills.status)).map((l) => l.assignment_id));
  const billable = wos.filter((o) => ["completed", "shipped", "received"].includes(o.status) && !billed.has(o.id));
  const paidByBill = new Map<string, number>();
  for (const x of pays ?? []) if (!x.voided && x.bill_id) paidByBill.set(x.bill_id as string, (paidByBill.get(x.bill_id as string) ?? 0) + Number(x.amount));
  for (const [k, v] of await docCredits(db, { billIds: (bills ?? []).map((b) => b.id as string) })) paidByBill.set(k, (paidByBill.get(k) ?? 0) + v);
  const approved = ((bills ?? []) as Bill[]).filter((b) => b.status === "approved" && Number(b.total) - (paidByBill.get(b.id) ?? 0) > 0);
  const b = bal.get(id);
  const k = PARTNER_KINDS[partner.kind];

  return (
    <>
      <div className="topbar">
        <div>
          <div className="small"><Link href="/admin/partners">← Planners & labs</Link></div>
          <h1>{partner.name} {partner.active ? null : <span className="pill archived">inactive</span>}</h1>
          <div className="sub">{k?.en} · {k?.ar}{partner.contact_name ? ` · ${partner.contact_name}` : ""}{partner.phone ? ` · ${partner.phone}` : ""}</div>
        </div>
        {fin ? <div className="btn-row"><Link className="btn secondary" href={`/admin/finance/journal?account=partner:${id}`}>± Journal entry · قيد</Link><a className="btn secondary" href={`/admin/print/partner-statement?partner=${id}`} target="_blank" rel="noopener">🖨 Statement · كشف حساب</a></div> : null}
      </div>
      {fin ? <div className="stats">
        <div className="stat"><div className="k">Open work orders</div><div className="v">{b?.openOrders ?? 0}</div></div>
        <div className="stat"><div className="k">Done, not billed yet</div><div className="v" style={{ fontSize: "1.05rem", paddingTop: 6 }}>{mm(b?.unbilled, fmtMoney)}</div></div>
        <div className="stat"><div className="k">Approved bills</div><div className="v" style={{ fontSize: "1.05rem", paddingTop: 6 }}>{mm(b?.approved, fmtMoney)}</div></div>
        <div className="stat"><div className="k">Paid</div><div className="v" style={{ fontSize: "1.05rem", paddingTop: 6, color: "#067647" }}>{mm(b?.paid, fmtMoney)}</div></div>
        <div className="stat"><div className="k">RUKN owes · المستحق لهم</div><div className="v" style={{ fontSize: "1.05rem", paddingTop: 6, color: "#b42318" }}>{mm(b?.owed, fmtMoney)}</div></div>
      </div> : null}

      <section className="panel">
        <h2>Work orders · أوامر العمل</h2>
        <WorkOrdersTable orders={wos} caseCodes={caseCodes} showCase costs={costs} />
        <p className="small muted">Send a new work order from the case page (section “Work orders”).</p>
      </section>

      {fin ? <div className="case-cols">
        <section className="panel">
          <h2>Bills · الفواتير</h2>
          <BillsTable bills={(bills ?? []) as Bill[]} staff paidByBill={paidByBill} />
          <details style={{ marginTop: 12 }}>
            <summary><strong>+ Record a bill received from {partner.name}</strong></summary>
            <NewBillForm partnerId={id} currency={partner.currency} orders={billable} caseCodes={caseCodes} costs={costs ?? new Map()} />
          </details>
        </section>
        <div>
          <section className="panel">
            <h2>Pay {partner.name} · سداد</h2>
            <ActionForm action={payPartner.bind(null, id)} className="form-grid" resetOnSuccess>
              <div className="field full"><label htmlFor="pp-bill">For bill</label>
                <select id="pp-bill" name="bill_id" defaultValue={approved[0]?.id ?? ""}>
                  <option value="">— advance / not for a bill —</option>
                  {approved.map((x) => <option key={x.id} value={x.id}>{x.bill_no} · due {fmtMoney(Number(x.total) - (paidByBill.get(x.id) ?? 0), x.currency)}</option>)}
                </select>
              </div>
              <div className="field"><label htmlFor="pp-amt">Amount *</label><input id="pp-amt" type="number" name="amount" min="0.01" step="0.01" required defaultValue={approved[0] ? Number(approved[0].total) - (paidByBill.get(approved[0].id) ?? 0) : ""} /></div>
              <CurrencyField id="pp-cur" name="currency" defaultValue={partner.currency} />
              <div className="field full"><label htmlFor="pp-box">Paid from cash box · من صندوق</label>
                <select id="pp-box" name="cash_account_id" defaultValue={(boxes ?? []).find((x) => x.currency === partner.currency)?.id ?? ""}>
                  <option value="">— not from a box (record only) —</option>
                  {(boxes ?? []).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.currency})</option>)}
                </select>
              </div>
              <div className="field"><label htmlFor="pp-method">Method</label><select id="pp-method" name="method" defaultValue="bank_transfer">{Object.entries(PAYMENT_METHODS).map(([v, m]) => <option key={v} value={v}>{m.en}</option>)}</select></div>
              <div className="field"><label htmlFor="pp-date">Date</label><input id="pp-date" type="date" name="paid_at" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
              <div className="field full"><label htmlFor="pp-ref">Reference</label><input id="pp-ref" type="text" name="reference" maxLength={120} /></div>
              <div className="full"><SubmitButton className="btn teal">Record payment · تسجيل السداد</SubmitButton></div>
            </ActionForm>
          </section>
          <section className="panel">
            <h2>Payments · المدفوعات</h2>
            {(pays ?? []).length ? (
              <table className="data"><tbody>
                {(pays ?? []).map((x) => (
                  <tr key={x.id} style={x.voided ? { opacity: 0.5 } : undefined}>
                    <td className="mono small">{x.payment_no}{x.voided ? <div><span className="pill closed">void</span></div> : null}</td>
                    <td className="small">{fmtDay(x.paid_at)}<div className="muted">{PAYMENT_METHODS[x.method]?.en}{x.reference ? ` · ${x.reference}` : ""}</div></td>
                    <td className="num nowrap">{fmtMoney(x.amount, x.currency)}</td>
                    <td className="nowrap">
                      <a className="btn secondary small" href={`/admin/print/partner-payment/${x.id}`} target="_blank" rel="noopener">🖨</a>{" "}
                      {!x.voided ? <ConfirmAction action={voidPartnerPayment} hidden={{ id: x.id, reason: "Voided by RUKN" }} danger label="Void" title="Void this payment?" message="Its cash voucher is voided too and the money returns to the box." confirmLabel="Void" /> : null}
                    </td>
                  </tr>
                ))}
              </tbody></table>
            ) : <p className="small muted">No payments yet.</p>}
          </section>
        </div>
      </div> : null}
      <section className="panel">
            <h2>Logins · حسابات الدخول</h2>
            {(users ?? []).length ? <ul>{(users ?? []).map((u) => <li key={u.id}>{u.full_name || u.email} <span className="small muted">{u.email}{u.is_active ? "" : " · inactive"}</span></li>)}</ul> : <p className="small muted">No login yet.</p>}
            <p className="small muted">Add one in <Link href="/admin/users">Users & roles</Link> with role “{partner.kind === "lab" ? "Production lab" : "Treatment planner"}” and this partner.</p>
      </section>

      <section className="panel">
        <details>
          <summary><strong>Partner details · بيانات الشريك</strong></summary>
          <PartnerForm p={partner} />
        </details>
      </section>
    </>
  );
}
