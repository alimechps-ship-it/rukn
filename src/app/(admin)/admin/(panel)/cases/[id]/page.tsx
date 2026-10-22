import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { CaseFileUploader } from "@/components/admin/CaseFileUploader";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { ItemsEditor } from "@/components/admin/ItemsEditor";
import { Select, Text, TextArea } from "@/components/admin/fields";
import { can, requireStaff } from "@/lib/auth";
import { docCredits } from "@/lib/journal";
import { createSessionClient, fmtDate } from "@/lib/admin";
import { peopleWithRole, profileMap, serviceOptions } from "@/lib/case-data";
import {
  ALL_STATUSES, ARCHES, countryName, FILE_CATEGORIES, fmtDay, fmtMoney, INTAKE_PRESETS, PAYMENT_METHODS, SEXES, STATUS, STEPS, type CaseStatus,
} from "@/lib/cases";
import {
  addCaseComment, addPayment, changeCaseStatus, decidePlan, deleteCaseFile, markDelivered, registerIntake, saveQuote, saveShipment, updateCaseInfo, voidPayment,
} from "../../_actions/cases";
import { createInvoice } from "../../_actions/invoices";
import { confirmReceipt } from "../../_actions/payments";
import { PaymentNoticeForm } from "@/components/admin/PaymentNoticeForm";
import { NoticesTable, type Notice } from "../../finance/Notices";
import { isAiConfigured } from "@/lib/ai";
import { createWorkOrder, sendFileToAgent } from "../../_actions/partners";
import { createDispatch, invoiceFromDispatch } from "../../_actions/dispatch";
import { DISPATCH_STATUS } from "@/lib/dispatch";
import { WO_STATUS, WORK_KINDS, type WorkOrder } from "@/lib/partners";
import { INVOICE_STATUS } from "@/lib/invoices";
import { CaseFormFields } from "../CaseForm";

export const metadata = { title: "Case" };

