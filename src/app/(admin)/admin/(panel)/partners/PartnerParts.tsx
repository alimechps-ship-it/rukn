import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { fmtDay, fmtMoney } from "@/lib/cases";
import { BILL_STATUS, PARTNER_KINDS, WO_STATUS, WORK_KINDS, type Partner, type WorkOrder } from "@/lib/partners";
import { ItemsEditor } from "@/components/admin/ItemsEditor";
import { createPartnerBill, deletePartnerBill, reviewPartnerBill, savePartner, voidPartnerBill } from "../_actions/partners";

export function PartnerFields({ p }: { p?: Partner }) {
  const k = p?.id ?? "new";
  const T = (name: keyof Partner, label: string, max: number, extra: Record<string, unknown> = {}) => (
    <div className="field"><label htmlFor={`${name}-${k}`}>{label}</label><input id={`${name}-${k}`} type="text" name={name} maxLength={max} defaultValue={(p?.[name] as string) ?? ""} {...extra} /></div>
  );
  return (
    <>
      {!p ? (
        <div className="field"><label htmlFor={`kind-${k}`}>Type · النوع *</label>
          <select id={`kind-${k}`} name="kind" defaultValue="lab">{Object.entries(PARTNER_KINDS).map(([v, x]) => <option key={v} value={v}>{x.en} · {x.ar}</option>)}</select>
        </div>
      ) : null}
      {T("name", "Clinic / lab name · الاسم *", 120, { required: true })}
      {T("contact_name", "Contact person · المسؤول", 120)}
      {T("phone", "Phone / WhatsApp", 40)}
      {T("email", "E-mail", 200)}
      {T("country", "Country", 80)}
      {T("city", "City", 80)}
      {T("currency", "Currency of their prices", 3)}
      {T("tax_number", "Tax / registration no.", 60)}
      <div className="field full"><label htmlFor={`address-${k}`}>Address</label><input id={`address-${k}`} type="text" name="address" maxLength={300} defaultValue={p?.address ?? ""} /></div>
      <div className="field full"><label htmlFor={`bank-${k}`}>Bank / payment details · بيانات الدفع لهم</label><textarea id={`bank-${k}`} name="bank_details" rows={3} maxLength={1000} defaultValue={p?.bank_details ?? ""} dir="auto" /></div>
      <div className="field full"><label htmlFor={`notes-${k}`}>Notes (internal)</label><textarea id={`notes-${k}`} name="notes" rows={2} maxLength={1000} defaultValue={p?.notes ?? ""} dir="auto" /></div>
      {p ? <div className="field full"><label className="check"><input type="checkbox" name="active" defaultChecked={p.active} /> Active (can receive work orders)</label></div> : null}
    </>
  );
}

export function PartnerForm({ p }: { p?: Partner }) {
  return (
    <ActionForm action={savePartner.bind(null, p?.id ?? null)} className="form-grid" resetOnSuccess={!p}>
      <PartnerFields p={p} />
      <div className="full"><SubmitButton className={`btn ${p ? "" : "teal"}`}>{p ? "Save partner" : "Add partner"}</SubmitButton></div>
    </ActionForm>
  );
}

