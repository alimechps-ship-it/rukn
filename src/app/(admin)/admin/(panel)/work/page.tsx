import Link from "next/link";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { WO_STATUS, type WorkOrder } from "@/lib/partners";
import { WorkOrdersTable } from "../partners/PartnerParts";

export const metadata = { title: "Work orders" };

export default async function WorkOrders({ searchParams }: { searchParams: Promise<{ status?: string; partner?: string }> }) {
  const sp = await searchParams;
  const user = await requireStaff((u) => can.caseStaff(u) || can.partner(u));
  const staff = can.caseStaff(user);
  const db = await createSessionClient();
  let q = db.from("case_assignments").select("*").order("created_at", { ascending: false }).limit(500);
  if (sp.status === "open") q = q.in("status", ["assigned", "accepted", "in_progress"]);
  else if (sp.status === "review") q = q.in("status", ["completed", "shipped"]);
  else if (sp.status && sp.status in WO_STATUS) q = q.eq("status", sp.status);
  if (staff && sp.partner && /^[0-9a-f-]{36}$/i.test(sp.partner)) q = q.eq("partner_id", sp.partner);
  const [{ data: orders }, { data: partners }] = await Promise.all([q, db.from("partners").select("id,name").order("name")]);
  const wos = (orders ?? []) as WorkOrder[];
  const { data: cases } = staff && wos.length ? await db.from("cases").select("id,code").in("id", [...new Set(wos.map((o) => o.case_id))]) : { data: [] };
  const caseCodes = new Map((cases ?? []).map((c) => [c.id as string, c.code as string]));
  const partnerNames = new Map((partners ?? []).map((p) => [p.id as string, p.name as string]));
  const tab = (s: string, label: string) => <Link className={`btn small ${sp.status === s || (!sp.status && !s) ? "" : "secondary"}`} href={`/admin/work${s ? `?status=${s}` : ""}`}>{label}</Link>;
  return (
    <>
      <div className="topbar">
        <div>
          <h1>Work orders · أوامر العمل</h1>
          <div className="sub">{staff ? "Planning and production orders sent to planners and labs." : `Orders RUKN sent to ${partnerNames.values().next().value ?? "you"}. Open one to see the case brief, download the files, upload your work and update the status.`}</div>
        </div>
      </div>
      <div className="btn-row" style={{ marginBottom: 12 }}>
        {tab("", "All")}{tab("open", "Open · مفتوحة")}{tab("review", staff ? "Done — to receive / check" : "Completed / shipped")}{tab("received", "Received")}
      </div>
      <section className="panel">
        <WorkOrdersTable orders={wos} caseCodes={caseCodes} partnerNames={partnerNames} showCase={staff} showPartner={staff} />
      </section>
    </>
  );
}
