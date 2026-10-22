import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient, fmtDate } from "@/lib/admin";
import { profileMap } from "@/lib/case-data";
import { fmtMoney } from "@/lib/cases";
import { DISPATCH_STATUS } from "@/lib/dispatch";
import { invoiceFromDispatch } from "../../_actions/dispatch";

export const metadata = { title: "To price" };

export default async function ToPricePage() {
  await requireStaff(can.finance);
  const db = await createSessionClient();
  const [{ data: sent }, { data: drafts }, { data: recent }] = await Promise.all([
    db.from("case_dispatch_orders").select("id,order_no,case_id,status,notes,sent_at,sent_by,case_dispatch_lines(description,qty,unit)").eq("status", "sent").order("sent_at"),
    db.from("case_invoices").select("id,invoice_no,case_id,currency,total,created_at").eq("status", "draft").order("created_at"),
    db.from("case_dispatch_orders").select("id,order_no,case_id,status,invoice_id,invoiced_at").eq("status", "invoiced").order("invoiced_at", { ascending: false }).limit(20),
  ]);
  const caseIds = [...new Set([...(sent ?? []), ...(drafts ?? []), ...(recent ?? [])].map((x) => x.case_id as string))];
  const [{ data: cases }, people] = await Promise.all([
    caseIds.length ? db.from("cases").select("id,code,clinic_name,doctor_name").in("id", caseIds) : Promise.resolve({ data: [] }),
    profileMap(db, (sent ?? []).map((d) => d.sent_by as string)),
  ]);
  const cs = new Map((cases ?? []).map((c) => [c.id as string, c as { id: string; code: string; clinic_name: string; doctor_name: string }]));
  type Line = { description: string; qty: number; unit: string | null };
  return (
    <>
      <div className="topbar">
        <div>
          <h1>To price · بانتظار التسعير</h1>
          <div className="sub">Dispatch orders the case managers sent with the services and quantities. Price each one into an invoice (prices come from the price list), review the draft, then issue it.</div>
        </div>
      </div>

      <section className="panel">
        <h2>Dispatch orders waiting for prices ({(sent ?? []).length})</h2>
        {(sent ?? []).length ? (
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th>Order</th><th>Case</th><th>Services · quantities</th><th>Sent</th><th /></tr></thead>
              <tbody>
                {(sent ?? []).map((d) => {
                  const c = cs.get(d.case_id as string);
                  const lines = (d.case_dispatch_lines ?? []) as unknown as Line[];
                  return (
                    <tr key={d.id}>
                      <td><Link className="mono" href={`/admin/cases/${d.case_id}/dispatch/${d.id}`}>{d.order_no}</Link></td>
                      <td><Link href={`/admin/cases/${d.case_id}`}><strong>{c?.code}</strong></Link><div className="small muted">{c?.clinic_name} · {c?.doctor_name}</div></td>
                      <td className="small">{lines.map((l, i) => <div key={i}>{l.description} × <strong>{Number(l.qty)}</strong>{l.unit ? ` ${l.unit}` : ""}</div>)}{d.notes ? <div className="muted">Note: {d.notes}</div> : null}</td>
                      <td className="small">{d.sent_at ? fmtDate(d.sent_at as string) : ""}<div className="muted">{people.get(d.sent_by as string)?.name ?? ""}</div></td>
                      <td className="nowrap">
                        <ActionForm action={invoiceFromDispatch}>
                          <input type="hidden" name="id" value={d.id} />
                          <SubmitButton className="btn teal small" pendingText="Pricing…">Price & invoice →</SubmitButton>
                        </ActionForm>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="small muted">Nothing waiting 👍</p>}
      </section>

      <section className="panel" id="drafts">
        <h2>Draft invoices to review & issue ({(drafts ?? []).length})</h2>
        {(drafts ?? []).length ? (
          <table className="data">
            <thead><tr><th>Invoice</th><th>Case</th><th className="num">Total</th><th>Created</th></tr></thead>
            <tbody>
              {(drafts ?? []).map((i) => (
                <tr key={i.id} className="row-link">
                  <td><Link className="stretched mono" href={`/admin/cases/${i.case_id}/invoices/${i.id}`}>{i.invoice_no}</Link></td>
                  <td>{cs.get(i.case_id as string)?.code}<div className="small muted">{cs.get(i.case_id as string)?.clinic_name}</div></td>
                  <td className="num">{fmtMoney(Number(i.total), i.currency as string)}</td>
                  <td className="small">{fmtDate(i.created_at as string)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="small muted">No draft invoices.</p>}
      </section>

      {(recent ?? []).length ? (
        <section className="panel">
          <h2>Recently priced</h2>
          <table className="data">
            <tbody>
              {(recent ?? []).map((d) => (
                <tr key={d.id}>
                  <td className="mono small"><Link href={`/admin/cases/${d.case_id}/dispatch/${d.id}`}>{d.order_no}</Link></td>
                  <td>{cs.get(d.case_id as string)?.code}</td>
                  <td><span className={`pill ${DISPATCH_STATUS.invoiced.tone}`}>{DISPATCH_STATUS.invoiced.en}</span></td>
                  <td className="small">{d.invoiced_at ? fmtDate(d.invoiced_at as string) : ""}</td>
                  <td>{d.invoice_id ? <Link className="small" href={`/admin/cases/${d.case_id}/invoices/${d.invoice_id}`}>Invoice →</Link> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </>
  );
}
