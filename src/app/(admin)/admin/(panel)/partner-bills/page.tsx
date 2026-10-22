import { can, requireStaff } from "@/lib/auth";
import { docCredits } from "@/lib/adjustments";
import { createSessionClient } from "@/lib/admin";
import { costsFor, type WorkOrder } from "@/lib/partners";
import { BillsTable, NewBillForm, type Bill } from "../partners/PartnerParts";

export const metadata = { title: "Partner bills" };

export default async function PartnerBills() {
  const user = await requireStaff((u) => can.finance(u) || can.partner(u));
  const staff = can.finance(user);
  const db = await createSessionClient();
  const [{ data: bills }, { data: pays }, { data: partners }] = await Promise.all([
    db.from("partner_bills").select("*").order("created_at", { ascending: false }).limit(300),
    db.from("partner_payments").select("bill_id,amount,voided").not("bill_id", "is", null),
    db.from("partners").select("id,name,currency").order("name"),
  ]);
  const paidByBill = new Map<string, number>();
  for (const p of pays ?? []) if (!p.voided) paidByBill.set(p.bill_id as string, (paidByBill.get(p.bill_id as string) ?? 0) + Number(p.amount));
  for (const [k, v] of await docCredits(db, { billIds: (bills ?? []).map((b) => b.id as string) })) paidByBill.set(k, (paidByBill.get(k) ?? 0) + v);
  const partnerNames = new Map((partners ?? []).map((p) => [p.id as string, p.name as string]));
  const list = (bills ?? []) as Bill[];

  let billable: WorkOrder[] = [];
  if (!staff) {
    const [{ data: wos }, { data: lines }] = await Promise.all([
      db.from("case_assignments").select("*").in("status", ["completed", "shipped", "received"]),
      db.from("partner_bill_lines").select("assignment_id,partner_bills!inner(status)").not("assignment_id", "is", null),
    ]);
    const billed = new Set(((lines ?? []) as unknown as { assignment_id: string; partner_bills: { status: string } }[]).filter((l) => ["submitted", "approved"].includes(l.partner_bills.status)).map((l) => l.assignment_id));
    billable = ((wos ?? []) as WorkOrder[]).filter((o) => !billed.has(o.id));
  }
  const costs = await costsFor(db, billable.map((o) => o.id));
  const pending = list.filter((b) => b.status === "submitted");
  return (
    <>
      <div className="topbar">
        <div>
          <h1>{staff ? "Partner bills · فواتير الشركاء" : "My bills · فواتيري"}</h1>
          <div className="sub">{staff ? "Bills from planners and labs. Approve them to make them payable (Planners & labs → Pay)." : "Bill RUKN for your completed work orders. RUKN reviews the bill, then pays it — you see each payment in your statement."}</div>
        </div>
      </div>
      {!staff ? (
        <section className="panel">
          <h2>New bill · فاتورة جديدة</h2>
          <NewBillForm currency={(partners ?? [])[0]?.currency as string ?? "USD"} orders={billable} costs={costs} />
        </section>
      ) : null}
      {staff ? (
        <section className="panel">
          <h2>Awaiting review · بانتظار المراجعة ({pending.length})</h2>
          {pending.length ? <BillsTable bills={pending} staff partnerNames={partnerNames} paidByBill={paidByBill} /> : <p className="small muted">Nothing to review 👍</p>}
        </section>
      ) : null}
      <section className="panel">
        <h2>{staff ? "All bills" : "Your bills"}</h2>
        <BillsTable bills={staff ? list.filter((b) => b.status !== "submitted") : list} staff={staff} partnerNames={staff ? partnerNames : undefined} paidByBill={paidByBill} me={user.id} />
      </section>
    </>
  );
}
