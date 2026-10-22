import { notFound, redirect } from "next/navigation";
import { can, getStaffUser } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { profileMap } from "@/lib/case-data";
import { fmtDay, fmtMoney } from "@/lib/cases";
import { accountNames, type JournalEntry } from "@/lib/journal";
import { amountInWords } from "@/lib/tafqeet";
import { PrintShell } from "../../PrintShell";
import { loadCompany } from "../../company";

export const metadata = { title: "Journal voucher", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function PrintJournal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getStaffUser();
  if (!user) redirect(`/admin/login?next=/admin/print/journal/${id}`);
  // Finance, or the agent / partner on one side of the entry (RLS returns only theirs).
  if (!can.finance(user) && !can.partner(user) && !(can.cases(user) && !can.caseStaff(user))) redirect("/admin?denied=1");
  const db = await createSessionClient();
  const { data } = await db.from("journal_entries").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const e = data as JournalEntry;
  const [company, names, { data: docs }, { data: bills }] = await Promise.all([
    loadCompany(db),
    accountNames(db, [e]),
    db.from("case_invoices").select("id,invoice_no").in("id", [e.dr_invoice_id, e.cr_invoice_id].filter(Boolean) as string[]),
    db.from("partner_bills").select("id,bill_no").in("id", [e.dr_bill_id, e.cr_bill_id].filter(Boolean) as string[]),
  ]);
  const docNo = new Map<string, string>([...(docs ?? []).map((d) => [d.id as string, d.invoice_no as string] as [string, string]), ...(bills ?? []).map((b) => [b.id as string, b.bill_no as string] as [string, string])]);
  const people = await profileMap(db, [e.created_by]);
  const d = names.side(e, "dr"); const c = names.side(e, "cr");
  const words = amountInWords(Number(e.dr_amount), e.dr_currency);
  const back = can.finance(user) ? "/admin/finance/journal" : can.partner(user) ? "/admin/partner-statement" : "/admin/statement";
  const docOf = (s: "dr" | "cr") => { const k = (e[`${s}_invoice_id`] ?? e[`${s}_bill_id`]) as string | null; return k ? docNo.get(k) : null; };

  return (
    <PrintShell back={back} company={company} docRef={e.entry_no}>
      {e.voided ? <div className="void">VOID</div> : null}
      <div className="doc-title">
        <h1>Journal Voucher<span className="ar">قيد يومية</span></h1>
        <div className="doc-no"><div className="no">{e.entry_no}</div><div className="date"><bdi dir="ltr">{fmtDay(e.entry_date)}</bdi></div></div>
      </div>

      <div className="section">
        <table className="t">
          <thead><tr><th>Account · الحساب</th><th>Document · المستند</th><th className="num">Debit · مدين</th><th className="num">Credit · دائن</th></tr></thead>
          <tbody>
            <tr><td><strong>{d.en}</strong>{d.ar ? <div className="ar" style={{ textAlign: "start" }}>{d.ar}</div> : null}<div style={{ fontSize: "8pt", color: "#526173" }}>{d.kind}</div></td><td>{docOf("dr") ?? "—"}</td><td className="num"><strong>{fmtMoney(e.dr_amount, e.dr_currency)}</strong></td><td /></tr>
            <tr><td style={{ paddingInlineStart: 24 }}><strong>{c.en}</strong>{c.ar ? <div className="ar" style={{ textAlign: "start" }}>{c.ar}</div> : null}<div style={{ fontSize: "8pt", color: "#526173" }}>{c.kind}</div></td><td>{docOf("cr") ?? "—"}</td><td /><td className="num"><strong>{fmtMoney(e.cr_amount, e.cr_currency)}</strong></td></tr>
          </tbody>
        </table>
      </div>

      <div className="grid2 section">
        <div className="box">
          <h2><span>Amount</span><span className="ar">المبلغ</span></h2>
          <div className="amount">{fmtMoney(e.dr_amount, e.dr_currency)}</div>
          <div style={{ fontSize: "9.5pt", marginTop: 4 }}>{words.en}</div>
          <div className="ar" style={{ fontSize: "10.5pt", textAlign: "start", fontWeight: 600 }}>{words.ar}</div>
        </div>
        <div className="box">
          <h2><span>Details</span><span className="ar">البيان</span></h2>
          <dl className="kv2">
            <dt>Description · البيان</dt><dd>{e.description ?? "—"}</dd>
            {e.reference ? <><dt>Reference · المرجع</dt><dd>{e.reference}</dd></> : null}
            {e.fx_rate ? <><dt>Exchange rate · سعر الصرف</dt><dd>1 {e.dr_currency} = {Number(e.fx_rate)} {e.cr_currency} ({e.fx_source === "auto" ? "automatic · تلقائي" : "manual · يدوي"})</dd></> : null}
            <dt>Recorded by</dt><dd>{people.get(e.created_by ?? "")?.name ?? "—"}</dd>
          </dl>
        </div>
      </div>
      {e.voided ? <div className="note" style={{ color: "#b42318" }}><strong>Voided · ملغى:</strong> {e.void_reason}</div> : null}
      <p className="note">No cash moves with this entry. · لا يترتب على هذا القيد حركة نقدية.</p>
      <div className="sign">
        <div>Prepared by (accountant) · المحاسب</div>
        <div>Reviewed by · المراجع</div>
        <div>Approved by · اعتماد</div>
      </div>
    </PrintShell>
  );
}