export function WorkOrdersTable({ orders, partnerNames, caseCodes, showPartner, showCase }: {
  orders: WorkOrder[]; partnerNames?: Map<string, string>; caseCodes?: Map<string, string>; showPartner?: boolean; showCase?: boolean;
}) {
  if (!orders.length) return <p className="small muted">No work orders yet.</p>;
  return (
    <div className="table-scroll">
      <table className="data">
        <thead><tr><th>Order</th>{showCase ? <th>Case</th> : null}{showPartner ? <th>Partner</th> : null}<th>Work</th><th>Due</th><th>Status</th><th className="num">Agreed cost</th></tr></thead>
        <tbody>
          {orders.map((o) => {
            const st = WO_STATUS[o.status];
            const late = o.due_date && ["assigned", "accepted", "in_progress"].includes(o.status) && o.due_date < new Date().toISOString().slice(0, 10);
            return (
              <tr key={o.id} className="row-link">
                <td className="mono nowrap"><Link className="stretched" href={`/admin/work/${o.id}`}>{o.order_no}</Link></td>
                {showCase ? <td className="mono small">{caseCodes?.get(o.case_id) ?? "—"}</td> : null}
                {showPartner ? <td className="small">{partnerNames?.get(o.partner_id) ?? "—"}</td> : null}
                <td><span className="small muted">{WORK_KINDS[o.kind]?.en} · </span>{o.title}</td>
                <td className="small nowrap" style={late ? { color: "#b42318", fontWeight: 600 } : undefined}>{o.due_date ? fmtDay(o.due_date) : "—"}{late ? " · late" : ""}</td>
                <td><span className={`pill ${st?.tone}`}>{st?.en}</span></td>
                <td className="num nowrap">{o.cost_amount !== null ? fmtMoney(o.cost_amount, o.currency) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export interface Bill { id: string; bill_no: string; partner_id: string; partner_ref: string | null; bill_date: string; due_date: string | null; currency: string; total: number; status: string; notes: string | null; review_note: string | null; created_by: string | null }

export function BillsTable({ bills, staff, partnerNames, paidByBill, me }: {
  bills: Bill[]; staff: boolean; partnerNames?: Map<string, string>; paidByBill: Map<string, number>; me?: string;
}) {
  if (!bills.length) return <p className="small muted">No bills yet.</p>;
  return (
    <ul className="notice-list">
      {bills.map((b) => {
        const st = BILL_STATUS[b.status];
        const paid = paidByBill.get(b.id) ?? 0;
        return (
          <li key={b.id} className={`notice ${b.status === "submitted" ? "pending" : b.status === "approved" ? "" : "rejected"}`}>
            <div className="notice-head">
              <div>
                <span className="mono"><strong>{b.bill_no}</strong></span> <span className={`pill ${st?.tone}`}>{st?.en} · {st?.ar}</span>
                {partnerNames ? <> · <Link href={`/admin/partners/${b.partner_id}`}>{partnerNames.get(b.partner_id)}</Link></> : null}
                <div className="small muted">{fmtDay(b.bill_date)}{b.partner_ref ? ` · their ref. ${b.partner_ref}` : ""}{b.due_date ? ` · due ${fmtDay(b.due_date)}` : ""}</div>
              </div>
              <div className="notice-amount">{fmtMoney(b.total, b.currency)}{b.status === "approved" ? <div className="small muted" style={{ fontWeight: 400 }}>paid {fmtMoney(paid, b.currency)} · due {fmtMoney(Number(b.total) - paid, b.currency)}</div> : null}</div>
            </div>
            {b.review_note ? <div className="small"><strong>{b.status === "rejected" ? "Reason:" : "Note:"}</strong> {b.review_note}</div> : null}
            <div className="btn-row" style={{ marginTop: 6 }}>
              <a className="btn secondary small" href={`/admin/print/partner-bill/${b.id}`} target="_blank" rel="noopener">🖨 Print bill</a>
              {b.status === "submitted" && (staff || b.created_by === me) ? <ConfirmAction action={deletePartnerBill} hidden={{ id: b.id }} label="Withdraw" title="Withdraw this bill?" message="It is deleted; the work orders can be billed again." confirmLabel="Withdraw" /> : null}
              {staff && b.status === "approved" && paid === 0 ? <ConfirmAction action={voidPartnerBill} hidden={{ id: b.id, reason: "Voided by RUKN" }} danger label="Void" title="Void this bill?" message="It stays on record with a VOID mark." confirmLabel="Void" /> : null}
            </div>
            {staff && b.status === "submitted" ? (
              <div className="notice-review">
                <ActionForm action={reviewPartnerBill} className="form-grid">
                  <input type="hidden" name="id" value={b.id} />
                  <div className="field full"><label htmlFor={`bn-${b.id}`}>Note (required when rejecting)</label><input id={`bn-${b.id}`} type="text" name="note" maxLength={300} /></div>
                  <div className="full btn-row">
                    <SubmitButton name="decision" value="approve" className="btn teal small">✓ Approve bill · اعتماد</SubmitButton>
                    <SubmitButton name="decision" value="reject" className="btn danger small">Reject · رفض</SubmitButton>
                  </div>
                </ActionForm>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** New bill: tick completed (unbilled) work orders; optional extra lines (description → amount). */
export function NewBillForm({ partnerId, currency, orders, caseCodes }: { partnerId?: string; currency: string; orders: WorkOrder[]; caseCodes?: Map<string, string> }) {
  return (
    <ActionForm action={createPartnerBill} className="form-grid" resetOnSuccess>
      {partnerId ? <input type="hidden" name="partner_id" value={partnerId} /> : null}
      <div className="field full">
        <label>Completed work orders to bill · أوامر العمل المكتملة</label>
        {orders.length ? (
          <div className="check-list">
            {orders.map((o) => (
              <label key={o.id} className="check">
                <input type="checkbox" name="wo" value={o.id} defaultChecked />
                <span><span className="mono">{o.order_no}</span> — {o.title}{caseCodes?.get(o.case_id) ? ` (${caseCodes.get(o.case_id)})` : ""} · <strong>{o.cost_amount !== null ? fmtMoney(o.cost_amount, o.currency) : "no agreed price"}</strong></span>
              </label>
            ))}
          </div>
        ) : <p className="small muted" style={{ margin: 0 }}>No completed work orders waiting to be billed.</p>}
      </div>
      <div className="field full">
        <label>Other lines (description → amount in {currency}) · بنود أخرى</label>
        <ItemsEditor name="extra" initial={[]} dir="ltr" />
      </div>
      <div className="field"><label htmlFor={`pref-${partnerId ?? "me"}`}>Your invoice number · رقم فاتورتكم</label><input id={`pref-${partnerId ?? "me"}`} type="text" name="partner_ref" maxLength={60} /></div>
      <div className="field"><label htmlFor={`bdate-${partnerId ?? "me"}`}>Bill date</label><input id={`bdate-${partnerId ?? "me"}`} type="date" name="bill_date" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
      <div className="field"><label htmlFor={`bdue-${partnerId ?? "me"}`}>Due date</label><input id={`bdue-${partnerId ?? "me"}`} type="date" name="due_date" /></div>
      <div className="field"><label htmlFor={`bnotes-${partnerId ?? "me"}`}>Notes</label><input id={`bnotes-${partnerId ?? "me"}`} type="text" name="notes" maxLength={1000} /></div>
      <div className="full"><SubmitButton className="btn teal">{partnerId ? "Record bill" : "Send bill to RUKN · إرسال الفاتورة"}</SubmitButton></div>
    </ActionForm>
  );
}
