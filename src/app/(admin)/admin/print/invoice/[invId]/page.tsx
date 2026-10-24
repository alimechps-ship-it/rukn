import { notFound, redirect } from "next/navigation";
import { can, getStaffUser } from "@/lib/auth";
import { docCredits } from "@/lib/journal";
import { advanceAllocation } from "@/lib/allocation";
import { createSessionClient } from "@/lib/admin";
import { profileMap } from "@/lib/case-data";
import { countryName, fmtDay, fmtMoney, PAYMENT_METHODS } from "@/lib/cases";
import { LINE_ARCHES } from "@/lib/invoices";
import { PrintShell } from "../../PrintShell";
import { loadCompany } from "../../company";

export const metadata = { title: "Invoice", robots: { index: false } };
export const dynamic = "force-dynamic";

function H({ en, ar }: { en: string; ar: string }) {
  return <h2><span>{en}</span><span className="ar">{ar}</span></h2>;
}

export default async function PrintInvoice({ params }: { params: Promise<{ invId: string }> }) {
  const { invId } = await params;
  const user = await getStaffUser();
  if (!user) redirect(`/admin/login?next=/admin/print/invoice/${invId}`);
  if (!can.staff(user) || !(can.finance(user) || (can.cases(user) && !can.caseStaff(user)))) redirect("/admin?denied=1");
  const db = await createSessionClient();
  const { data: inv } = await db.from("case_invoices").select("*").eq("id", invId).maybeSingle();
  if (!inv) notFound();
  const [{ data: c }, { data: items }, { data: payments }, { data: billing }, company] = await Promise.all([
    db.from("cases").select("*").eq("id", inv.case_id).maybeSingle(),
    db.from("case_invoice_items").select("*").eq("invoice_id", invId).order("sort_order"),
    db.from("case_payments").select("*").eq("invoice_id", invId).eq("voided", false).order("paid_at"),
    db.from("case_billing_settings").select("*").eq("id", 1).maybeSingle(),
    loadCompany(db),
  ]);
  if (!c) notFound();
  const people = await profileMap(db, [c.agent_id, inv.issued_by, inv.created_by]);
  const agent = people.get(c.agent_id);
  const cur = inv.currency as string;
  const paid = (payments ?? []).reduce((a, p) => a + Number(p.amount), 0);
  const discount = Math.min(Number(inv.discount_amount), Number(inv.subtotal));
  const credit = (await docCredits(db, { invoiceIds: [invId] })).get(invId) ?? 0;
  const { data: invCase } = await db.from("cases").select("agent_id").eq("id", inv.case_id).maybeSingle();
  const advance = inv.status === "issued" && invCase ? (await advanceAllocation(db, [invCase.agent_id as string])).get(invId) ?? 0 : 0; // advance / payment on account applied
  const balance = Number(inv.total) - paid - credit - advance;
  const draft = inv.status === "draft";

  return (
    <PrintShell back={`/admin/cases/${c.id}/invoices/${inv.id}`} company={company} docRef={inv.invoice_no ?? "Draft invoice"}>
      {inv.status === "void" ? <div className="void">VOID</div> : null}
      {draft ? <div className="void" style={{ color: "rgba(16,38,61,.10)", borderColor: "rgba(16,38,61,.10)" }}>DRAFT</div> : null}
      <div className="doc-title">
        <h1>Invoice<span className="ar">فاتورة</span></h1>
        <div className="doc-no">
          <div className="no">{inv.invoice_no ?? "DRAFT"}</div>
          {inv.revision ? <div className="date">Revision · <span className="ar">تعديل</span> {inv.revision}</div> : null}
          <div className="date"><bdi>Date · <span className="ar">التاريخ</span></bdi>: <bdi dir="ltr">{fmtDay(inv.issue_date)}</bdi></div>
          {inv.due_date ? <div className="date"><bdi>Due · <span className="ar">الاستحقاق</span></bdi>: <strong><bdi dir="ltr">{fmtDay(inv.due_date)}</bdi></strong></div> : null}
        </div>
      </div>

      <div className="grid2">
        <div className="box">
          <H en="Bill to" ar="فاتورة إلى" />
          <div style={{ whiteSpace: "pre-line", fontWeight: 600, fontSize: "9.5pt" }} dir="auto">{inv.bill_to ?? `${c.clinic_name} — ${c.doctor_name}`}</div>
        </div>
        <div className="box">
          <H en="Case" ar="الحالة" />
          <dl className="kv2">
            <dt>Case code</dt><dd>{c.code}</dd>
            <dt>Patient ref.</dt><dd>{c.patient_ref}</dd>
            <dt>Doctor</dt><dd>{c.doctor_name}</dd>
            <dt>Country</dt><dd>{countryName(c.country_code)}</dd>
            <dt>Agent</dt><dd>{agent?.name ?? "—"}{agent?.organization ? ` · ${agent.organization}` : ""}</dd>
          </dl>
        </div>
      </div>

      <div className="section">
        <table className="t">
          <thead>
            <tr>
              <th style={{ width: 22 }}>#</th>
              <th>Description · الوصف</th>
              <th>Arch · الفك</th>
              <th className="num">Qty · الكمية</th>
              <th className="num">Unit price · سعر الوحدة</th>
              <th className="num">Amount · القيمة</th>
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((l, i) => (
              <tr key={l.id}>
                <td>{i + 1}</td>
                <td>
                  <strong>{l.description}</strong>
                  {l.description_ar ? <div className="ar" style={{ textAlign: "start" }}>{l.description_ar}</div> : null}
                  {l.code ? <div style={{ fontSize: "7.5pt", color: "#8a97a5", fontFamily: "ui-monospace, monospace" }}>{l.code}</div> : null}
                </td>
                <td>{l.arch ? <>{LINE_ARCHES[l.arch]?.en} <span className="ar">{LINE_ARCHES[l.arch]?.ar}</span></> : "—"}</td>
                <td className="num">{Number(l.qty)}{l.unit ? <div style={{ fontSize: "8pt", color: "#526173" }}>{l.unit}</div> : null}</td>
                <td className="num">{fmtMoney(l.unit_price, cur)}</td>
                <td className="num"><strong>{fmtMoney(l.line_total, cur)}</strong></td>
              </tr>
            ))}
            {!(items ?? []).length ? <tr><td colSpan={6} style={{ textAlign: "center", color: "#8a97a5" }}>No lines yet</td></tr> : null}
          </tbody>
        </table>
      </div>

      <div className="grid2 section" style={{ alignItems: "start" }}>
        <div>
          {billing?.bank_details ? (
            <div className="box" style={{ marginBottom: 10 }}>
              <H en="Payment details" ar="بيانات الدفع" />
              <div style={{ whiteSpace: "pre-line", fontSize: "9pt" }} dir="auto">{billing.bank_details}</div>
            </div>
          ) : null}
          {(payments ?? []).length ? (
            <div className="box">
              <H en="Payments received" ar="المدفوعات المستلمة" />
              <table className="t" style={{ marginTop: 0 }}>
                <tbody>{(payments ?? []).map((p) => <tr key={p.id}><td>{p.receipt_no}</td><td>{fmtDay(p.paid_at)}</td><td>{PAYMENT_METHODS[p.method]?.en}</td><td className="num">{fmtMoney(p.amount, p.currency)}</td></tr>)}</tbody>
              </table>
            </div>
          ) : null}
        </div>
        <div className="box" style={{ padding: "10px 12px" }}>
          <dl className="kv2" style={{ gridTemplateColumns: "1fr auto", fontSize: "10pt" }}>
            <dt>Subtotal · المجموع</dt><dd className="num" style={{ textAlign: "end" }}>{fmtMoney(inv.subtotal, cur)}</dd>
            {discount ? <><dt>Discount · الخصم</dt><dd style={{ textAlign: "end" }}>− {fmtMoney(discount, cur)}</dd></> : null}
            {Number(inv.tax_rate) ? <><dt>{inv.tax_label} {Number(inv.tax_rate)}% · الضريبة</dt><dd style={{ textAlign: "end" }}>{fmtMoney(inv.tax_amount, cur)}</dd></> : null}
          </dl>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderTop: "2px solid #10263d", marginTop: 8, paddingTop: 8 }}>
            <span style={{ fontWeight: 700, color: "#10263d" }}>Total · الإجمالي</span>
            <span className="amount" style={{ fontSize: "17pt" }}>{fmtMoney(inv.total, cur)}</span>
          </div>
          {!draft ? (
            <dl className="kv2" style={{ gridTemplateColumns: "1fr auto", marginTop: 6 }}>
              <dt>Paid · المدفوع</dt><dd style={{ textAlign: "end" }}>{fmtMoney(paid, cur)}</dd>
              {credit ? <><dt>Journal entries · قيود</dt><dd style={{ textAlign: "end" }}>{credit > 0 ? "− " : "+ "}{fmtMoney(Math.abs(credit), cur)}</dd></> : null}
              {advance ? <><dt>Advance applied · من الدفعة المقدمة</dt><dd style={{ textAlign: "end" }}>− {fmtMoney(advance, cur)}</dd></> : null}
              <dt><strong style={{ color: "#10263d" }}>Balance due · المتبقي</strong></dt><dd style={{ textAlign: "end", color: balance > 0 ? "#b42318" : "#067647" }}>{fmtMoney(balance, cur)}</dd>
            </dl>
          ) : null}
        </div>
      </div>

      {inv.notes ? <div className="note" style={{ whiteSpace: "pre-line" }} dir="auto"><strong>Notes · ملاحظات:</strong> {inv.notes}</div> : null}
      {inv.status === "void" && inv.void_reason ? <div className="note" style={{ color: "#b42318" }}><strong>Voided · ملغاة:</strong> {inv.void_reason}</div> : null}
      {billing?.tax_number ? <div className="note">Tax / registration no. · الرقم الضريبي: <strong>{billing.tax_number}</strong></div> : null}

      <div className="sign two">
        <div>Issued by · أصدرها<br /><strong style={{ color: "#1d2939" }}>{people.get(inv.issued_by)?.name ?? ""}</strong></div>
        <div>Received / accepted by · استلمها</div>
      </div>
    </PrintShell>
  );
}
