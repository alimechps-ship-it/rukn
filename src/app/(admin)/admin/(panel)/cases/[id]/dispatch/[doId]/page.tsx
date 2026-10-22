import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { DispatchEditor } from "@/components/admin/DispatchEditor";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient, fmtDate } from "@/lib/admin";
import { profileMap } from "@/lib/case-data";
import { DISPATCH_STATUS, type CatalogItem, type DispatchLine } from "@/lib/dispatch";
import { LINE_ARCHES } from "@/lib/invoices";
import { invoiceFromDispatch, saveDispatch, setDispatchStatus } from "../../../../_actions/dispatch";

export const metadata = { title: "Dispatch order" };

export default async function DispatchPage({ params }: { params: Promise<{ id: string; doId: string }> }) {
  const { id, doId } = await params;
  const user = await requireStaff(can.caseStaff);
  const ops = can.ops(user);
  const fin = can.finance(user);
  const db = await createSessionClient();
  const [{ data: d }, { data: c }] = await Promise.all([
    db.from("case_dispatch_orders").select("*").eq("id", doId).eq("case_id", id).maybeSingle(),
    db.from("cases").select("id,code,clinic_name,doctor_name,patient_ref,service_label").eq("id", id).maybeSingle(),
  ]);
  if (!d || !c) notFound();
  const [{ data: lines }, { data: catalog }] = await Promise.all([
    db.from("case_dispatch_lines").select("*").eq("dispatch_id", doId).order("sort_order"),
    ops && d.status === "draft" ? db.rpc("catalog_items") : Promise.resolve({ data: [] }),
  ]);
  const people = await profileMap(db, [d.created_by, d.sent_by]);
  const st = DISPATCH_STATUS[d.status];
  const list = (lines ?? []) as (DispatchLine & { id: string })[];
  return (
    <>
      <div className="topbar">
        <div>
          <div className="small"><Link href={`/admin/cases/${id}#dispatch`}>← {c.code}</Link></div>
          <h1><span className="mono">{d.order_no}</span> <span className={`pill ${st?.tone}`}>{st?.en} · {st?.ar}</span></h1>
          <div className="sub">Dispatch order · إذن صرف — {c.clinic_name} · {c.doctor_name} · patient {c.patient_ref}</div>
        </div>
        <div className="btn-row">
          <a className="btn secondary" href={`/admin/print/dispatch/${doId}`} target="_blank" rel="noopener">🖨 Print · طباعة</a>
          {fin && d.status === "sent" ? (
            <ActionForm action={invoiceFromDispatch}>
              <input type="hidden" name="id" value={doId} />
              <SubmitButton className="btn teal" pendingText="Pricing…">Price & create invoice →</SubmitButton>
            </ActionForm>
          ) : null}
          {fin && d.invoice_id ? <Link className="btn teal" href={`/admin/cases/${id}/invoices/${d.invoice_id}`}>Open invoice</Link> : null}
        </div>
      </div>
      <p className="small muted">Prepared by {people.get(d.created_by)?.name ?? "—"} · {fmtDate(d.created_at)}{d.sent_at ? ` · sent to finance ${fmtDate(d.sent_at)} by ${people.get(d.sent_by)?.name ?? ""}` : ""}</p>

      <section className="panel">
        {ops && d.status === "draft" ? (
          <DispatchEditor action={saveDispatch.bind(null, doId)} lines={list} notes={d.notes} catalog={(catalog ?? []) as CatalogItem[]} />
        ) : (
          <>
            <table className="data">
              <thead><tr><th>#</th><th>Service · الخدمة</th><th>Arch</th><th className="num">Quantity</th><th>Unit</th></tr></thead>
              <tbody>
                {list.map((l, i) => (
                  <tr key={l.id}><td className="muted">{i + 1}{l.code ? <div className="mono small">{l.code}</div> : null}</td><td>{l.description}{l.description_ar ? <div className="small muted" dir="rtl">{l.description_ar}</div> : null}</td><td>{l.arch ? LINE_ARCHES[l.arch]?.en : "—"}</td><td className="num"><strong>{Number(l.qty)}</strong></td><td className="small">{l.unit ?? ""}</td></tr>
                ))}
              </tbody>
            </table>
            {d.notes ? <p style={{ whiteSpace: "pre-line" }}><strong>Notes:</strong> {d.notes}</p> : null}
          </>
        )}
      </section>

      {ops && d.status === "sent" ? (
        <section className="panel">
          <h2>Change it? · تعديل</h2>
          <p className="small muted">Finance has not priced it yet. Recall it to edit the services, then send again.</p>
          <ActionForm action={setDispatchStatus.bind(null, doId)}><input type="hidden" name="status" value="draft" /><SubmitButton className="btn secondary small">Recall from finance</SubmitButton></ActionForm>
        </section>
      ) : null}
      {ops && d.status === "draft" ? (
        <ActionForm action={setDispatchStatus.bind(null, doId)}><input type="hidden" name="status" value="cancelled" /><SubmitButton className="btn danger small">Cancel this dispatch order</SubmitButton></ActionForm>
      ) : null}
    </>
  );
}
