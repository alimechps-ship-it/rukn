import { notFound, redirect } from "next/navigation";
import { can, getStaffUser } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { profileMap } from "@/lib/case-data";
import { fmtDay, fmtMoney, PAYMENT_METHODS } from "@/lib/cases";
import { amountInWords } from "@/lib/tafqeet";
import { PrintShell } from "../../PrintShell";
import { loadCompany } from "../../company";

export const metadata = { title: "Receipt", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Any payment receipt: case payments open the case receipt; payments on account / advances print here. */
export default async function PrintPayment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getStaffUser();
  if (!user) redirect(`/admin/login?next=/admin/print/payment/${id}`);
  if (!can.finance(user) && !(can.cases(user) && !can.caseStaff(user))) redirect("/admin?denied=1");
  const db = await createSessionClient();
  const { data: pay } = await db.from("case_payments").select("*").eq("id", id).maybeSingle();
  if (!pay) notFound();
  if (pay.case_id) redirect(`/admin/print/case/${pay.case_id}/receipt?p=${id}`);
  const [company, people] = await Promise.all([loadCompany(db), profileMap(db, [pay.agent_id, pay.received_by])]);
  const { data: agent } = await db.from("profiles").select("full_name,email,organization,country,phone").eq("id", pay.agent_id).maybeSingle();
  const words = amountInWords(Number(pay.amount), pay.currency);
  return (
    <PrintShell back={can.finance(user) ? "/admin/finance/notices" : "/admin/statement"} company={company} docRef={pay.receipt_no}>
      {pay.voided ? <div className="void">VOID</div> : null}
      <div className="doc-title">
        <h1>Payment Receipt<span className="ar">إيصال استلام نقدية</span></h1>
        <div className="doc-no"><div className="no">{pay.receipt_no}</div><div className="date"><bdi dir="ltr">{fmtDay(pay.paid_at)}</bdi></div></div>
      </div>
      <div className="box" style={{ marginBottom: 12 }}>
        <h2><span>Amount received</span><span className="ar">المبلغ المستلم</span></h2>
        <div className="amount">{fmtMoney(pay.amount, pay.currency)}</div>
        <div style={{ fontSize: "9.5pt", marginTop: 4 }}>{words.en}</div>
        <div className="ar" style={{ fontSize: "10.5pt", textAlign: "start", fontWeight: 600 }}>{words.ar}</div>
        <dl className="kv2" style={{ marginTop: 6 }}>
          <dt>Received from · استلمنا من</dt><dd>{agent?.full_name || agent?.email}{agent?.organization ? ` — ${agent.organization}` : ""}{agent?.country ? ` · ${agent.country}` : ""}</dd>
          <dt>Payment method · طريقة الدفع</dt><dd>{PAYMENT_METHODS[pay.method]?.en} · <span className="ar">{PAYMENT_METHODS[pay.method]?.ar}</span></dd>
          <dt>Reference · المرجع</dt><dd>{pay.reference ?? "—"}</dd>
          <dt>For · وذلك عن</dt><dd>Payment on account / advance · دفعة على الحساب (مقدمة)</dd>
          {pay.notes ? <><dt>Notes · ملاحظات</dt><dd>{pay.notes}</dd></> : null}
          {pay.voided ? <><dt>Voided · ملغى</dt><dd>{pay.void_reason}</dd></> : null}
        </dl>
      </div>
      <div className="sign two">
        <div>Received by (RUKN) · المستلم<br /><strong style={{ color: "#1d2939" }}>{people.get(pay.received_by)?.name ?? ""}</strong></div>
        <div>Paid by · الدافع<br /><strong style={{ color: "#1d2939" }}>{people.get(pay.agent_id)?.name ?? ""}</strong></div>
      </div>
      <p className="note">This receipt confirms the amount stated above was received and credited to the agent&apos;s account with RUKN. It is not a tax invoice. · هذا الإيصال يثبت استلام المبلغ المذكور أعلاه وقيده لحساب المندوب لدى ركن، وليس فاتورة ضريبية.</p>
    </PrintShell>
  );
}
