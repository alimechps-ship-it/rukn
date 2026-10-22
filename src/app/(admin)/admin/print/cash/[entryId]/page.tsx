import { notFound, redirect } from "next/navigation";
import { can, getStaffUser } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { profileMap } from "@/lib/case-data";
import { fmtDay, fmtMoney } from "@/lib/cases";
import { ALL_CATEGORIES, CASH_KINDS, type CashEntry } from "@/lib/finance";
import { amountInWords } from "@/lib/tafqeet";
import { PrintShell } from "../../PrintShell";
import { loadCompany } from "../../company";

export const metadata = { title: "Voucher", robots: { index: false } };
export const dynamic = "force-dynamic";

function H({ en, ar }: { en: string; ar: string }) {
  return <h2><span>{en}</span><span className="ar">{ar}</span></h2>;
}

export default async function PrintVoucher({ params }: { params: Promise<{ entryId: string }> }) {
  const { entryId } = await params;
  const user = await getStaffUser();
  if (!user) redirect(`/admin/login?next=/admin/print/cash/${entryId}`);
  if (!can.finance(user) && !can.partner(user)) redirect("/admin?denied=1"); // a partner reads only his own refund vouchers (RLS)
  const db = await createSessionClient();
  const { data } = await db.from("cash_entries").select("*").eq("id", entryId).maybeSingle();
  if (!data) notFound();
  const e = data as CashEntry;
  const [{ data: acc }, { data: kase }, { data: pair }, company] = await Promise.all([
    db.from("cash_accounts").select("name,kind,currency").eq("id", e.account_id).maybeSingle(),
    e.case_id ? db.from("cases").select("code,clinic_name,doctor_name").eq("id", e.case_id).maybeSingle() : Promise.resolve({ data: null }),
    e.transfer_group ? db.from("cash_entries").select("entry_no,amount,currency,account_id").eq("transfer_group", e.transfer_group).neq("id", e.id).maybeSingle() : Promise.resolve({ data: null }),
    loadCompany(db),
  ]);
  const { data: pairAcc } = pair ? await db.from("cash_accounts").select("name").eq("id", pair.account_id).maybeSingle() : { data: null };
  const people = await profileMap(db, [e.party_user, e.created_by]);
  const who = e.party_user ? people.get(e.party_user)?.name : e.party_name;
  const isIn = e.direction === "in";
  const title = e.category === "transfer" ? { en: "Transfer Voucher", ar: "سند تحويل" } : isIn ? { en: "Receipt Voucher", ar: "سند قبض" } : { en: "Payment Voucher", ar: "سند صرف" };
  const words = amountInWords(Number(e.amount), e.currency);
  const cat = ALL_CATEGORIES[e.category];

  return (
    <PrintShell back={can.finance(user) ? "/admin/finance/cash" : "/admin/partner-statement"} company={company} docRef={e.entry_no}>
      {e.voided ? <div className="void">VOID</div> : null}
      <div className="doc-title">
        <h1>{title.en}<span className="ar">{title.ar}</span></h1>
        <div className="doc-no"><div className="no">{e.entry_no}</div><div className="date"><bdi dir="ltr">{fmtDay(e.entry_date)}</bdi></div></div>
      </div>

      <div className="box" style={{ marginBottom: 12 }}>
        <H en="Amount" ar="المبلغ" />
        <div className="amount" style={{ color: isIn ? "#067647" : "#10263d" }}>{fmtMoney(e.amount, e.currency)}</div>
        <div style={{ fontSize: "9.5pt", marginTop: 4 }}>{words.en}</div>
        <div className="ar" style={{ fontSize: "10.5pt", textAlign: "start", fontWeight: 600 }}>{words.ar}</div>
      </div>

      <div className="grid2">
        <div className="box">
          <H en="Details" ar="البيانات" />
          <dl className="kv2">
            <dt>{isIn ? "Received from · استلمنا من" : "Paid to · صرف إلى"}</dt><dd>{who ?? (kase ? `${kase.clinic_name} — ${kase.doctor_name}` : "—")}</dd>
            <dt>Type · النوع</dt><dd>{cat?.en} · <span className="ar">{cat?.ar}</span></dd>
            <dt>Description · البيان</dt><dd>{e.description ?? "—"}</dd>
            {e.reference ? <><dt>Reference · المرجع</dt><dd>{e.reference}</dd></> : null}
            {kase ? <><dt>Case · الحالة</dt><dd>{kase.code}</dd></> : null}
          </dl>
        </div>
        <div className="box">
          <H en="Cash box" ar="الصندوق" />
          <dl className="kv2">
            <dt>{isIn ? "Into · إلى" : "From · من"}</dt><dd>{acc?.name}</dd>
            <dt>Type</dt><dd>{CASH_KINDS[acc?.kind ?? "cash"]?.en}</dd>
            <dt>Currency</dt><dd>{e.currency}</dd>
            {pair ? <><dt>{isIn ? "Transferred from" : "Transferred to"}</dt><dd>{pairAcc?.name} · {pair.entry_no} ({fmtMoney(pair.amount, pair.currency)})</dd></> : null}
            <dt>Recorded by</dt><dd>{people.get(e.created_by ?? "")?.name ?? "—"}</dd>
          </dl>
        </div>
      </div>
      {e.voided ? <div className="note" style={{ color: "#b42318" }}><strong>Voided · ملغى:</strong> {e.void_reason}</div> : null}

      <div className="sign">
        <div>{isIn ? "Received by (cashier) · المستلم" : "Paid by (cashier) · أمين الصندوق"}</div>
        <div>{isIn ? "Paid by · المسلِّم" : "Received by · المستلم"}<br /><strong style={{ color: "#1d2939" }}>{who ?? ""}</strong></div>
        <div>Approved by · اعتماد</div>
      </div>
    </PrintShell>
  );
}
