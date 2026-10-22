import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { InvoiceEditor } from "@/components/admin/InvoiceEditor";
import { can, requireStaff } from "@/lib/auth";
import { docCredits } from "@/lib/journal";
import { createSessionClient, fmtDate } from "@/lib/admin";
import { fmtDay, fmtMoney, PAYMENT_METHODS } from "@/lib/cases";
import { INVOICE_STATUS, LINE_ARCHES, type InvoiceLine, type PriceItem } from "@/lib/invoices";
import { deleteInvoice, saveInvoice, voidInvoice } from "../../../../_actions/invoices";

export const metadata = { title: "Invoice" };

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string; invId: string }>; searchParams: Promise<{ issued?: string; revised?: string; was?: string }> }) {
  const { id, invId } = await params;
  const sp = await searchParams;
  const user = await requireStaff((u) => can.finance(u) || (can.cases(u) && !can.caseStaff(u)));
  const staff = can.finance(user);
  const db = await createSessionClient();
  const [{ data: inv }, { data: c }] = await Promise.all([
    db.from("case_invoices").select("*").eq("id", invId).eq("case_id", id).maybeSingle(),
    db.from("cases").select("id,code,clinic_name,doctor_name,patient_ref,service_label").eq("id", id).maybeSingle(),
  ]);
  if (!inv || !c) notFound();
  const [{ data: items }, { data: payments }, { data: catalog }] = await Promise.all([
    db.from("case_invoice_items").select("*").eq("invoice_id", invId).order("sort_order"),
    db.from("case_payments").select("*").eq("invoice_id", invId).order("created_at"),
    staff && inv.status !== "void"
      ? db.from("case_price_items").select("*").eq("active", true).order("sort_order").order("code")
      : Promise.resolve({ data: [] as PriceItem[] }),
  ]);
  const st = INVOICE_STATUS[inv.status];
  const paid = (payments ?? []).filter((p) => !p.voided).reduce((a, p) => a + Number(p.amount), 0);
  const credit = (await docCredits(db, { invoiceIds: [invId] })).get(invId) ?? 0; // discounts / offsets on this invoice
  const lines: InvoiceLine[] = (items ?? []).map((l) => ({
    price_item_id: l.price_item_id, code: l.code, description: l.description, description_ar: l.description_ar,
    arch: l.arch, unit: l.unit, qty: Number(l.qty), unit_price: Number(l.unit_price),
  }));

  const paymentsPanel = (
            <section className="panel">
              <h2>Payments on this invoice · المدفوعات</h2>
              {(payments ?? []).length ? (
                <table className="data"><tbody>{(payments ?? []).map((p) => (
                  <tr key={p.id} style={p.voided ? { opacity: 0.5 } : undefined}>
                    <td className="mono">{p.receipt_no}{p.voided ? " (void)" : ""}</td><td>{fmtMoney(p.amount, p.currency)}</td>
                    <td className="small">{PAYMENT_METHODS[p.method]?.en} · {fmtDay(p.paid_at)}</td>
                    <td><a className="btn secondary small" href={`/admin/print/case/${id}/receipt?p=${p.id}`} target="_blank" rel="noopener">🖨</a></td>
                  </tr>
                ))}</tbody></table>
              ) : <p className="small muted">No payments yet.{staff && inv.status === "issued" ? " Record one from the case page (Quotation & payments)." : ""}</p>}
            </section>
  );
  const voidPanel = (
    <section className="panel">
      <h2>Void invoice · إلغاء الفاتورة</h2>
      <p className="small muted">To cancel the invoice completely, void it. It stays on record with a VOID mark and its payments remain listed.</p>
      <ActionForm action={voidInvoice}>
        <input type="hidden" name="id" value={inv.id} />
        <div className="field"><label htmlFor="void-reason">Reason *</label><input id="void-reason" type="text" name="reason" maxLength={300} required /></div>
        <SubmitButton className="btn danger">Void invoice</SubmitButton>
      </ActionForm>
    </section>
  );

  return (
    <>
      <div className="topbar">
        <div>
          <div className="small"><Link href={`/admin/cases/${id}`}>← {c.code}</Link></div>
          <h1>{inv.invoice_no ? <span className="mono">{inv.invoice_no}</span> : "Draft invoice"} <span className={`pill ${st.tone}`}>{st.en} · {st.ar}</span>{inv.revision ? <span className="pill changes" style={{ marginInlineStart: 6 }}>rev. {inv.revision}</span> : null}</h1>
          <div className="sub">{c.clinic_name} · {c.doctor_name} · patient {c.patient_ref}{c.service_label ? ` · ${c.service_label}` : ""}</div>
        </div>
        <div className="btn-row">
          <a className="btn secondary" href={`/admin/print/invoice/${inv.id}`} target="_blank" rel="noopener">🖨 {inv.status === "draft" ? "Preview / print" : "Print invoice"}</a>
          {staff && inv.status === "draft" ? <ConfirmAction action={deleteInvoice} hidden={{ id: inv.id }} danger label="Delete draft" title="Delete this draft?" message="The draft and its lines are removed. Issued invoices are never deleted." confirmLabel="Delete" /> : null}
        </div>
      </div>
      {sp.revised ? <div className="flash ok">Invoice {inv.invoice_no} updated — revision {sp.revised}. Total {sp.was ?? ""} → {Number(inv.total).toFixed(2)} {inv.currency}. The change is on the case timeline.</div> : null}
      {sp.issued ? <div className="flash ok">Invoice {inv.invoice_no} issued — it is now visible to the agent. Print it or record a payment against it on the case page.</div> : null}
      {inv.revision && inv.revised_at ? <div className="small muted" style={{ marginBottom: 10 }}>Last revised {fmtDate(inv.revised_at)} — every revision is listed on the case timeline and in the activity log.</div> : null}
      {inv.status === "void" ? <div className="flash err">This invoice was voided{inv.void_reason ? `: ${inv.void_reason}` : ""}. It is kept for the record.</div> : null}

      {staff && inv.status !== "void" ? (
        <>
        {inv.status === "issued" ? <div className="flash warn">You are editing an issued invoice. It keeps its number {inv.invoice_no}; saving records revision {Number(inv.revision) + 1}. Paid so far: {fmtMoney(paid, inv.currency)}{credit ? ` · journal entries ${credit > 0 ? "−" : "+"}${fmtMoney(Math.abs(credit), inv.currency)}` : ""} · <strong>balance due {fmtMoney(Number(inv.total) - paid - credit, inv.currency)}</strong>.</div> : null}
        <section className="panel">
          <InvoiceEditor
            issued={inv.status === "issued"}
            revision={Number(inv.revision)}
            action={saveInvoice.bind(null, inv.id)}
            header={{ currency: inv.currency, issue_date: inv.issue_date, due_date: inv.due_date, bill_to: inv.bill_to, discount_amount: Number(inv.discount_amount), tax_label: inv.tax_label, tax_rate: Number(inv.tax_rate), notes: inv.notes }}
            lines={lines}
            catalog={(catalog ?? []) as PriceItem[]}
          />
          {!(catalog ?? []).length ? <p className="small muted">The price list is empty — add items under <Link href="/admin/price-list">Price list</Link>, or type the lines directly.</p> : null}
        </section>
        {inv.status === "issued" ? <div className="case-cols">{paymentsPanel}{voidPanel}</div> : null}
        </>
      ) : (
        <div className="case-cols">
          <section className="panel">
            <h2>Lines · البنود</h2>
            <div className="table-scroll">
              <table className="data">
                <thead><tr><th>#</th><th>Description</th><th>Arch</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {(items ?? []).map((l, i) => (
                    <tr key={l.id}>
                      <td className="muted">{i + 1}{l.code ? <div className="mono small">{l.code}</div> : null}</td>
                      <td>{l.description}{l.description_ar ? <div className="small muted" dir="rtl">{l.description_ar}</div> : null}</td>
                      <td>{l.arch ? LINE_ARCHES[l.arch]?.en : "—"}</td>
                      <td className="num">{Number(l.qty)}{l.unit ? <span className="small muted"> {l.unit}</span> : null}</td>
                      <td className="num">{fmtMoney(l.unit_price, inv.currency)}</td>
                      <td className="num">{fmtMoney(l.line_total, inv.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="inv-totals" style={{ marginInlineStart: "auto", marginTop: 12 }}>
              <dt>Subtotal</dt><dd>{fmtMoney(inv.subtotal, inv.currency)}</dd>
              {Number(inv.discount_amount) ? <><dt>Discount</dt><dd>− {fmtMoney(Math.min(Number(inv.discount_amount), Number(inv.subtotal)), inv.currency)}</dd></> : null}
              {Number(inv.tax_rate) ? <><dt>{inv.tax_label} {Number(inv.tax_rate)}%</dt><dd>{fmtMoney(inv.tax_amount, inv.currency)}</dd></> : null}
              <dt className="grand">Total</dt><dd className="grand">{fmtMoney(inv.total, inv.currency)}</dd>
              <dt>Paid</dt><dd>{fmtMoney(paid, inv.currency)}</dd>
              {credit ? <><dt>Journal entries · قيود</dt><dd>{credit > 0 ? "− " : "+ "}{fmtMoney(Math.abs(credit), inv.currency)}</dd></> : null}
              <dt><strong>Balance due</strong></dt><dd><strong>{fmtMoney(Number(inv.total) - paid - credit, inv.currency)}</strong></dd>
            </dl>
          </section>
          <div>
            <section className="panel">
              <h2>Details · التفاصيل</h2>
              <dl className="kv">
                <dt>Invoice date</dt><dd>{fmtDay(inv.issue_date)}</dd>
                <dt>Due date</dt><dd>{inv.due_date ? fmtDay(inv.due_date) : "—"}</dd>
                <dt>Issued</dt><dd>{fmtDate(inv.issued_at)}</dd>
                <dt>Bill to</dt><dd style={{ whiteSpace: "pre-line" }}>{inv.bill_to ?? "—"}</dd>
              </dl>
            </section>
            {paymentsPanel}
          </div>
        </div>
      )}
    </>
  );
}
