import { notFound, redirect } from "next/navigation";
import { can, getStaffUser } from "@/lib/auth";
import { docCredits } from "@/lib/journal";
import { createSessionClient } from "@/lib/admin";
import { fmtDay, fmtMoney } from "@/lib/cases";
import { BILL_STATUS } from "@/lib/partners";
import { amountInWords } from "@/lib/tafqeet";
import { PrintShell } from "../../PrintShell";
import { loadCompany } from "../../company";

export const metadata = { title: "Partner bill", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function PrintPartnerBill({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getStaffUser();
  if (!user) redirect("/admin/login?next=/admin/partner-bills");
  if (!can.finance(user) && !can.partner(user)) redirect("/admin?denied=1");
  const db = await createSessionClient();
  const { data: b } = await db.from("partner_bills").select("*").eq("id", id).maybeSingle();
  if (!b) notFound();
  const [{ data: lines }, { data: partner }, { data: pays }, company] = await Promise.all([
    db.from("partner_bill_lines").select("*").eq("bill_id", id),
    db.from("partners").select("*").eq("id", b.partner_id).single(),
    db.from("partner_payments").select("payment_no,paid_at,amount,currency").eq("bill_id", id).eq("voided", false).order("paid_at"),
    loadCompany(db),
  ]);
  const paid = (pays ?? []).reduce((a, p) => a + Number(p.amount), 0) + ((await docCredits(db, { billIds: [id] })).get(id) ?? 0); // payments + discounts / offsets
  const words = amountInWords(Number(b.total), b.currency);
  return (
    <PrintShell back={can.finance(user) ? `/admin/partners/${b.partner_id}` : "/admin/partner-bills"} company={company} docRef={b.bill_no}>
      {b.status === "void" || b.status === "rejected" ? <div className="void">{b.status === "void" ? "VOID" : "REJECTED"}</div> : null}
      <div className="doc-title">
        <h1>Partner Bill<span className="ar">فاتورة مورد — {partner?.kind === "lab" ? "معمل" : "تخطيط علاجي"}</span></h1>
        <div className="doc-no"><div className="no">{b.bill_no}</div><div className="date">{fmtDay(b.bill_date)} · {BILL_STATUS[b.status]?.en}</div>{b.partner_ref ? <div className="date">Their ref. {b.partner_ref}</div> : null}</div>
      </div>
      <div className="grid2">
        <div className="box">
          <h2><span>From</span><span className="ar">من</span></h2>
          <dl className="kv2">
            <dt>Partner</dt><dd>{partner?.name}</dd>
            {partner?.contact_name ? <><dt>Contact</dt><dd>{partner.contact_name}</dd></> : null}
            {partner?.tax_number ? <><dt>Tax no.</dt><dd>{partner.tax_number}</dd></> : null}
            {partner?.bank_details ? <><dt>Pay to</dt><dd style={{ whiteSpace: "pre-line", fontWeight: 400 }}>{partner.bank_details}</dd></> : null}
          </dl>
        </div>
        <div className="box">
          <h2><span>To</span><span className="ar">إلى</span></h2>
          <dl className="kv2"><dt>Company</dt><dd>{company.name}</dd>{b.due_date ? <><dt>Due date</dt><dd>{fmtDay(b.due_date)}</dd></> : null}</dl>
        </div>
      </div>
      <div className="section">
        <table className="t">
          <thead><tr><th style={{ width: 24 }}>#</th><th>Description · البيان</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Amount · القيمة</th></tr></thead>
          <tbody>{(lines ?? []).map((l, i) => <tr key={l.id}><td>{i + 1}</td><td>{l.description}</td><td className="num">{Number(l.qty)}</td><td className="num">{fmtMoney(l.unit_price, b.currency)}</td><td className="num"><strong>{fmtMoney(l.line_total, b.currency)}</strong></td></tr>)}</tbody>
        </table>
      </div>
      <div className="grid2 section">
        <div className="box"><h2><span>Amount in words</span><span className="ar">المبلغ كتابة</span></h2><div style={{ fontSize: "9pt" }}>{words.en}</div><div className="ar" style={{ textAlign: "start", fontWeight: 600 }}>{words.ar}</div></div>
        <div className="box">
          <dl className="kv2" style={{ gridTemplateColumns: "1fr auto", fontSize: "10.5pt" }}>
            <dt>Total · الإجمالي</dt><dd style={{ textAlign: "end" }}>{fmtMoney(b.total, b.currency)}</dd>
            {b.status === "approved" ? <><dt>Paid & journal · المدفوع والقيود</dt><dd style={{ textAlign: "end" }}>{fmtMoney(paid, b.currency)}</dd><dt><strong>Balance · المتبقي</strong></dt><dd style={{ textAlign: "end" }}>{fmtMoney(Number(b.total) - paid, b.currency)}</dd></> : null}
          </dl>
          {(pays ?? []).length ? <div className="note">Payments: {(pays ?? []).map((p) => `${p.payment_no} (${fmtDay(p.paid_at)}, ${fmtMoney(p.amount, p.currency)})`).join(" · ")}</div> : null}
        </div>
      </div>
      {b.notes ? <div className="note"><strong>Notes:</strong> {b.notes}</div> : null}
      {b.review_note ? <div className="note"><strong>RUKN review:</strong> {b.review_note}</div> : null}
      <div className="sign two"><div>Partner · الشريك<br /><strong style={{ color: "#1d2939" }}>{partner?.name}</strong></div><div>Approved by RUKN · اعتماد ركن</div></div>
    </PrintShell>
  );
}