const local = (v: string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 16) : "");
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default async function CaseDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; sent?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireStaff(can.cases);
  const staff = can.caseStaff(user);
  const ops = can.ops(user);
  const fin = can.finance(user);
  /** Money panels: finance team, and the agent for his own case. */
  const showMoney = fin || !staff;
  const db = await createSessionClient();
  const { data: c } = await db.from("cases").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();
  const [{ data: files }, { data: events }, { data: payments }, { data: invoices }, { data: cashBoxes }, { data: claims }, { data: workOrders }, { data: partnerList }, { data: quote }, { data: costRows }, { data: dispatches }, services, agents, staffUsers] = await Promise.all([
    db.from("case_files").select("*").eq("case_id", id).order("created_at"),
    db.from("case_events").select("*").eq("case_id", id).order("created_at"),
    db.from("case_payments").select("*").eq("case_id", id).order("created_at"),
    db.from("case_invoices").select("id,invoice_no,status,issue_date,currency,total,revision").eq("case_id", id).order("created_at"),
    fin ? db.from("cash_accounts").select("id,name,currency").eq("active", true).order("sort_order") : Promise.resolve({ data: [] as { id: string; name: string; currency: string }[] }),
    db.from("case_payment_claims").select("*").eq("case_id", id).order("created_at", { ascending: false }),
    staff ? db.from("case_assignments").select("*").eq("case_id", id).order("created_at") : Promise.resolve({ data: [] as WorkOrder[] }),
    staff ? db.from("partners").select("id,name,kind,currency").eq("active", true).order("kind").order("name") : Promise.resolve({ data: [] as { id: string; name: string; kind: string; currency: string }[] }),
    showMoney ? db.from("case_finance").select("quote_amount,quote_currency").eq("case_id", id).maybeSingle() : Promise.resolve({ data: null }),
    fin ? db.from("assignment_costs").select("assignment_id,cost_amount,currency") : Promise.resolve({ data: [] as { assignment_id: string; cost_amount: number | null; currency: string }[] }),
    staff ? db.from("case_dispatch_orders").select("id,order_no,status,sent_at,invoice_id,created_at,case_dispatch_lines(count)").eq("case_id", id).order("created_at") : Promise.resolve({ data: [] }),
    serviceOptions(db),
    staff ? peopleWithRole(db, ["agent"]) : Promise.resolve([]),
    staff ? peopleWithRole(db, ["case_manager", "finance_manager", "super_admin"]) : Promise.resolve([]),
  ]);
  const people = await profileMap(db, [c.agent_id, c.assigned_to, ...(events ?? []).map((e) => e.author_id), ...(files ?? []).map((f) => f.uploaded_by), ...(claims ?? []).map((n) => n.submitted_by)]);
  const agent = people.get(c.agent_id);
  const status = c.status as CaseStatus;
  const stepIndex = STEPS.indexOf(status === "revision" ? "awaiting_approval" : status);
  const editable = ops || (!staff && status === "submitted");
  const qAmount = quote?.quote_amount ?? null;
  const qCur = quote?.quote_currency ?? null;
  const costOf = new Map((costRows ?? []).map((r) => [r.assignment_id as string, { amount: r.cost_amount as number | null, currency: r.currency as string }]));
  const paid = (payments ?? []).filter((p) => !p.voided).reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.currency]: (acc[p.currency] ?? 0) + Number(p.amount) }), {});
  const intakeItems = (c.intake_items ?? []) as { title: string; text: string }[];
  const issuedInvoices = (invoices ?? []).filter((i) => i.status === "issued");
  const credits = await docCredits(db, { invoiceIds: issuedInvoices.map((i) => i.id as string) }); // discounts / offsets linked to invoices
  const paidOn = (invId: string) => (payments ?? []).filter((p) => !p.voided && p.invoice_id === invId).reduce((a, p) => a + Number(p.amount), 0) + (credits.get(invId) ?? 0);
  const invNo = new Map((invoices ?? []).map((i) => [i.id, i.invoice_no as string | null]));
  const pendingNotices = (claims ?? []).filter((n) => n.status === "pending");
  const hasPlanFile = (files ?? []).some((f) => f.is_deliverable);
  const invoicesForAgent = issuedInvoices.map((i) => ({ id: i.id as string, invoice_no: i.invoice_no as string, currency: i.currency as string, balance: Math.round((Number(i.total) - paidOn(i.id)) * 100) / 100 }));
  const receiptNos = new Map((payments ?? []).map((p) => [p.id as string, { no: p.receipt_no as string, id: p.id as string }]));
  const nameMap = new Map([...people.entries()].map(([k, v]) => [k, v.name]));
  const wos = (workOrders ?? []) as WorkOrder[];
  const partnerName = new Map((partnerList ?? []).map((p) => [p.id as string, p.name as string]));
  const costs = new Map<string, number>(); const revenue = new Map<string, number>();
  for (const w of wos) { const k = costOf.get(w.id); if (k?.amount != null && !["cancelled", "rejected"].includes(w.status)) costs.set(k.currency, (costs.get(k.currency) ?? 0) + Number(k.amount)); }
  for (const i of issuedInvoices) revenue.set(i.currency as string, (revenue.get(i.currency as string) ?? 0) + Number(i.total));
  const margin = [...new Set([...costs.keys(), ...revenue.keys()])].map((cur) => ({ cur, rev: revenue.get(cur) ?? 0, cost: costs.get(cur) ?? 0 }));

  return (
    <>
      <div className="topbar">
        <div>
          <div className="small"><Link href="/admin/cases">← {staff ? "Cases" : "My cases"}</Link></div>
          <h1 className="mono" style={{ letterSpacing: ".02em" }}>{c.code}</h1>
          <div className="sub">
            <span className={`pill ${STATUS[status].tone}`}>{STATUS[status].en} · {STATUS[status].ar}</span>{" "}
            {c.priority === "urgent" ? <span className="pill changes">urgent</span> : null} · {c.service_label ?? "No service selected"} · created {fmtDate(c.created_at)}
          </div>
        </div>
        <div className="btn-row">
          <a className="btn secondary" href={`/admin/print/case/${c.id}/file`} target="_blank" rel="noopener">🖨 Case file</a>
          {c.intake_no ? <a className="btn secondary" href={`/admin/print/case/${c.id}/intake`} target="_blank" rel="noopener">🖨 Records receipt</a> : null}
          {c.delivery_no ? <a className="btn secondary" href={`/admin/print/case/${c.id}/delivery`} target="_blank" rel="noopener">🖨 Delivery note</a> : null}
        </div>
      </div>

      {sp.sent === "dispatch" ? <div className="flash ok">Dispatch order sent to finance for pricing. · تم إرسال إذن الصرف للمالية.</div> : null}
      {sp.created ? <div className="flash ok">Case {c.code} created. Upload the scans, photos and records below.</div> : null}

      {status !== "cancelled" && status !== "on_hold" ? (
        <section className="panel">
          <ol className="stepper">
            {STEPS.map((s, i) => (
              <li key={s} className={i < stepIndex ? "done" : i === stepIndex ? "current" : ""}>
                <span className="dot">{i < stepIndex ? "✓" : i + 1}</span>
                <span className="lbl">{STATUS[s].en}<br /><span className="ar">{STATUS[s].ar}</span></span>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <div className="flash warn">This case is {STATUS[status].en.toLowerCase()}.</div>
      )}

      <div className="cols case-cols">
        <div>
          {/* Receipt confirmations (agent; the case manager may also record them) */}
          {status === "shipped" && (ops || !staff) ? (
            <section className="confirm-box">
              <h3>📦 Did you receive the shipment? · هل استلمت الشحنة؟</h3>
              <p className="small muted" style={{ marginTop: 0 }}>Shipped{c.carrier ? ` with ${c.carrier}` : ""}{c.tracking_no ? ` · tracking ${c.tracking_no}` : ""}. Confirming closes the case and issues the delivery note.</p>
              <ActionForm action={confirmReceipt.bind(null, c.id)} className="form-grid">
                <input type="hidden" name="what" value="shipment" />
                <Text name="name" label="Received by (name) · اسم المستلم" required defaultValue={c.doctor_name} maxLength={120} />
                <Text name="notes" label="Condition / notes · ملاحظات" maxLength={1000} />
                <div className="full"><SubmitButton className="btn teal" pendingText="Confirming…">✓ Confirm receipt of shipment · تأكيد الاستلام</SubmitButton></div>
              </ActionForm>
            </section>
          ) : null}
          {hasPlanFile && !c.plan_received_at && !staff ? (
            <section className="confirm-box">
              <h3>📄 Treatment plan received? · هل استلمت الخطة العلاجية؟</h3>
              <p className="small muted" style={{ marginTop: 0 }}>RUKN sent the plan files listed below (marked “from RUKN”). Confirm once you and the doctor received them.</p>
              <ActionForm action={confirmReceipt.bind(null, c.id)} className="form-grid">
                <input type="hidden" name="what" value="plan" />
                <Text name="name" label="Received by (name)" required defaultValue={c.doctor_name} maxLength={120} />
                <Text name="notes" label="Notes" maxLength={1000} />
                <div className="full"><SubmitButton className="btn secondary" pendingText="Confirming…">✓ Confirm plan received · تأكيد استلام الخطة</SubmitButton></div>
              </ActionForm>
            </section>
          ) : null}
          {c.plan_received_at ? <div className="flash ok">Treatment plan received by {c.plan_received_by} · {fmtDate(c.plan_received_at)}</div> : null}
          {fin && pendingNotices.length ? (
            <a href="#payments" className="flash warn" style={{ display: "block", textDecoration: "none" }}>💳 {pendingNotices.length} payment notice(s) from the agent awaiting your confirmation — review below ↓</a>
          ) : null}

          {/* Agent: approval of the plan */}
          {status === "awaiting_approval" ? (
            <section className="panel highlight">
              <h2>Treating doctor&apos;s decision · قرار الطبيب المعالج</h2>
              <p className="small muted">Review the treatment plan in the files below with the treating doctor, then record the decision. Nothing is produced before approval.</p>
              <ActionForm action={decidePlan.bind(null, c.id)} className="form-grid">
                <Text name="doctor" label="Approving doctor (full name)" required defaultValue={c.doctor_name} maxLength={120} />
                <TextArea name="comment" label="Comment / revision details" rows={3} maxLength={1000} />
                <div className="full btn-row">
                  <SubmitButton className="btn teal" name="decision" value="approve" pendingText="Saving…">✓ Approve plan</SubmitButton>
                  <SubmitButton className="btn secondary" name="decision" value="revision" pendingText="Saving…">Request revision</SubmitButton>
                </div>
              </ActionForm>
            </section>
          ) : null}

          <section className="panel">
            <div className="panel-head"><h2>Files · الملفات</h2><span className="small muted">{(files ?? []).length} file(s)</span></div>
            {(files ?? []).length ? (
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>File</th><th>Type</th><th>Size</th><th>Uploaded</th><th /></tr></thead>
                  <tbody>
                    {(files ?? []).map((f) => (
                      <tr key={f.id}>
                        <td><a href={`/admin/cases/${c.id}/files/${f.id}`}>{f.filename}</a>{f.is_deliverable ? <div><span className="pill qualified">from RUKN</span></div> : null}
                          {ops && f.internal ? <div><span className="pill changes">from partner · not sent</span>
                            <ActionForm action={sendFileToAgent} className="inline-ai"><input type="hidden" name="id" value={f.id} /><SubmitButton className="btn teal small" pendingText="Sending…">Send to agent →</SubmitButton></ActionForm></div> : null}</td>
                        <td className="small">{FILE_CATEGORIES[f.category]?.en ?? f.category}</td>
                        <td className="small">{f.size_bytes ? kb(Number(f.size_bytes)) : "—"}</td>
                        <td className="small muted">{people.get(f.uploaded_by)?.name ?? "—"}<br />{fmtDate(f.created_at)}</td>
                        <td className="actions">
                          <a className="btn secondary small" href={`/admin/cases/${c.id}/files/${f.id}`}>Download</a>{" "}
                          {ops || (status === "submitted" && f.uploaded_by === user.id) ? (
                            <ConfirmAction action={deleteCaseFile} hidden={{ id: f.id }} danger label="Delete" title="Delete this file?" message={`${f.filename} will be removed permanently.`} confirmLabel="Delete" />
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="muted">No files yet.</p>}
            {ops || !staff ? <div style={{ marginTop: 14 }}><CaseFileUploader caseId={c.id} staff={ops} /></div> : null}
          </section>

          <section className="panel">
            <h2>Timeline · سجل الحالة</h2>
            <ul className="timeline">
              {(events ?? []).map((e) => (
                <li key={e.id} className={e.kind === "internal" ? "internal" : ""}>
                  <div>
                    {e.kind === "status" ? <>Status: <strong>{STATUS[e.from_status as CaseStatus]?.en ?? "—"}</strong> → <strong>{STATUS[e.to_status as CaseStatus]?.en}</strong></> : null}
                    {e.kind === "system" ? <strong>{e.body}</strong> : null}
                    {e.kind === "file" ? <>📎 File uploaded: <strong>{e.body}</strong></> : null}
                    {e.kind === "payment" ? <>💳 Payment: <strong>{e.body}</strong></> : null}
                    {e.kind === "approval" ? <>✅ <strong>{e.body}</strong></> : null}
                    {e.kind === "comment" || e.kind === "internal" ? <>{e.kind === "internal" ? <span className="pill draft">internal</span> : "💬"} <span style={{ whiteSpace: "pre-wrap" }} dir="auto">{e.body}</span></> : null}
                  </div>
                  <div className="small muted">{people.get(e.author_id)?.name ?? "System"} · {fmtDate(e.created_at)}</div>
                </li>
              ))}
            </ul>
            <ActionForm action={addCaseComment.bind(null, c.id)} resetOnSuccess>
              <div className="field"><label htmlFor="body">Message</label><textarea id="body" name="body" rows={3} maxLength={4000} required dir="auto" placeholder={staff ? "Message to the agent, or an internal note" : "Message to the RUKN team"} /></div>
              <div className="btn-row">
                {staff ? <select name="visibility" defaultValue="comment" style={{ width: "auto" }}><option value="comment">Visible to the agent</option><option value="internal">Internal (RUKN only)</option></select> : null}
                <SubmitButton>Add</SubmitButton>
              </div>
            </ActionForm>
          </section>

          <section className="panel">
            <details open={status === "submitted"}>
              <summary><h2 style={{ display: "inline" }}>Case details · بيانات الحالة</h2></summary>
              <dl className="kv" style={{ marginTop: 14 }}>
                <dt>Agent</dt><dd>{agent?.name ?? "—"}{agent?.organization ? ` · ${agent.organization}` : ""}{agent?.phone ? ` · ${agent.phone}` : ""}</dd>
                <dt>Case manager</dt><dd>{c.assigned_to ? people.get(c.assigned_to)?.name : "Unassigned"}</dd>
                <dt>Clinic</dt><dd>{c.clinic_name} · {c.city ? `${c.city}, ` : ""}{countryName(c.country_code)}</dd>
                <dt>Treating doctor</dt><dd>{c.doctor_name}{c.doctor_phone ? ` · ${c.doctor_phone}` : ""}{c.doctor_email ? ` · ${c.doctor_email}` : ""}</dd>
                <dt>Patient</dt><dd><span className="mono">{c.patient_ref}</span>{c.patient_age ? ` · ${c.patient_age} y` : ""}{c.patient_sex ? ` · ${SEXES[c.patient_sex]?.en}` : ""}{c.arches ? ` · ${ARCHES[c.arches]?.en}` : ""}</dd>
                <dt>Requested by</dt><dd>{fmtDay(c.due_date)}</dd>
                <dt>Notes</dt><dd style={{ whiteSpace: "pre-wrap" }} dir="auto">{c.description ?? "—"}</dd>
                {c.plan_approved_at ? <><dt>Plan approved</dt><dd>{c.plan_approved_by} · {fmtDate(c.plan_approved_at)}</dd></> : null}
              </dl>
              {editable ? (
                <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
                  <h3>Edit details</h3>
                  {!staff ? <p className="small muted">You can edit until RUKN starts processing the case.</p> : null}
                  <ActionForm action={updateCaseInfo.bind(null, c.id)}>
                    <CaseFormFields v={c} services={services} agents={agents} staffUsers={staffUsers} isStaff={staff} />
                    <div style={{ marginTop: 12 }}><SubmitButton>Save details</SubmitButton></div>
                  </ActionForm>
                </div>
              ) : null}
            </details>
          </section>
        </div>

        <div>
          {ops ? (
            <section className="panel">
              <h2>Status · الحالة</h2>
              <ActionForm action={changeCaseStatus.bind(null, c.id)} className="form-grid">
                <Select name="status" label="New status" defaultValue={status} full options={ALL_STATUSES.map((s) => ({ value: s, label: `${STATUS[s].en} · ${STATUS[s].ar}` }))} />
                <TextArea name="comment" label="Message (optional)" rows={2} maxLength={4000} />
                <Select name="visibility" label="Message visibility" defaultValue="comment" full options={[{ value: "comment", label: "Visible to the agent" }, { value: "internal", label: "Internal (RUKN only)" }]} />
                <div className="full"><SubmitButton className="btn teal">Update status</SubmitButton></div>
              </ActionForm>
            </section>
          ) : null}

          <section className="panel">
            <div className="panel-head"><h2>Records received · استلام السجلات</h2>{c.intake_no ? <a className="btn secondary small" href={`/admin/print/case/${c.id}/intake`} target="_blank" rel="noopener">🖨 {c.intake_no}</a> : null}</div>
            {intakeItems.length ? (
              <table className="data"><tbody>{intakeItems.map((i, n) => <tr key={n}><td>{i.title}</td><td className="small">{i.text}</td></tr>)}</tbody></table>
            ) : <p className="muted small">Nothing registered yet.</p>}
            {c.intake_received_at ? <p className="small muted">Received {fmtDate(c.intake_received_at)}{c.intake_received_by ? ` by ${people.get(c.intake_received_by)?.name ?? ""}` : ""}</p> : null}
            {ops ? (
              <details style={{ marginTop: 10 }} open={!c.intake_no}>
                <summary className="small"><strong>{c.intake_no ? "Edit intake" : "Register received records"}</strong></summary>
                <ActionForm action={registerIntake.bind(null, c.id)}>
                  <p className="small muted">Item → quantity / condition. Common items: {INTAKE_PRESETS.slice(0, 6).join(", ")}…</p>
                  <ItemsEditor name="items" initial={intakeItems.length ? intakeItems : [{ title: "Intraoral scan — upper (STL)", text: "1" }, { title: "Intraoral scan — lower (STL)", text: "1" }]} dir="ltr" />
                  <div className="form-grid" style={{ marginTop: 8 }}>
                    <Text name="received_at" label="Received at" type="datetime-local" defaultValue={local(c.intake_received_at)} />
                    <Text name="notes" label="Notes" defaultValue={c.intake_notes} maxLength={1000} />
                  </div>
                  <SubmitButton>Save intake</SubmitButton>
                </ActionForm>
              </details>
            ) : null}
          </section>

          {staff ? (
            <section className="panel">
              <h2>Planning & production · التخطيط والتصنيع</h2>
              {wos.length ? (
                <table className="data">
                  <tbody>
                    {wos.map((w) => (
                      <tr key={w.id} className="row-link">
                        <td><a className="stretched mono small" href={`/admin/work/${w.id}`}>{w.order_no}</a><div className="small">{WORK_KINDS[w.kind]?.en} · {partnerName.get(w.partner_id) ?? ""}</div></td>
                        <td><span className={`pill ${WO_STATUS[w.status]?.tone}`}>{WO_STATUS[w.status]?.en}</span></td>
                        {fin ? <td className="num small nowrap">{costOf.get(w.id)?.amount != null ? fmtMoney(costOf.get(w.id)!.amount, costOf.get(w.id)!.currency) : <span className="pill changes">set cost</span>}</td> : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="small muted">No work order yet. Send the case to a planner for the treatment plan, then to a lab for production.</p>}
              {fin && margin.length ? (
                <dl className="kv" style={{ marginTop: 10 }}>
                  {margin.map((m) => (
                    <Fragment key={m.cur}>
                      <dt>Invoiced − costs ({m.cur})</dt>
                      <dd>{fmtMoney(m.rev, m.cur)} − {fmtMoney(m.cost, m.cur)} = <strong style={{ color: m.rev - m.cost >= 0 ? "#067647" : "#b42318" }}>{fmtMoney(m.rev - m.cost, m.cur)}</strong></dd>
                    </Fragment>
                  ))}
                </dl>
              ) : null}
              {ops ? <details style={{ marginTop: 10 }} open={!wos.length}>
                <summary className="small"><strong>+ Send a work order · إرسال أمر عمل</strong></summary>
                {(partnerList ?? []).length ? (
                  <ActionForm action={createWorkOrder.bind(null, c.id)} className="form-grid" resetOnSuccess>
                    <div className="field full"><label htmlFor="wo-partner">To · إلى *</label>
                      <select id="wo-partner" name="partner_id" defaultValue="">
                        <option value="" disabled>— choose a planner or lab —</option>
                        <optgroup label="Treatment planners · المخططون">{(partnerList ?? []).filter((p) => p.kind === "planner").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
                        <optgroup label="Production labs · المعامل">{(partnerList ?? []).filter((p) => p.kind === "lab").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
                      </select>
                    </div>
                    <div className="field full"><label htmlFor="wo-title">Work · المطلوب *</label><input id="wo-title" type="text" name="title" maxLength={200} required placeholder="e.g. Digital setup both arches / 22 aligners + retainers" /></div>
                    <div className="field full"><label htmlFor="wo-ins">Instructions · تعليمات</label><textarea id="wo-ins" name="instructions" rows={3} maxLength={4000} dir="auto" /></div>
                    <div className="field full"><label>Items (item → quantity) · البنود</label><ItemsEditor name="items" initial={[]} dir="ltr" /></div>
                    <div className="field"><label htmlFor="wo-due">Due date</label><input id="wo-due" type="date" name="due_date" /></div>
                    <div className="full"><SubmitButton className="btn teal small">Send work order</SubmitButton></div>
                  </ActionForm>
                ) : <p className="small muted">Add planners and labs first (Partners → Planners & labs).</p>}
              </details> : null}
              {ops ? <p className="small muted" style={{ marginBottom: 0 }}>The agreed cost of each order is set by the finance team.</p> : null}
            </section>
          ) : null}

          {staff ? (
            <section className="panel" id="dispatch">
              <div className="panel-head">
                <h2>Dispatch orders · أذون الصرف</h2>
                {ops ? (
                  <ActionForm action={createDispatch.bind(null, c.id)}>
                    <SubmitButton className="btn teal small" pendingText="Creating…">+ New dispatch order</SubmitButton>
                  </ActionForm>
                ) : null}
              </div>
              {(dispatches ?? []).length ? (
                <table className="data">
                  <tbody>
                    {((dispatches ?? []) as unknown as { id: string; order_no: string; status: string; sent_at: string | null; invoice_id: string | null; case_dispatch_lines: { count: number }[] }[]).map((d) => (
                      <tr key={d.id}>
                        <td><Link className="mono small" href={`/admin/cases/${c.id}/dispatch/${d.id}`}>{d.order_no}</Link><div className="small muted">{d.case_dispatch_lines?.[0]?.count ?? 0} service line(s){d.sent_at ? ` · sent ${fmtDay(d.sent_at)}` : ""}</div></td>
                        <td><span className={`pill ${DISPATCH_STATUS[d.status]?.tone}`}>{DISPATCH_STATUS[d.status]?.en}</span></td>
                        <td className="actions nowrap">
                          <a className="btn secondary small" href={`/admin/print/dispatch/${d.id}`} target="_blank" rel="noopener">🖨</a>{" "}
                          {fin && d.status === "sent" ? (
                            <ActionForm action={invoiceFromDispatch} className="inline-ai" >
                              <input type="hidden" name="id" value={d.id} />
                              <SubmitButton className="btn teal small" pendingText="Pricing…">Price & invoice →</SubmitButton>
                            </ActionForm>
                          ) : null}
                          {fin && d.invoice_id ? <Link className="btn secondary small" href={`/admin/cases/${c.id}/invoices/${d.invoice_id}`}>Invoice</Link> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="small muted">{ops ? "List the services and quantities (aligners, Snap-On, retainers…) and send them to finance for pricing." : "No dispatch order yet."}</p>}
            </section>
          ) : null}

          {showMoney ? (<>
          <section className="panel">
            <div className="panel-head">
              <h2>Invoices · الفواتير</h2>
              {fin ? (
                <ActionForm action={createInvoice.bind(null, c.id)}>
                  <SubmitButton className="btn teal small" pendingText="Creating…">+ New invoice</SubmitButton>
                </ActionForm>
              ) : null}
            </div>
            {(invoices ?? []).length ? (
              <table className="data">
                <thead><tr><th>Invoice</th><th className="num">Total</th><th className="num">Balance</th><th /></tr></thead>
                <tbody>
                  {(invoices ?? []).map((inv) => (
                    <tr key={inv.id} style={inv.status === "void" ? { opacity: 0.55 } : undefined}>
                      <td>
                        <Link className="mono" href={`/admin/cases/${c.id}/invoices/${inv.id}`}>{inv.invoice_no ?? "Draft"}</Link>{inv.revision ? <span className="small muted"> rev. {inv.revision}</span> : null}
                        <div><span className={`pill ${INVOICE_STATUS[inv.status].tone}`}>{INVOICE_STATUS[inv.status].en} · {INVOICE_STATUS[inv.status].ar}</span> <span className="small muted">{fmtDay(inv.issue_date)}</span></div>
                      </td>
                      <td className="num">{fmtMoney(inv.total, inv.currency)}</td>
                      <td className="num">{inv.status === "issued" ? <strong>{fmtMoney(Number(inv.total) - paidOn(inv.id), inv.currency)}</strong> : "—"}</td>
                      <td className="actions nowrap">
                        <Link className="btn secondary small" href={`/admin/cases/${c.id}/invoices/${inv.id}`}>{fin && inv.status !== "void" ? "Edit" : "Open"}</Link>{" "}
                        <a className="btn secondary small" href={`/admin/print/invoice/${inv.id}`} target="_blank" rel="noopener">🖨</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="small muted">{fin ? "No invoice yet. Price a dispatch order from the case manager, or press “New invoice”." : "No invoice issued yet."}</p>}
          </section>

          <section className="panel" id="payments">
            <h2>Quotation & payments · السعر والمدفوعات</h2>
            <dl className="kv">
              <dt>Quoted price</dt><dd><strong>{fmtMoney(qAmount, qCur)}</strong></dd>
              <dt>Paid</dt><dd>{Object.keys(paid).length ? Object.entries(paid).map(([cur, v]) => fmtMoney(v, cur)).join(" + ") : "—"}</dd>
              {qAmount && qCur ? <><dt>Balance</dt><dd><strong>{fmtMoney(Number(qAmount) - (paid[qCur] ?? 0), qCur)}</strong></dd></> : null}
            </dl>
            {(payments ?? []).length ? (
              <table className="data" style={{ marginTop: 10 }}>
                <thead><tr><th>Receipt</th><th>Amount</th><th>Date</th><th /></tr></thead>
                <tbody>
                  {(payments ?? []).map((p) => (
                    <tr key={p.id} style={p.voided ? { opacity: 0.55 } : undefined}>
                      <td className="mono">{p.receipt_no}{p.invoice_id ? <div className="small muted">→ {invNo.get(p.invoice_id) ?? "invoice"}</div> : null}{p.voided ? <div><span className="pill closed">void</span></div> : null}</td>
                      <td>{fmtMoney(p.amount, p.currency)}<div className="small muted">{PAYMENT_METHODS[p.method]?.en}</div></td>
                      <td className="small">{fmtDay(p.paid_at)}</td>
                      <td className="actions">
                        <a className="btn secondary small" href={`/admin/print/case/${c.id}/receipt?p=${p.id}`} target="_blank" rel="noopener">🖨</a>{" "}
                        {fin && !p.voided ? <ConfirmAction action={voidPayment} hidden={{ id: p.id, reason: "Voided by finance" }} danger label="Void" title="Void this receipt?" message="The receipt stays on record and prints with a VOID mark." confirmLabel="Void" /> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            <h3 style={{ margin: "16px 0 8px", fontSize: "1rem" }}>{fin ? "Payment notices from the agent" : "Your payment notices"} · إشعارات الدفع</h3>
            <NoticesTable notices={(claims ?? []) as Notice[]} staff={fin} boxes={(cashBoxes ?? []) as { id: string; name: string; currency: string }[]}
              invoiceNos={new Map([...invNo.entries()].filter(([, v]) => v) as [string, string][])} receiptNos={receiptNos} names={nameMap} aiEnabled={fin && isAiConfigured()} />
            {!staff && status !== "cancelled" ? (
              <details style={{ marginTop: 12 }} open={pendingNotices.length === 0 && invoicesForAgent.some((i) => i.balance > 0)}>
                <summary><strong>💳 I sent a payment · إرسال دفعة للشركة</strong></summary>
                <p className="small muted">Tell RUKN about a transfer you made. Attach a photo or PDF of the transfer receipt — RUKN confirms it and issues the official receipt.</p>
                <PaymentNoticeForm caseId={c.id} invoices={invoicesForAgent} defaultCurrency={qCur ?? "USD"} />
              </details>
            ) : null}
            {fin ? (
              <>
                <details style={{ marginTop: 10 }}>
                  <summary className="small"><strong>Set quotation</strong></summary>
                  <ActionForm action={saveQuote.bind(null, c.id)} className="form-grid">
                    <Text name="quote_amount" label="Amount" type="number" defaultValue={qAmount ?? ""} />
                    <Text name="quote_currency" label="Currency" defaultValue={qCur ?? "USD"} maxLength={3} />
                    <div className="full"><SubmitButton className="btn secondary">Save quotation</SubmitButton></div>
                  </ActionForm>
                </details>
                <details style={{ marginTop: 10 }}>
                  <summary className="small"><strong>Record a payment (issues a receipt)</strong></summary>
                  <ActionForm action={addPayment.bind(null, c.id)} className="form-grid" resetOnSuccess>
                    {issuedInvoices.length ? (
                      <Select name="invoice_id" label="Apply to invoice" full defaultValue={issuedInvoices.find((i) => Number(i.total) - paidOn(i.id) > 0)?.id ?? ""}
                        options={[{ value: "", label: "— not linked to an invoice —" }, ...issuedInvoices.map((i) => ({ value: i.id, label: `${i.invoice_no} · balance ${fmtMoney(Number(i.total) - paidOn(i.id), i.currency)}` }))]} />
                    ) : null}
                    <Text name="amount" label="Amount *" type="number" />
                    <Text name="currency" label="Currency *" defaultValue={qCur ?? "USD"} maxLength={3} />
                    <Select name="method" label="Method" defaultValue="bank_transfer" options={Object.entries(PAYMENT_METHODS).map(([k, m]) => ({ value: k, label: m.en }))} />
                    <Text name="paid_at" label="Date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
                    <Text name="reference" label="Reference (transfer no.)" maxLength={120} />
                    {(cashBoxes ?? []).length ? (
                      <Select name="cash_account_id" label="Deposit into cash box · إيداع في صندوق" full defaultValue=""
                        hint="Optional — the box must be in the same currency as the payment. A receipt voucher (CR-) is added to the box automatically."
                        options={[{ value: "", label: "— do not deposit (record only) —" }, ...(cashBoxes ?? []).map((b) => ({ value: b.id, label: `${b.name} (${b.currency})` }))]} />
                    ) : null}
                    <Text name="notes" label="Notes" maxLength={500} />
                    <div className="full"><SubmitButton className="btn teal">Record payment</SubmitButton></div>
                  </ActionForm>
                </details>
              </>
            ) : null}
          </section>
          </>) : null}

          <section className="panel">
            <div className="panel-head"><h2>Shipping & delivery · الشحن والتسليم</h2>{c.delivery_no ? <a className="btn secondary small" href={`/admin/print/case/${c.id}/delivery`} target="_blank" rel="noopener">🖨 {c.delivery_no}</a> : null}</div>
            <dl className="kv">
              <dt>Carrier</dt><dd>{c.carrier ?? "—"}</dd>
              <dt>Tracking no.</dt><dd className="mono">{c.tracking_no ?? "—"}</dd>
              <dt>Shipped</dt><dd>{fmtDate(c.shipped_at)}</dd>
              <dt>Delivered</dt><dd>{fmtDate(c.delivered_at)}{c.received_by_name ? ` · received by ${c.received_by_name}` : ""}</dd>
            </dl>
            {ops ? (
              <>
                <details style={{ marginTop: 10 }}>
                  <summary className="small"><strong>Shipment</strong></summary>
                  <ActionForm action={saveShipment.bind(null, c.id)} className="form-grid">
                    <Text name="carrier" label="Carrier" defaultValue={c.carrier} maxLength={80} />
                    <Text name="tracking_no" label="Tracking number" defaultValue={c.tracking_no} maxLength={120} />
                    <Text name="shipped_at" label="Shipped at" type="datetime-local" defaultValue={local(c.shipped_at)} />
                    <div className="field"><label>&nbsp;</label><label className="check"><input type="checkbox" name="mark_shipped" defaultChecked={status !== "shipped" && status !== "delivered"} /> Set status to “Shipped”</label></div>
                    <div className="full"><SubmitButton className="btn secondary">Save shipment</SubmitButton></div>
                  </ActionForm>
                </details>
                <details style={{ marginTop: 10 }}>
                  <summary className="small"><strong>Confirm delivery (issues a delivery note)</strong></summary>
                  <ActionForm action={markDelivered.bind(null, c.id)} className="form-grid">
                    <Text name="received_by_name" label="Received by (name) *" defaultValue={c.received_by_name} maxLength={120} />
                    <Text name="delivered_at" label="Delivered at" type="datetime-local" defaultValue={local(c.delivered_at)} />
                    <TextArea name="delivery_notes" label="What was delivered / notes" defaultValue={c.delivery_notes} rows={2} maxLength={1000} />
                    <div className="full"><SubmitButton className="btn teal">Confirm delivery</SubmitButton></div>
                  </ActionForm>
                </details>
              </>
            ) : null}
          </section>
        </div>
      </div>
    </>
  );
}
