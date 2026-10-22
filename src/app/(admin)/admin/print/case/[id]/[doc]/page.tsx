import { notFound, redirect } from "next/navigation";
import { can, getStaffUser } from "@/lib/auth";
import { createSessionClient, fmtDate } from "@/lib/admin";
import { profileMap } from "@/lib/case-data";
import { ARCHES, countryName, FILE_CATEGORIES, fmtDay, fmtMoney, PAYMENT_METHODS, SEXES, STATUS, type CaseStatus } from "@/lib/cases";
import { PrintShell } from "../../../PrintShell";
import { loadCompany } from "../../../company";

export const metadata = { title: "Print", robots: { index: false } };
export const dynamic = "force-dynamic";

const DOCS = {
  file: { en: "Case File", ar: "ملف الحالة" },
  intake: { en: "Records Receipt", ar: "إيصال استلام سجلات" },
  receipt: { en: "Payment Receipt", ar: "إيصال استلام نقدية" },
  delivery: { en: "Delivery Note", ar: "سند تسليم" },
} as const;

function Title({ doc, no, date }: { doc: keyof typeof DOCS; no: string; date: string }) {
  return (
    <div className="doc-title">
      <h1>{DOCS[doc].en}<span className="ar">{DOCS[doc].ar}</span></h1>
      <div className="doc-no"><div className="no">{no}</div><div className="date">{date}</div></div>
    </div>
  );
}
function H({ en, ar }: { en: string; ar: string }) {
  return <h2><span>{en}</span><span className="ar">{ar}</span></h2>;
}

