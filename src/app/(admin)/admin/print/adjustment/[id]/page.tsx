import { notFound, redirect } from "next/navigation";
import { can, getStaffUser } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { profileMap } from "@/lib/case-data";
import { fmtDay, fmtMoney } from "@/lib/cases";
import { ADJ_KINDS, EFFECT_LABEL, type Adjustment } from "@/lib/adjustments";
import { amountInWords } from "@/lib/tafqeet";
import { PrintShell } from "../../PrintShell";
import { loadCompany } from "../../company";

export const metadata = { title: "Adjustment", robots: { index: false } };
export const dynamic = "force-dynamic";

function H({ en, ar }: { en: string; ar: string }) {
  return <h2><span>{en}</span><span className="ar">{ar}</span></h2>;
}

export default async function PrintAdjustment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getStaffUser();
  if (!user) redirect(`/admin/login?next=/admin/print/adjustment/${id}`);
  // Finance, or the agent / partner it concerns (RLS returns only their own).
  if (!can.finance(user) && !can.partner(user) && !(can.cases(user) && !can.caseStaff(user))) redirect("/admin?denied=1");
  const db = await createSessionClient();
  const { data } = await db.from("account_adjustments").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const a = data as Adjustment;
  const [company, { data: partner }, { data: inv }, { data: bill }, { data: kase }, { data: pair }] = await Promise.all([
    loadCompany(db),
    a.partner_id ? db.from("partners").select("name,kind,contact_name,phone").eq("id", a.partner_id).maybeSingle() : Promise.resolve({ data: null }),
    a.invoice_id ? db.from("case_invoices").select("invoice_no").eq("id", a.invoice_id).maybeSingle() : Promise.resolve({ data: null }),
    a.bill_id ? db.from("partner_bills").select("bill_no").eq("id", a.bill_id).maybeSingle() : Promise.resolve({ data: null }),
    a.case_id ? db.from("cases").select("code,clinic_name").eq("id", a.case_id).maybeSingle() : Promise.resolve({ data: null }),
    a.offset_group && can.finance(user) ? db.from("account_adjustments").select("*").eq("offset_group", a.offset_group).neq("id", a.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const other = pair as Adjustment | null;
  const { data: otherPartner } = other?.partner_id ? await db.from("partners").select("name").eq("id", other.partner_id).maybeSingle() : { data: null };
  const people = await profileMap(db, [a.agent_id, a.created_by, other?.agent_id]);
  const party = a.party_type === "agent" ? people.get(a.agent_id ?? "")?.name : partner?.name;
  const otherName = other ? (other.party_type === "agent" ? people.get(other.agent_id ?? "")?.name : otherPartner?.name) : null;
  // Credit note = in favour of the account holder; debit note = against him.
  const credit = (a.party_type === "agent" && a.effect === "decrease") || (a.party_type === "partner" && a.effect === "increase");
  const title = credit ? { en: "Credit Note", ar: "إشعار دائن" } : { en: "Debit Note", ar: "إشعار مدين" };
  const k = ADJ_KINDS[a.kind];
  const words = amountInWords(Number(a.amount), a.currency);
  const back = can.finance(user) ? "/admin/finance/adjustments" : can.partner(user) ? "/admin/partner-statement" : "/admin/statement";

  return (
    <PrintShell back={back} company={company} docRef={a.adj_no}>
      {a.voided ? <div className="void">VOID</div> : null}
      <div className="doc-title">
        <h1>{title.en}<span className="ar">{title.ar} — {k?.ar}</span></h1>
        <div className="doc-no"><div className="no">{a.adj_no}</div><div className="date"><bdi dir="ltr">{fmtDay(a.adj_date)}</bdi></div></div>
      </div>

      <div className="box" style={{ marginBottom: 12 }}>
        <H en="Amount" ar="المبلغ" />
        <div className="amount" style={{ color: credit ? "#067647" : "#b42318" }}>{fmtMoney(a.amount, a.currency)}</div>
        <div style={{ fontSize: "9.5pt", marginTop: 4 }}>{words.en}</div>
        <div className="ar" style={{ fontSize: "10.5pt", textAlign: "start", fontWeight: 600 }}>{words.ar}</div>
      </div>

      <div className="grid2">
        <div className="box">
          <H en="Account" ar="الحساب" />
          <dl className="kv2">
            <dt>{a.party_type === "agent" ? "Agent · المندوب" : partner?.kind === "lab" ? "Lab · المعمل" : "Clinic · العيادة"}</dt><dd><strong>{party ?? "—"}</strong></dd>
            <dt>Type · النوع</dt><dd>{k?.en} · <span className="ar">{k?.ar}</span></dd>
            <dt>Effect · الأثر</dt><dd>{EFFECT_LABEL[a.party_type][a.effect].en} · <span className="ar">{EFFECT_LABEL[a.party_type][a.effect].ar}</span></dd>
            {inv ? <><dt>Invoice · الفاتورة</dt><dd>{inv.invoice_no}{kase ? ` · ${kase.code}` : ""}</dd></> : kase ? <><dt>Case · الحالة</dt><dd>{kase.code}</dd></> : null}
            {bill ? <><dt>Bill · فاتورة الشريك</dt><dd>{bill.bill_no}</dd></> : null}
          </dl>
        </div>
        <div className="box">
          <H en="Details" ar="البيان" />
          <dl className="kv2">
            <dt>Description · البيان</dt><dd>{a.description ?? "—"}</dd>
            {a.reference ? <><dt>Reference · المرجع</dt><dd>{a.reference}</dd></> : null}
            {other ? <><dt>Offset against · مقابل</dt><dd>{otherName} · {other.adj_no} ({other.effect === "decrease" ? "−" : "+"}{fmtMoney(other.amount, other.currency)})</dd></> : null}
            {a.fx_rate ? <><dt>Exchange rate · سعر الصرف</dt><dd>{Number(a.fx_rate)}</dd></> : null}
            <dt>Recorded by</dt><dd>{people.get(a.created_by ?? "")?.name ?? "—"}</dd>
          </dl>
        </div>
      </div>
      {a.voided ? <div className="note" style={{ color: "#b42318" }}><strong>Voided · ملغى:</strong> {a.void_reason}</div> : null}
      <p className="note">No cash moves with this document; it corrects the account balance. · لا يترتب على هذا الإشعار حركة نقدية، وإنما تسوية لرصيد الحساب.</p>
      <div className="sign">
        <div>Prepared by (finance) · المحاسب</div>
        <div>Approved by · اعتماد</div>
        <div>Acknowledged by · إقرار<br /><strong style={{ color: "#1d2939" }}>{party ?? ""}</strong></div>
      </div>
    </PrintShell>
  );
}
