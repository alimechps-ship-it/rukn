import Link from "next/link";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { profileMap } from "@/lib/case-data";
import { NoticesTable, type Notice } from "../Notices";
import { isAiConfigured } from "@/lib/ai";

export const metadata = { title: "Payment notices" };

export default async function NoticesPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const sp = await searchParams;
  await requireStaff(can.finance);
  const db = await createSessionClient();
  const [{ data: pending }, { data: recent }, { data: boxes }] = await Promise.all([
    db.from("case_payment_claims").select("*").eq("status", "pending").order("created_at"),
    db.from("case_payment_claims").select("*").neq("status", "pending").order("reviewed_at", { ascending: false }).limit(sp.all ? 500 : 30),
    db.from("cash_accounts").select("id,name,currency").eq("active", true).order("sort_order"),
  ]);
  const all = [...(pending ?? []), ...(recent ?? [])] as Notice[];
  const caseIds = [...new Set(all.map((n) => n.case_id))];
  const invIds = [...new Set(all.map((n) => n.invoice_id).filter(Boolean))] as string[];
  const payIds = [...new Set(all.map((n) => n.payment_id).filter(Boolean))] as string[];
  const [{ data: cases }, { data: invs }, { data: pays }, people] = await Promise.all([
    caseIds.length ? db.from("cases").select("id,code").in("id", caseIds) : Promise.resolve({ data: [] }),
    invIds.length ? db.from("case_invoices").select("id,invoice_no").in("id", invIds) : Promise.resolve({ data: [] }),
    payIds.length ? db.from("case_payments").select("id,receipt_no").in("id", payIds) : Promise.resolve({ data: [] }),
    profileMap(db, all.map((n) => n.submitted_by)),
  ]);
  const caseCodes = new Map((cases ?? []).map((c) => [c.id as string, c.code as string]));
  const invoiceNos = new Map((invs ?? []).map((i) => [i.id as string, i.invoice_no as string]));
  const receiptNos = new Map((pays ?? []).map((p) => [p.id as string, { no: p.receipt_no as string, id: p.id as string }]));
  const names = new Map([...people.entries()].map(([k, v]) => [k, v.name]));
  const props = { staff: true, boxes: (boxes ?? []) as { id: string; name: string; currency: string }[], caseCodes, invoiceNos, receiptNos, names, showCase: true, aiEnabled: isAiConfigured() };
  return (
    <>
      <div className="topbar"><div><h1>Payment notices · إشعارات الدفع</h1><div className="sub">Transfers the agents say they sent. Check the money arrived, then confirm — the receipt is issued and the amount goes into the cash box you choose.</div></div></div>
      <section className="panel">
        <h2>Awaiting confirmation · بانتظار التأكيد ({(pending ?? []).length})</h2>
        {(pending ?? []).length ? <NoticesTable notices={(pending ?? []) as Notice[]} {...props} /> : <p className="small muted">Nothing to review 👍</p>}
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Reviewed · تمت مراجعتها</h2>{!sp.all ? <Link className="small" href="/admin/finance/notices?all=1">Show all</Link> : null}</div>
        <NoticesTable notices={(recent ?? []) as Notice[]} {...props} />
      </section>
    </>
  );
}