export default async function PrintCase({ params, searchParams }: { params: Promise<{ id: string; doc: string }>; searchParams: Promise<{ p?: string }> }) {
  const { id, doc } = await params;
  const { p } = await searchParams;
  const user = await getStaffUser();
  if (!user) redirect(`/admin/login?next=/admin/print/case/${id}/${doc}`);
  if (!can.staff(user) || !can.cases(user)) redirect("/admin?denied=1");
  if (!(doc in DOCS)) notFound();
  const db = await createSessionClient();
  const { data: c } = await db.from("cases").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();
  const company = await loadCompany(db);
  const [{ data: files }, { data: events }, { data: payments }, { data: invoices }] = await Promise.all([
    db.from("case_files").select("filename,category,is_deliverable,created_at").eq("case_id", id).order("created_at"),
    db.from("case_events").select("kind,from_status,to_status,body,author_id,created_at").eq("case_id", id).neq("kind", "internal").order("created_at"),
    db.from("case_payments").select("*").eq("case_id", id).order("created_at"),
    db.from("case_invoices").select("invoice_no,status,total,currency").eq("case_id", id).neq("status", "draft").order("created_at"),
  ]);
  const people = await profileMap(db, [c.agent_id, c.assigned_to, c.intake_received_by, ...(payments ?? []).map((x) => x.received_by), ...(events ?? []).map((e) => e.author_id)]);
  const agent = people.get(c.agent_id);
  const back = `/admin/cases/${id}`;
  const status = c.status as CaseStatus;

  const CaseBox = (
    <div className="box">
      <H en="Case" ar="الحالة" />
      <dl className="kv2">
        <dt>Case code</dt><dd>{c.code}</dd>
        <dt>Service</dt><dd>{c.service_label ?? "—"}</dd>
        <dt>Patient ref.</dt><dd>{c.patient_ref}</dd>
        <dt>Doctor</dt><dd>{c.doctor_name}</dd>
        <dt>Clinic</dt><dd>{c.clinic_name}</dd>
      </dl>
    </div>
  );
  const AgentBox = (
    <div className="box">
      <H en="Agent" ar="المندوب" />
      <dl className="kv2">
        <dt>Name</dt><dd>{agent?.name ?? "—"}</dd>
        <dt>Organization</dt><dd>{agent?.organization ?? "—"}</dd>
        <dt>Country</dt><dd>{agent?.country ?? countryName(c.country_code)}</dd>
        <dt>Phone</dt><dd><bdi dir="ltr">{agent?.phone ?? "—"}</bdi></dd>
        <dt>E-mail</dt><dd>{agent?.email ?? "—"}</dd>
      </dl>
    </div>
  );

  // ---------------- Payment receipt ----------------
  if (doc === "receipt") {
    const pay = (payments ?? []).find((x) => x.id === p);
    if (!pay) notFound();
    const { data: inv } = pay.invoice_id
      ? await db.from("case_invoices").select("invoice_no,total,currency").eq("id", pay.invoice_id).maybeSingle()
      : { data: null };
    const paidOnInv = inv ? (payments ?? []).filter((x) => !x.voided && x.invoice_id === pay.invoice_id).reduce((a, x) => a + Number(x.amount), 0) : 0;
    return (
      <PrintShell back={back} company={company} docRef={pay.receipt_no}>
        {pay.voided ? <div className="void">VOID</div> : null}
        <Title doc="receipt" no={pay.receipt_no} date={fmtDay(pay.paid_at)} />
        <div className="box" style={{ marginBottom: 12 }}>
          <H en="Amount received" ar="المبلغ المستلم" />
          <div className="amount">{fmtMoney(pay.amount, pay.currency)}</div>
          <dl className="kv2" style={{ marginTop: 6 }}>
            <dt>Received from · استلمنا من</dt><dd>{agent?.name ?? "—"}{agent?.organization ? ` — ${agent.organization}` : ""} / {c.clinic_name}</dd>
            <dt>Payment method · طريقة الدفع</dt><dd>{PAYMENT_METHODS[pay.method]?.en} · <span className="ar">{PAYMENT_METHODS[pay.method]?.ar}</span></dd>
            <dt>Reference · المرجع</dt><dd>{pay.reference ?? "—"}</dd>
            <dt>For · وذلك عن</dt><dd>{inv ? `Invoice ${inv.invoice_no} · ` : ""}{c.service_label ?? "Dental services"} — case {c.code}</dd>
            {pay.notes ? <><dt>Notes · ملاحظات</dt><dd>{pay.notes}</dd></> : null}
            {pay.voided ? <><dt>Voided · ملغى</dt><dd>{pay.void_reason}</dd></> : null}
          </dl>
        </div>
        <div className="grid2">{CaseBox}<div className="box">
          <H en="Account" ar="الحساب" />
          {inv ? (
          <dl className="kv2">
            <dt>Invoice</dt><dd>{inv.invoice_no}</dd>
            <dt>Invoice total</dt><dd>{fmtMoney(inv.total, inv.currency)}</dd>
            <dt>Paid on invoice</dt><dd>{fmtMoney(paidOnInv, inv.currency)}</dd>
            <dt>Balance</dt><dd>{fmtMoney(Number(inv.total) - paidOnInv, inv.currency)}</dd>
          </dl>
          ) : (
          <dl className="kv2">
            <dt>Quoted price</dt><dd>{fmtMoney(c.quote_amount, c.quote_currency)}</dd>
            <dt>Total paid</dt><dd>{fmtMoney((payments ?? []).filter((x) => !x.voided && x.currency === pay.currency).reduce((a, x) => a + Number(x.amount), 0), pay.currency)}</dd>
            {c.quote_amount && c.quote_currency === pay.currency ? <><dt>Balance</dt><dd>{fmtMoney(Number(c.quote_amount) - (payments ?? []).filter((x) => !x.voided && x.currency === pay.currency).reduce((a, x) => a + Number(x.amount), 0), pay.currency)}</dd></> : null}
          </dl>
          )}
        </div></div>
        <div className="sign two">
          <div>Received by (RUKN) · المستلم<br /><strong style={{ color: "#1d2939" }}>{people.get(pay.received_by)?.name ?? ""}</strong></div>
          <div>Paid by · الدافع</div>
        </div>
        <p className="note">This receipt confirms the amount stated above was received. It is not a tax invoice. · هذا الإيصال يثبت استلام المبلغ المذكور أعلاه وليس فاتورة ضريبية.</p>
      </PrintShell>
    );
  }

  // ---------------- Records receipt ----------------
  if (doc === "intake") {
    if (!c.intake_no) notFound();
    const items = (c.intake_items ?? []) as { title: string; text: string }[];
    return (
      <PrintShell back={back} company={company} docRef={c.intake_no}>
        <Title doc="intake" no={c.intake_no} date={fmtDate(c.intake_received_at)} />
        <div className="grid2">{CaseBox}{AgentBox}</div>
        <div className="section">
          <table className="t">
            <thead><tr><th style={{ width: 40 }}>#</th><th>Item received · البند المستلم</th><th>Qty / condition · الكمية / الحالة</th></tr></thead>
            <tbody>{items.map((i, n) => <tr key={n}><td>{n + 1}</td><td>{i.title}</td><td>{i.text}</td></tr>)}</tbody>
          </table>
          {c.intake_notes ? <p className="note"><strong>Notes · ملاحظات:</strong> {c.intake_notes}</p> : null}
        </div>
        <div className="sign">
          <div>Delivered by (agent) · المُسلِّم<br /><strong style={{ color: "#1d2939" }}>{agent?.name}</strong></div>
          <div>Received by (RUKN) · المستلم<br /><strong style={{ color: "#1d2939" }}>{people.get(c.intake_received_by)?.name ?? ""}</strong></div>
          <div>Date · التاريخ<br /><strong style={{ color: "#1d2939" }}>{fmtDay(c.intake_received_at)}</strong></div>
        </div>
        <p className="note">Records are handled confidentially and used only for this case. · تُعامَل السجلات بسرية وتُستخدم لهذه الحالة فقط.</p>
      </PrintShell>
    );
  }

  // ---------------- Delivery note ----------------
  if (doc === "delivery") {
    if (!c.delivery_no) notFound();
    return (
      <PrintShell back={back} company={company} docRef={c.delivery_no}>
        <Title doc="delivery" no={c.delivery_no} date={fmtDate(c.delivered_at)} />
        <div className="grid2">{CaseBox}{AgentBox}</div>
        <div className="section">
          <table className="t">
            <thead><tr><th style={{ width: 40 }}>#</th><th>Delivered · المُسلَّم</th><th>Details · التفاصيل</th></tr></thead>
            <tbody>
              <tr><td>1</td><td>{c.service_label ?? "Dental appliance / plan"}</td><td>{c.arches ? `${ARCHES[c.arches]?.en} · ` : ""}Patient {c.patient_ref}</td></tr>
              {(files ?? []).filter((f) => f.is_deliverable).map((f, n) => <tr key={n}><td>{n + 2}</td><td>{f.filename}</td><td>{FILE_CATEGORIES[f.category]?.en}</td></tr>)}
            </tbody>
          </table>
          {c.delivery_notes ? <p className="note"><strong>Notes · ملاحظات:</strong> {c.delivery_notes}</p> : null}
        </div>
        <div className="grid2 section">
          <div className="box"><H en="Shipping" ar="الشحن" /><dl className="kv2"><dt>Carrier</dt><dd>{c.carrier ?? "—"}</dd><dt>Tracking</dt><dd>{c.tracking_no ?? "—"}</dd><dt>Shipped</dt><dd>{fmtDate(c.shipped_at)}</dd></dl></div>
          <div className="box"><H en="Receipt" ar="الاستلام" /><dl className="kv2"><dt>Received by</dt><dd>{c.received_by_name ?? "—"}</dd><dt>Delivered</dt><dd>{fmtDate(c.delivered_at)}</dd><dt>Plan approved</dt><dd>{c.plan_approved_by ? `${c.plan_approved_by} · ${fmtDay(c.plan_approved_at)}` : "—"}</dd></dl></div>
        </div>
        <div className="sign">
          <div>Delivered by (RUKN) · المُسلِّم</div>
          <div>Received by · المستلم<br /><strong style={{ color: "#1d2939" }}>{c.received_by_name ?? ""}</strong></div>
          <div>Signature & stamp · التوقيع والختم</div>
        </div>
        <p className="note">The recipient confirms receipt of the items above in good condition. · يُقرّ المستلم باستلام البنود أعلاه بحالة سليمة.</p>
      </PrintShell>
    );
  }

  // ---------------- Case file ----------------
  const paidTotal = (payments ?? []).filter((x) => !x.voided).reduce<Record<string, number>>((a, x) => ({ ...a, [x.currency]: (a[x.currency] ?? 0) + Number(x.amount) }), {});
  return (
    <PrintShell back={back} company={company} docRef={c.code}>
      <Title doc="file" no={c.code} date={`Created ${fmtDay(c.created_at)}`} />
      <p style={{ margin: "0 0 10px" }}><span className="status-chip">{STATUS[status].en} · <span className="ar">{STATUS[status].ar}</span></span> {c.priority === "urgent" ? <span className="status-chip" style={{ background: "#fff4ed", color: "#c4320a" }}>URGENT · عاجل</span> : null}</p>
      <div className="grid2">
        <div className="box">
          <H en="Service" ar="الخدمة" />
          <dl className="kv2">
            <dt>Service</dt><dd>{c.service_label ?? "—"}</dd>
            <dt>Requested by</dt><dd>{fmtDay(c.due_date)}</dd>
            <dt>Case manager</dt><dd>{c.assigned_to ? people.get(c.assigned_to)?.name : "—"}</dd>
            <dt>Plan approved</dt><dd>{c.plan_approved_by ? `${c.plan_approved_by} · ${fmtDay(c.plan_approved_at)}` : "—"}</dd>
          </dl>
        </div>
        {AgentBox}
        <div className="box">
          <H en="Clinic & doctor" ar="العيادة والطبيب" />
          <dl className="kv2">
            <dt>Clinic</dt><dd>{c.clinic_name}</dd>
            <dt>Location</dt><dd>{c.city ? `${c.city}, ` : ""}{countryName(c.country_code)}</dd>
            <dt>Doctor</dt><dd>{c.doctor_name}</dd>
            <dt>Contact</dt><dd><bdi dir="ltr">{[c.doctor_phone, c.doctor_email].filter(Boolean).join(" · ") || "—"}</bdi></dd>
          </dl>
        </div>
        <div className="box">
          <H en="Patient" ar="المريض" />
          <dl className="kv2">
            <dt>Reference</dt><dd>{c.patient_ref}</dd>
            <dt>Age / sex</dt><dd>{c.patient_age ?? "—"} / {c.patient_sex ? SEXES[c.patient_sex]?.en : "—"}</dd>
            <dt>Arches</dt><dd>{c.arches ? ARCHES[c.arches]?.en : "—"}</dd>
          </dl>
        </div>
      </div>
      {c.description ? <div className="box section"><H en="Clinical notes" ar="الملاحظات السريرية" /><div style={{ whiteSpace: "pre-wrap" }} dir="auto">{c.description}</div></div> : null}
      <div className="grid2 section">
        <div className="box">
          <H en="Records received" ar="السجلات المستلمة" />
          {((c.intake_items ?? []) as { title: string; text: string }[]).length ? (
            <table className="t"><tbody>{((c.intake_items ?? []) as { title: string; text: string }[]).map((i, n) => <tr key={n}><td>{i.title}</td><td>{i.text}</td></tr>)}</tbody></table>
          ) : <span className="note">—</span>}
          {c.intake_no ? <div className="note">{c.intake_no} · {fmtDay(c.intake_received_at)}</div> : null}
        </div>
        <div className="box">
          <H en="Files" ar="الملفات" />
          {(files ?? []).length ? (
            <table className="t"><tbody>{(files ?? []).map((f, n) => <tr key={n}><td>{f.filename}</td><td>{FILE_CATEGORIES[f.category]?.en}</td></tr>)}</tbody></table>
          ) : <span className="note">—</span>}
        </div>
      </div>
      <div className="grid2 section">
        <div className="box">
          <H en="Payments" ar="المدفوعات" />
          <dl className="kv2">
            <dt>Quoted</dt><dd>{fmtMoney(c.quote_amount, c.quote_currency)}</dd>
            <dt>Paid</dt><dd>{Object.keys(paidTotal).length ? Object.entries(paidTotal).map(([k, v]) => fmtMoney(v, k)).join(" + ") : "—"}</dd>
            <dt>Invoices</dt><dd>{(invoices ?? []).map((x) => `${x.invoice_no} (${fmtMoney(x.total, x.currency)}${x.status === "void" ? ", void" : ""})`).join(", ") || "—"}</dd>
            <dt>Receipts</dt><dd>{(payments ?? []).map((x) => x.receipt_no + (x.voided ? " (void)" : "")).join(", ") || "—"}</dd>
          </dl>
        </div>
        <div className="box">
          <H en="Shipping & delivery" ar="الشحن والتسليم" />
          <dl className="kv2">
            <dt>Carrier / tracking</dt><dd>{[c.carrier, c.tracking_no].filter(Boolean).join(" · ") || "—"}</dd>
            <dt>Shipped</dt><dd>{fmtDay(c.shipped_at)}</dd>
            <dt>Delivered</dt><dd>{c.delivered_at ? `${fmtDay(c.delivered_at)} · ${c.received_by_name ?? ""}` : "—"}</dd>
            <dt>Delivery note</dt><dd>{c.delivery_no ?? "—"}</dd>
          </dl>
        </div>
      </div>
      <div className="section">
        <table className="t">
          <thead><tr><th style={{ width: "22%" }}>Date · التاريخ</th><th>Timeline · سجل الحالة</th><th style={{ width: "20%" }}>By · بواسطة</th></tr></thead>
          <tbody>
            {(events ?? []).map((e, n) => (
              <tr key={n}>
                <td>{fmtDate(e.created_at)}</td>
                <td>{e.kind === "status" ? `${STATUS[e.from_status as CaseStatus]?.en ?? "—"} → ${STATUS[e.to_status as CaseStatus]?.en}` : e.kind === "file" ? `File: ${e.body}` : e.kind === "payment" ? `Payment: ${e.body}` : e.body}</td>
                <td>{people.get(e.author_id)?.name ?? "System"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sign">
        <div>Agent · المندوب<br /><strong style={{ color: "#1d2939" }}>{agent?.name}</strong></div>
        <div>Treating doctor · الطبيب المعالج<br /><strong style={{ color: "#1d2939" }}>{c.doctor_name}</strong></div>
        <div>RUKN case manager · مدير الحالة</div>
      </div>
      <p className="note">Confidential — contains patient-related information. Handle according to applicable data-protection rules. · سري — يحتوي معلومات تخص مريضًا؛ يُتعامل معه وفق قواعد حماية البيانات.</p>
    </PrintShell>
  );
}
