import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { CaseFileUploader } from "@/components/admin/CaseFileUploader";
import { ItemsEditor } from "@/components/admin/ItemsEditor";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient, fmtDate } from "@/lib/admin";
import { profileMap } from "@/lib/case-data";
import { ARCHES, FILE_CATEGORIES, fmtDay, fmtMoney, SEXES } from "@/lib/cases";
import { WO_STATUS, WORK_KINDS, type WorkOrder } from "@/lib/partners";
import { addWorkMessage, partnerWorkAction, sendFileToAgent, setWorkOrderCost, setWorkOrderStatus, updateWorkOrder } from "../../_actions/partners";
import { CurrencyField } from "@/components/admin/CurrencyField";

export const metadata = { title: "Work order" };
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

type Brief = { case_code: string; service: string | null; patient_ref: string; patient_age: number | null; patient_sex: string | null; arches: string | null; description: string | null;
  priority: string; case_status: string; country: string; records: { title: string; text: string }[] | null; treating_doctor: string | null; plan_approved_at: string | null };

export default async function WorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaff((u) => can.caseStaff(u) || can.partner(u));
  const staff = can.caseStaff(user);
  const ops = can.ops(user);
  const fin = can.finance(user);
  const db = await createSessionClient();
  const { data } = await db.from("case_assignments").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const o = data as WorkOrder;
  const [{ data: brief }, { data: files }, { data: events }, { data: partner }, { data: cost }] = await Promise.all([
    db.rpc("work_order_brief", { p_id: id }),
    db.from("case_files").select("*").eq("case_id", o.case_id).order("created_at"),
    db.from("assignment_events").select("*").eq("assignment_id", id).order("created_at"),
    db.from("partners").select("id,name,kind").eq("id", o.partner_id).single(),
    fin || !staff ? db.from("assignment_costs").select("cost_amount,currency").eq("assignment_id", id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const b = brief as Brief | null;
  const people = await profileMap(db, [...(events ?? []).map((e) => e.author_id), ...(files ?? []).map((f) => f.uploaded_by)]);
  const st = WO_STATUS[o.status];
  const isLab = o.kind === "production";
  const act = partnerWorkAction.bind(null, id);
  const open = !["received", "cancelled", "rejected"].includes(o.status);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="small"><Link href="/admin/work">← Work orders</Link>{staff ? <> · <Link href={`/admin/cases/${o.case_id}`}>Case {b?.case_code}</Link></> : null}</div>
          <h1><span className="mono">{o.order_no}</span> <span className={`pill ${st?.tone}`}>{st?.en} · {st?.ar}</span></h1>
          <div className="sub">{WORK_KINDS[o.kind]?.en} · {WORK_KINDS[o.kind]?.ar} · {partner?.name} · case <span className="mono">{b?.case_code}</span>{o.due_date ? ` · due ${fmtDay(o.due_date)}` : ""}</div>
        </div>
        <div className="btn-row"><a className="btn secondary" href={`/admin/print/work-order/${id}`} target="_blank" rel="noopener">🖨 Work order · أمر العمل</a></div>
      </div>

      {/* Partner actions */}
      {!staff && open ? (
        <section className="confirm-box">
          {o.status === "assigned" ? (
            <>
              <h3>New work order — do you accept it? · هل تقبل أمر العمل؟</h3>
              <ActionForm action={act} className="form-grid">
                <div className="field full"><label htmlFor="wa-note">Note (required if you decline)</label><input id="wa-note" type="text" name="note" maxLength={1000} placeholder="e.g. ready in 3 days" /></div>
                <div className="full btn-row">
                  <SubmitButton name="action" value="accept" className="btn teal">✓ Accept · قبول</SubmitButton>
                  <SubmitButton name="action" value="reject" className="btn danger">Decline · اعتذار</SubmitButton>
                </div>
              </ActionForm>
            </>
          ) : null}
          {o.status === "accepted" ? (
            <ActionForm action={act} className="btn-row"><SubmitButton name="action" value="start" className="btn secondary">▶ Start work · بدء التنفيذ</SubmitButton></ActionForm>
          ) : null}
          {["accepted", "in_progress"].includes(o.status) ? (
            <>
              <h3 style={{ marginTop: 10 }}>{isLab ? "Finished production?" : "Finished the treatment plan?"} · {isLab ? "انتهى التصنيع؟" : "انتهت الخطة؟"}</h3>
              <p className="small muted" style={{ marginTop: 0 }}>{isLab ? "Upload photos of the finished work below, then mark it completed or shipped." : "Upload the plan files (setup, report, video) below first, then mark the order completed."}</p>
              <ActionForm action={act} className="form-grid">
                <div className="field full"><label htmlFor="wc-note">Note to RUKN</label><input id="wc-note" type="text" name="note" maxLength={1000} placeholder={isLab ? "e.g. 22 aligners + 2 retainers, packed" : "e.g. 18 steps, IPR 0.3 mm on 3-4"} /></div>
                <div className="full"><SubmitButton name="action" value="complete" className="btn teal">✓ Mark completed · تم الإنجاز</SubmitButton></div>
              </ActionForm>
            </>
          ) : null}
          {isLab && ["accepted", "in_progress", "completed"].includes(o.status) ? (
            <>
              <h3 style={{ marginTop: 10 }}>📦 Ship to RUKN · الشحن إلى ركن</h3>
              <ActionForm action={act} className="form-grid">
                <div className="field"><label htmlFor="ws-car">Carrier</label><input id="ws-car" type="text" name="carrier" maxLength={80} /></div>
                <div className="field"><label htmlFor="ws-trk">Tracking number</label><input id="ws-trk" type="text" name="tracking_no" maxLength={120} /></div>
                <div className="field full"><label htmlFor="ws-note">Contents / note</label><input id="ws-note" type="text" name="note" maxLength={1000} /></div>
                <div className="full"><SubmitButton name="action" value="ship" className="btn secondary">Mark shipped · تم الشحن</SubmitButton></div>
              </ActionForm>
            </>
          ) : null}
          {o.status === "completed" && !isLab ? <p className="small" style={{ margin: 0 }}>✓ Completed — RUKN will review your work. You can now include this order in a bill (My bills).</p> : null}
          {o.status === "shipped" ? <p className="small" style={{ margin: 0 }}>📦 Shipped{o.carrier ? ` with ${o.carrier}` : ""}{o.tracking_no ? ` · ${o.tracking_no}` : ""}. You can include this order in a bill (My bills).</p> : null}
        </section>
      ) : null}

      <div className="cols case-cols">
        <div>
          <section className="panel">
            <h2>Case brief · ملخص الحالة</h2>
            {b ? (
              <dl className="kv">
                <dt>Case</dt><dd className="mono">{b.case_code}{b.priority === "urgent" ? <span className="pill changes" style={{ marginInlineStart: 6 }}>urgent</span> : null}</dd>
                <dt>Service</dt><dd>{b.service ?? "—"}</dd>
                <dt>Patient ref.</dt><dd>{b.patient_ref}</dd>
                <dt>Age / sex</dt><dd>{b.patient_age ?? "—"} / {b.patient_sex ? SEXES[b.patient_sex]?.en : "—"}</dd>
                <dt>Arches</dt><dd>{b.arches ? ARCHES[b.arches]?.en : "—"}</dd>
                {b.treating_doctor ? <><dt>Treating doctor</dt><dd>{b.treating_doctor}</dd></> : null}
                {b.plan_approved_at ? <><dt>Plan approved</dt><dd>{fmtDate(b.plan_approved_at)}</dd></> : null}
                <dt>Clinical notes</dt><dd style={{ whiteSpace: "pre-line" }}>{b.description ?? "—"}</dd>
                {b.records?.length ? <><dt>Records</dt><dd>{b.records.map((r) => `${r.title}${r.text ? ` (${r.text})` : ""}`).join(" · ")}</dd></> : null}
              </dl>
            ) : <p className="muted">Not available.</p>}
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Files · الملفات</h2><span className="small muted">{(files ?? []).length} file(s)</span></div>
            {(files ?? []).length ? (
              <div className="table-scroll">
                <table className="data">
                  <thead><tr><th>File</th><th>Type</th><th>Size</th><th>From</th><th /></tr></thead>
                  <tbody>
                    {(files ?? []).map((f) => (
                      <tr key={f.id}>
                        <td><a href={`/admin/cases/${o.case_id}/files/${f.id}`}>{f.filename}</a>
                          {f.internal ? <div><span className="pill changes">from partner{staff ? " · not sent to agent" : ""}</span></div> : f.is_deliverable ? <div><span className="pill qualified">from RUKN</span></div> : null}</td>
                        <td className="small">{FILE_CATEGORIES[f.category]?.en ?? f.category}</td>
                        <td className="small">{f.size_bytes ? kb(Number(f.size_bytes)) : "—"}</td>
                        <td className="small muted">{people.get(f.uploaded_by)?.name ?? (f.internal ? partner?.name : "Clinic / agent")}<br />{fmtDate(f.created_at)}</td>
                        <td className="actions">
                          <a className="btn secondary small" href={`/admin/cases/${o.case_id}/files/${f.id}`}>Download</a>
                          {ops && f.internal ? (
                            <ActionForm action={sendFileToAgent} className="inline-ai">
                              <input type="hidden" name="id" value={f.id} />
                              <SubmitButton className="btn teal small" pendingText="Sending…">Send to agent →</SubmitButton>
                            </ActionForm>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="small muted">No files yet.</p>}
            {open && (ops || !staff) ? (
              <div style={{ marginTop: 12 }}>
                <h3 style={{ fontSize: "1rem", margin: "0 0 6px" }}>{staff ? "Upload for the partner" : "Upload your work · رفع ملفاتكم"}</h3>
                <CaseFileUploader caseId={o.case_id} staff={staff} categories={staff ? undefined : ["treatment_plan", "photos", "other"]} defaultCategory={staff ? "other" : isLab ? "photos" : "treatment_plan"} />
                {!staff ? <p className="small muted">Your files go to RUKN only; RUKN reviews them before anything is sent to the clinic.</p> : null}
              </div>
            ) : null}
          </section>
        </div>

        <div>
          <section className="panel">
            <h2>Order · أمر العمل</h2>
            <dl className="kv">
              <dt>Work</dt><dd><strong>{o.title}</strong></dd>
              {o.instructions ? <><dt>Instructions</dt><dd style={{ whiteSpace: "pre-line" }}>{o.instructions}</dd></> : null}
              {o.items?.length ? <><dt>Items</dt><dd><ul style={{ margin: 0, paddingInlineStart: 18 }}>{o.items.map((i, n) => <li key={n}>{i.title}{i.text ? ` — ${i.text}` : ""}</li>)}</ul></dd></> : null}
              <dt>Due date</dt><dd>{o.due_date ? fmtDay(o.due_date) : "—"}</dd>
              {fin || !staff ? <><dt>Agreed cost</dt><dd><strong>{cost?.cost_amount != null ? fmtMoney(cost.cost_amount, cost.currency) : "—"}</strong></dd></> : null}
              {o.accepted_at ? <><dt>Accepted</dt><dd>{fmtDate(o.accepted_at)}</dd></> : null}
              {o.completed_at ? <><dt>Completed</dt><dd>{fmtDate(o.completed_at)}</dd></> : null}
              {o.shipped_at ? <><dt>Shipped</dt><dd>{fmtDate(o.shipped_at)}{o.carrier ? ` · ${o.carrier}` : ""}{o.tracking_no ? ` · ${o.tracking_no}` : ""}</dd></> : null}
              {o.received_at ? <><dt>Received by RUKN</dt><dd>{fmtDate(o.received_at)}</dd></> : null}
              {o.partner_note ? <><dt>Partner note</dt><dd>{o.partner_note}</dd></> : null}
            </dl>
          </section>

          {fin ? (
            <section className="panel">
              <h2>Agreed cost · التكلفة المتفق عليها</h2>
              <ActionForm action={setWorkOrderCost.bind(null, id)} className="form-grid">
                <div className="field"><label htmlFor="wc-amt">Cost</label><input id="wc-amt" type="number" name="cost_amount" min="0" step="0.01" defaultValue={cost?.cost_amount ?? ""} /></div>
                <CurrencyField id="wc-cur" name="currency" defaultValue={cost?.currency ?? "USD"} />
                <div className="full"><SubmitButton className="btn secondary small">Save cost</SubmitButton></div>
              </ActionForm>
            </section>
          ) : null}
          {ops ? (
            <section className="panel">
              <h2>RUKN actions</h2>
              <ActionForm action={setWorkOrderStatus.bind(null, id)} className="form-grid">
                <div className="field"><label htmlFor="ws-status">Set status</label>
                  <select id="ws-status" name="status" defaultValue={["completed", "shipped"].includes(o.status) ? "received" : "received"}>
                    <option value="received">Received / checked by RUKN · تم الاستلام</option>
                    <option value="completed">Completed</option>
                    <option value="assigned">Re-open (back to partner)</option>
                    <option value="cancelled">Cancel order</option>
                  </select>
                </div>
                <div className="field"><label htmlFor="ws-note2">Note</label><input id="ws-note2" type="text" name="note" maxLength={1000} /></div>
                <div className="full"><SubmitButton className="btn secondary">Update</SubmitButton></div>
              </ActionForm>
              <details style={{ marginTop: 10 }}>
                <summary className="small"><strong>Edit order</strong></summary>
                <ActionForm action={updateWorkOrder.bind(null, id)} className="form-grid">
                  <div className="field full"><label htmlFor="we-title">Work</label><input id="we-title" type="text" name="title" maxLength={200} defaultValue={o.title} /></div>
                  <div className="field full"><label htmlFor="we-ins">Instructions</label><textarea id="we-ins" name="instructions" rows={3} maxLength={4000} defaultValue={o.instructions ?? ""} dir="auto" /></div>
                  <div className="field full"><label>Items (item → quantity)</label><ItemsEditor name="items" initial={o.items ?? []} dir="ltr" /></div>
                  <div className="field"><label htmlFor="we-due">Due date</label><input id="we-due" type="date" name="due_date" defaultValue={o.due_date ?? ""} /></div>
                  <div className="full"><SubmitButton className="btn secondary small">Save order</SubmitButton></div>
                </ActionForm>
              </details>
            </section>
          ) : null}

          <section className="panel">
            <h2>Messages & history · الرسائل والسجل</h2>
            <ul className="timeline">
              {(events ?? []).map((e) => (
                <li key={e.id}>
                  {e.kind === "status" ? <span className="small muted">Status: </span> : "💬 "}{e.body}
                  <div className="small muted">{people.get(e.author_id)?.name ?? (e.author_id === user.id ? "You" : e.author_id ? partner?.name : "System")} · {fmtDate(e.created_at)}</div>
                </li>
              ))}
            </ul>
            <ActionForm action={addWorkMessage.bind(null, id)} resetOnSuccess>
              <div className="field"><label htmlFor="wm-body">Message</label><textarea id="wm-body" name="body" rows={2} maxLength={4000} required dir="auto" placeholder={staff ? `Message to ${partner?.name}` : "Message to RUKN"} /></div>
              <SubmitButton className="btn small">Send</SubmitButton>
            </ActionForm>
          </section>
        </div>
      </div>
    </>
  );
}
