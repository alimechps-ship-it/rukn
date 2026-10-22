import { notFound, redirect } from "next/navigation";
import { can, getStaffUser } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { profileMap } from "@/lib/case-data";
import { fmtDay, fmtMoney, PAYMENT_METHODS } from "@/lib/cases";
import { amountInWords } from "@/lib/tafqeet";
import { PrintShell } from "../../PrintShell";
import { loadCompany } from "../../company";

export const metadata = { title: "Payment voucher", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function PrintPartnerPayment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getStaffUser();
  if (!user) redirect("/admin/login");
  if (!can.caseStaff(user) && !can.partner(user)) redirect("/admin?denied=1");
  const db = await createSessionClient();
  const { data: p } = await db.from("partner_payments").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();
  const [{ data: partner }, { data: bill }, company] = await Promise.all([
    db.from("partners").select("name,kind,bank_details").eq("id", p.partner_id).single(),
    p.bill_id ? db.from("partner_bills").select("bill_no,partner_ref,total").eq("id", p.bill_id).maybeSingle() : Promise.resolve({ data: null }),
    loadCompany(db),
  ]);
  const { data: box } = can.caseStaff(user) && p.cash_account_id ? await db.from("cash_accounts").select("name").eq("id", p.cash_account_id).maybeSingle() : { data: null };
  const people = await profileMap(db, [p.created_by]);
  const words = amountInWords(Number(p.amount), p.currency);
  return (
    <PrintShell back={can.caseStaff(user) ? `/admin/partners/${p.partner_id}` : "/admin/partner-statement"} company={company} docRef={p.payment_no}>
      {p.voided ? <div className="void">VOID</div> : null}
      <div className="doc-title">
        <h1>Payment Voucher<span className="ar">سند صرف لمورد</span></h1>
        <div className="doc-no"><div className="no">{p.payment_no}</div><div className="date">{fmtDay(p.paid_at)}</div></div>
      </div>
      <div className="box" style={{ marginBottom: 12 }}>
        <h2><span>Amount paid</span><span className="ar">المبلغ المدفوع</span></h2>
        <div className="amount">{fmtMoney(p.amount, p.currency)}</div>
        <div style={{ fontSize: "9.5pt", marginTop: 4 }}>{words.en}</div>
        <div className="ar" style={{ fontSize: "10.5pt", textAlign: "start", fontWeight: 600 }}>{words.ar}</div>
      </div>
      <div className="grid2">
        <div className="box">
          <h2><span>Paid to</span><span className="ar">صرف إلى</span></h2>
          <dl className="kv2">
            <dt>Partner</dt><dd>{partner?.name}</dd>
            <dt>For</dt><dd>{bill ? `Bill ${bill.bill_no}${bill.partner_ref ? ` (their ref. ${bill.partner_ref})` : ""}` : "Advance / on account"}</dd>
            <dt>Method</dt><dd>{PAYMENT_METHODS[p.method]?.en}{p.reference ? ` · ${p.reference}` : ""}</dd>
          </dl>
        </div>
        <div className="box">
          <h2><span>RUKN</span><span className="ar">ركن</span></h2>
          <dl className="kv2">
            {box ? <><dt>Cash box</dt><dd>{box.name}</dd></> : null}
            <dt>Recorded by</dt><dd>{people.get(p.created_by ?? "")?.name ?? "—"}</dd>
            {p.notes ? <><dt>Notes</dt><dd>{p.notes}</dd></> : null}
          </dl>
        </div>
      </div>
      {p.voided ? <div className="note" style={{ color: "#b42318" }}><strong>Voided:</strong> {p.void_reason}</div> : null}
      <div className="sign"><div>Paid by · أمين الصندوق</div><div>Received by · المستلم<br /><strong style={{ color: "#1d2939" }}>{partner?.name}</strong></div><div>Approved by · اعتماد</div></div>
    </PrintShell>
  );
}
