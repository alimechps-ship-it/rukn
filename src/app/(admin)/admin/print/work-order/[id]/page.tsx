import { notFound, redirect } from "next/navigation";
import { can, getStaffUser } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { profileMap } from "@/lib/case-data";
import { ARCHES, fmtDay, fmtMoney, SEXES } from "@/lib/cases";
import { WO_STATUS, WORK_KINDS, type WorkOrder } from "@/lib/partners";
import { PrintShell } from "../../PrintShell";
import { loadCompany } from "../../company";

export const metadata = { title: "Work order", robots: { index: false } };
export const dynamic = "force-dynamic";

function H({ en, ar }: { en: string; ar: string }) {
  return <h2><span>{en}</span><span className="ar">{ar}</span></h2>;
}

export default async function PrintWorkOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getStaffUser();
  if (!user) redirect(`/admin/login?next=/admin/work/${id}`);
  if (!can.caseStaff(user) && !can.partner(user)) redirect("/admin?denied=1");
  const db = await createSessionClient();
  const { data } = await db.from("case_assignments").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const o = data as WorkOrder;
  const [{ data: brief }, { data: partner }, { data: files }, company] = await Promise.all([
    db.rpc("work_order_brief", { p_id: id }),
    db.from("partners").select("*").eq("id", o.partner_id).single(),
    db.from("case_files").select("filename,category,internal").eq("case_id", o.case_id).order("created_at"),
    loadCompany(db),
  ]);
  const b = brief as Record<string, unknown> & { records?: { title: string; text: string }[] };
  const people = await profileMap(db, [user.id]);
  return (
    <PrintShell back={`/admin/work/${id}`} company={company} docRef={o.order_no}>
      <div className="doc-title">
        <h1>Work Order<span className="ar">أمر عمل — {WORK_KINDS[o.kind]?.ar}</span></h1>
        <div className="doc-no"><div className="no">{o.order_no}</div><div className="date">{fmtDay(o.created_at)} · {WO_STATUS[o.status]?.en}</div>{o.due_date ? <div className="date">Due · <span className="ar">الموعد</span>: <strong>{fmtDay(o.due_date)}</strong></div> : null}</div>
      </div>
      <div className="grid2">
        <div className="box">
          <H en={o.kind === "production" ? "Production lab" : "Treatment planner"} ar={o.kind === "production" ? "المعمل" : "المخطط العلاجي"} />
          <dl className="kv2">
            <dt>Name</dt><dd>{partner?.name}</dd>
            {partner?.contact_name ? <><dt>Contact</dt><dd>{partner.contact_name}</dd></> : null}
            {partner?.phone ? <><dt>Phone</dt><dd><bdi dir="ltr">{partner.phone}</bdi></dd></> : null}
            {partner?.city || partner?.country ? <><dt>Location</dt><dd>{[partner?.city, partner?.country].filter(Boolean).join(", ")}</dd></> : null}
          </dl>
        </div>
        <div className="box">
          <H en="Case" ar="الحالة" />
          <dl className="kv2">
            <dt>Case code</dt><dd>{String(b?.case_code ?? "")}</dd>
            <dt>Patient ref.</dt><dd>{String(b?.patient_ref ?? "")}</dd>
            <dt>Age / sex</dt><dd>{String(b?.patient_age ?? "—")} / {b?.patient_sex ? SEXES[String(b.patient_sex)]?.en : "—"}</dd>
            <dt>Arches</dt><dd>{b?.arches ? ARCHES[String(b.arches)]?.en : "—"}</dd>
            {b?.treating_doctor ? <><dt>Treating doctor</dt><dd>{String(b.treating_doctor)}</dd></> : null}
            <dt>Service</dt><dd>{String(b?.service ?? "—")}</dd>
          </dl>
        </div>
      </div>
      <div className="box section">
        <H en="Work required" ar="العمل المطلوب" />
        <div style={{ fontWeight: 700, fontSize: "11pt" }}>{o.title}</div>
        {o.instructions ? <div style={{ whiteSpace: "pre-line", marginTop: 4 }} dir="auto">{o.instructions}</div> : null}
        {b?.description ? <div className="note"><strong>Clinical notes · ملاحظات سريرية:</strong> {String(b.description)}</div> : null}
      </div>
      {o.items?.length ? (
        <div className="section">
          <table className="t">
            <thead><tr><th style={{ width: 24 }}>#</th><th>Item · البند</th><th>Quantity / details · الكمية</th></tr></thead>
            <tbody>{o.items.map((i, n) => <tr key={n}><td>{n + 1}</td><td>{i.title}</td><td>{i.text}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}
      <div className="grid2 section">
        <div className="box">
          <H en="Files available" ar="الملفات المتاحة" />
          <div style={{ fontSize: "9pt" }}>{(files ?? []).filter((f) => !["payment_proof", "delivery_proof"].includes(f.category as string)).map((f) => f.filename).join(" · ") || "—"}</div>
        </div>
        <div className="box">
          <H en="Agreed cost" ar="التكلفة المتفق عليها" />
          <div className="amount" style={{ fontSize: "16pt" }}>{o.cost_amount !== null ? fmtMoney(o.cost_amount, o.currency) : "—"}</div>
          {o.tracking_no ? <div className="note">Shipped: {o.carrier} · {o.tracking_no}</div> : null}
        </div>
      </div>
      <div className="sign two">
        <div>Issued by RUKN · أصدره<br /><strong style={{ color: "#1d2939" }}>{can.caseStaff(user) ? people.get(user.id)?.name : ""}</strong></div>
        <div>Accepted by · قبله<br /><strong style={{ color: "#1d2939" }}>{partner?.name}</strong></div>
      </div>
    </PrintShell>
  );
}
