import { notFound, redirect } from "next/navigation";
import { can, getStaffUser } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { profileMap } from "@/lib/case-data";
import { ARCHES, countryName, fmtDay } from "@/lib/cases";
import { DISPATCH_STATUS } from "@/lib/dispatch";
import { LINE_ARCHES } from "@/lib/invoices";
import { PrintShell } from "../../PrintShell";
import { loadCompany } from "../../company";

export const metadata = { title: "Dispatch order", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function PrintDispatch({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getStaffUser();
  if (!user) redirect("/admin/login");
  if (!can.caseStaff(user)) redirect("/admin?denied=1");
  const db = await createSessionClient();
  const { data: d } = await db.from("case_dispatch_orders").select("*").eq("id", id).maybeSingle();
  if (!d) notFound();
  const [{ data: c }, { data: lines }, company] = await Promise.all([
    db.from("cases").select("code,clinic_name,doctor_name,patient_ref,country_code,arches,service_label,agent_id").eq("id", d.case_id).single(),
    db.from("case_dispatch_lines").select("*").eq("dispatch_id", id).order("sort_order"),
    loadCompany(db),
  ]);
  const people = await profileMap(db, [d.created_by, d.sent_by, c?.agent_id]);
  const totalQty = (lines ?? []).reduce((a, l) => a + Number(l.qty), 0);
  return (
    <PrintShell back={`/admin/cases/${d.case_id}/dispatch/${id}`} company={company} docRef={d.order_no}>
      {d.status === "cancelled" ? <div className="void">VOID</div> : null}
      <div className="doc-title">
        <h1>Dispatch Order<span className="ar">إذن صرف</span></h1>
        <div className="doc-no"><div className="no">{d.order_no}</div><div className="date">{fmtDay(d.created_at)} · {DISPATCH_STATUS[d.status]?.en}</div></div>
      </div>
      <div className="grid2">
        <div className="box">
          <h2><span>Case</span><span className="ar">الحالة</span></h2>
          <dl className="kv2">
            <dt>Case code</dt><dd>{c?.code}</dd>
            <dt>Patient ref.</dt><dd>{c?.patient_ref}</dd>
            <dt>Arches</dt><dd>{c?.arches ? ARCHES[c.arches]?.en : "—"}</dd>
            <dt>Service</dt><dd>{c?.service_label ?? "—"}</dd>
          </dl>
        </div>
        <div className="box">
          <h2><span>Clinic</span><span className="ar">العيادة</span></h2>
          <dl className="kv2">
            <dt>Clinic</dt><dd>{c?.clinic_name}</dd>
            <dt>Doctor</dt><dd>{c?.doctor_name}</dd>
            <dt>Country</dt><dd>{countryName(c?.country_code)}</dd>
            <dt>Agent</dt><dd>{people.get(c?.agent_id ?? "")?.name ?? "—"}</dd>
          </dl>
        </div>
      </div>
      <div className="section">
        <table className="t">
          <thead><tr><th style={{ width: 24 }}>#</th><th>Service · الخدمة</th><th>Arch · الفك</th><th className="num">Quantity · الكمية</th><th>Unit · الوحدة</th></tr></thead>
          <tbody>
            {(lines ?? []).map((l, i) => (
              <tr key={l.id}>
                <td>{i + 1}</td>
                <td><strong>{l.description}</strong>{l.description_ar ? <div className="ar" style={{ textAlign: "start" }}>{l.description_ar}</div> : null}{l.code ? <div style={{ fontSize: "7.5pt", color: "#8a97a5", fontFamily: "ui-monospace, monospace" }}>{l.code}</div> : null}</td>
                <td>{l.arch ? <>{LINE_ARCHES[l.arch]?.en} <span className="ar">{LINE_ARCHES[l.arch]?.ar}</span></> : "—"}</td>
                <td className="num"><strong>{Number(l.qty)}</strong></td>
                <td>{l.unit ?? ""}</td>
              </tr>
            ))}
            <tr><td /><td colSpan={2}><strong>Total quantity · إجمالي الكميات</strong></td><td className="num"><strong>{totalQty}</strong></td><td /></tr>
          </tbody>
        </table>
      </div>
      {d.notes ? <div className="note"><strong>Notes · ملاحظات:</strong> {d.notes}</div> : null}
      <div className="sign">
        <div>Prepared by (case manager) · أعدّه<br /><strong style={{ color: "#1d2939" }}>{people.get(d.created_by)?.name ?? ""}</strong></div>
        <div>Approved by (finance) · اعتماد المالية</div>
        <div>Received by · المستلم</div>
      </div>
    </PrintShell>
  );
}
