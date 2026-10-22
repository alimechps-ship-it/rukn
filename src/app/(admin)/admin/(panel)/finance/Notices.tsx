import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { fmtDay, fmtMoney, PAYMENT_METHODS } from "@/lib/cases";
import { acceptPaymentNotice, cancelPaymentNotice, recheckReceipt, rejectPaymentNotice } from "../_actions/payments";

const AI_TONE: Record<string, { cls: string; en: string }> = {
  match: { cls: "ai-ok", en: "AI check: matches" },
  mismatch: { cls: "ai-warn", en: "AI check: differences found" },
  unreadable: { cls: "ai-muted", en: "AI check: not readable" },
  error: { cls: "ai-muted", en: "AI check failed" },
};

export const NOTICE_STATUS: Record<string, { en: string; ar: string; tone: string }> = {
  pending: { en: "Awaiting confirmation", ar: "بانتظار التأكيد", tone: "changes" },
  accepted: { en: "Confirmed", ar: "تم التأكيد", tone: "published" },
  rejected: { en: "Not accepted", ar: "مرفوض", tone: "closed" },
  cancelled: { en: "Withdrawn", ar: "مسحوب", tone: "archived" },
};

export interface Notice {
  id: string; notice_no: string; case_id: string | null; invoice_id: string | null; amount: number; currency: string; method: string; paid_at: string;
  reference: string | null; notes: string | null; proof_file_id: string | null; proof_path?: string | null; agent_id?: string | null; status: string; submitted_by: string | null;
  reviewed_at: string | null; review_note: string | null; payment_id: string | null; created_at: string;
  ai_status?: string | null; ai_summary?: string | null; ai_checked_at?: string | null;
}

export function NoticesTable({ notices, staff, boxes, caseCodes, invoiceNos, receiptNos, names, showCase, aiEnabled = false }: {
  notices: Notice[]; staff: boolean; boxes: { id: string; name: string; currency: string }[];
  caseCodes?: Map<string, string>; invoiceNos: Map<string, string>; receiptNos: Map<string, { no: string; id: string }>; names: Map<string, string>; showCase?: boolean;
  aiEnabled?: boolean;
}) {
  if (!notices.length) return <p className="small muted">No payment notices yet.</p>;
  return (
    <ul className="notice-list">
      {notices.map((n) => {
        const st = NOTICE_STATUS[n.status];
        const receipt = n.payment_id ? receiptNos.get(n.payment_id) : undefined;
        return (
          <li key={n.id} className={`notice ${n.status}`}>
            <div className="notice-head">
              <div>
                <span className="mono"><strong>{n.notice_no}</strong></span> <span className={`pill ${st.tone}`}>{st.en} · {st.ar}</span>
                {showCase && caseCodes ? (n.case_id ? <> · <Link className="mono small" href={`/admin/cases/${n.case_id}`}>{caseCodes.get(n.case_id)}</Link></> : <> · <span className="pill new">On account / advance · دفعة على الحساب</span></>) : null}
                <div className="small muted">
                  {PAYMENT_METHODS[n.method]?.en} · {fmtDay(n.paid_at)}{n.reference ? ` · ref. ${n.reference}` : ""}
                  {n.invoice_id ? ` · for ${invoiceNos.get(n.invoice_id) ?? "invoice"}` : ""}{n.submitted_by ? ` · sent by ${names.get(n.submitted_by) ?? ""}` : ""}
                </div>
              </div>
              <div className="notice-amount">{fmtMoney(n.amount, n.currency)}</div>
            </div>
            {n.notes ? <div className="small">“{n.notes}”</div> : null}
            <div className="btn-row" style={{ marginTop: 6 }}>
              {n.proof_file_id || n.proof_path ? <a className="btn secondary small" href={`/admin/payment-proof/${n.id}`} target="_blank" rel="noopener">📎 Proof of payment</a> : <span className="small muted">No proof attached</span>}
              {receipt ? <a className="btn secondary small" href={`/admin/print/payment/${receipt.id}`} target="_blank" rel="noopener">🖨 Receipt {receipt.no}</a> : null}
              {!staff && n.status === "pending" ? <ConfirmAction action={cancelPaymentNotice} hidden={{ id: n.id, case_id: n.case_id ?? "" }} label="Withdraw" title="Withdraw this payment notice?" message="Use this if the amount or details were wrong; then send a new notice." confirmLabel="Withdraw" /> : null}
            </div>
            {staff && n.ai_status ? (
              <div className={`ai-box ${AI_TONE[n.ai_status]?.cls ?? ""}`}>
                <strong>🤖 {AI_TONE[n.ai_status]?.en}</strong>
                <div dir="auto">{n.ai_summary}</div>
              </div>
            ) : null}
            {staff && aiEnabled && (n.proof_file_id || n.proof_path) && n.status === "pending" ? (
              <ActionForm action={recheckReceipt} className="inline-ai">
                <input type="hidden" name="id" value={n.id} />
                <input type="hidden" name="case_id" value={n.case_id ?? ""} />
                <SubmitButton className="btn secondary small" pendingText="Reading the receipt…">🤖 {n.ai_status ? "Re-check" : "Check"} receipt with AI</SubmitButton>
              </ActionForm>
            ) : null}
            {n.review_note && n.status !== "pending" ? <div className="small" style={{ marginTop: 4 }}><strong>{n.status === "rejected" ? "Reason:" : "Note:"}</strong> {n.review_note}</div> : null}
            {staff && n.status === "pending" ? (
              <div className="notice-review">
                <ActionForm action={acceptPaymentNotice} className="form-grid">
                  <input type="hidden" name="id" value={n.id} />
                  <input type="hidden" name="case_id" value={n.case_id ?? ""} />
                  <div className="field"><label htmlFor={`acc-box-${n.id}`}>Deposit into · إيداع في</label>
                    <select id={`acc-box-${n.id}`} name="cash_account_id" defaultValue={boxes.find((b) => b.currency === n.currency)?.id ?? ""}>
                      <option value="">— record only, no cash box —</option>
                      {boxes.filter((b) => b.currency === n.currency).map((b) => <option key={b.id} value={b.id}>{b.name} ({b.currency})</option>)}
                    </select>
                  </div>
                  <div className="field"><label htmlFor={`acc-amt-${n.id}`}>Amount received</label><input id={`acc-amt-${n.id}`} type="number" name="amount" step="0.01" min="0.01" defaultValue={Number(n.amount)} /></div>
                  <div className="field full"><label htmlFor={`acc-note-${n.id}`}>Note (optional)</label><input id={`acc-note-${n.id}`} type="text" name="note" maxLength={300} placeholder="e.g. bank statement checked" /></div>
                  <div className="full"><SubmitButton className="btn teal small" pendingText="Confirming…">✓ Confirm payment & issue receipt · تأكيد القبض</SubmitButton></div>
                </ActionForm>
                <details style={{ marginTop: 8 }}>
                  <summary className="small"><strong>Reject…</strong></summary>
                  <ActionForm action={rejectPaymentNotice} className="form-grid">
                    <input type="hidden" name="id" value={n.id} />
                    <input type="hidden" name="case_id" value={n.case_id ?? ""} />
                    <div className="field full"><label htmlFor={`rej-${n.id}`}>Reason (the agent sees it) *</label><input id={`rej-${n.id}`} type="text" name="reason" maxLength={300} required placeholder="e.g. transfer not received yet / amount differs" /></div>
                    <div className="full"><SubmitButton className="btn danger small">Reject notice</SubmitButton></div>
                  </ActionForm>
                </details>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
