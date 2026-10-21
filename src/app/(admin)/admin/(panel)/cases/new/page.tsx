import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { peopleWithRole, serviceOptions } from "@/lib/case-data";
import { createCase } from "../../_actions/cases";
import { CaseFormFields } from "../CaseForm";

export const metadata = { title: "New case" };

export default async function NewCase() {
  const user = await requireStaff(can.cases);
  const staff = can.caseStaff(user);
  const db = await createSessionClient();
  const [services, agents, staffUsers] = await Promise.all([
    serviceOptions(db),
    staff ? peopleWithRole(db, ["agent"]) : Promise.resolve([]),
    staff ? peopleWithRole(db, ["case_manager", "super_admin"]) : Promise.resolve([]),
  ]);
  return (
    <>
      <div className="topbar"><div><div className="small"><Link href="/admin/cases">← Cases</Link></div><h1>New case · حالة جديدة</h1><div className="sub">A case code is generated automatically. After saving you can upload the scans, photos and records.</div></div></div>
      <section className="panel">
        {staff && agents.length === 0 ? <div className="flash warn">No agents yet. Invite agents in Users &amp; roles (role “Agent”).</div> : null}
        <ActionForm action={createCase}>
          <CaseFormFields services={services} agents={agents} staffUsers={staffUsers} isStaff={staff} />
          <div style={{ marginTop: 16 }}><SubmitButton className="btn teal" pendingText="Creating…">Create case</SubmitButton></div>
        </ActionForm>
      </section>
    </>
  );
}
