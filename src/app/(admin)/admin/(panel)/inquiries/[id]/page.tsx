import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { Select } from "@/components/admin/fields";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient, fmtDate } from "@/lib/admin";
import { addNote, deleteInquiry, deleteNote, updateInquiry } from "../../_actions/inquiries";

export const metadata = { title: "Inquiry" };
const STATUSES = ["new", "in_review", "contacted", "qualified", "converted", "closed"];

export default async function InquiryDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaff(can.inquiries);
  const db = await createSessionClient();
  const [{ data: i }, { data: notes }, { data: staff }, { data: roles }] = await Promise.all([
    db.from("inquiries").select("*").eq("id", id).maybeSingle(),
    db.from("inquiry_notes").select("id,body,created_at,author_id").eq("inquiry_id", id).order("created_at"),
    db.from("profiles").select("id,email,full_name,is_active").eq("is_active", true),
    can.admin(user) ? db.from("user_roles").select("user_id,role") : Promise.resolve({ data: null }),
  ]);
  if (!i) notFound();
  const assignable = (staff ?? []).filter((p) => !roles || roles.some((r) => r.user_id === p.id && (r.role === "sales_manager" || r.role === "super_admin")));
  const who = (uid: string | null) => (staff ?? []).find((p) => p.id === uid)?.full_name ?? (staff ?? []).find((p) => p.id === uid)?.email ?? "Former staff member";
  const rows: [string, React.ReactNode][] = [
    ["Type", <span key="t" className="pill">{i.type}</span>],
    ["Name", i.name],
    ["E-mail", <a key="e" href={`mailto:${i.email}`}>{i.email}</a>],
    ["Phone", i.phone ?? "—"],
    ["Country", i.country ?? "—"],
    ["Organization", i.organization ?? "—"],
    ["Professional role", i.professional_role ?? "—"],
    ["Service", i.service_label ?? "—"],
    ["Language", i.locale ?? "—"],
    ["Submitted from", <span key="s" className="mono">{i.source_path ?? "—"}</span>],
    ["Received", fmtDate(i.created_at)],
    ["Consent given", i.consent ? "Yes" : "No"],
  ];
  return (
    <>
      <div className="topbar">
        <div><div className="small"><Link href="/admin/inquiries">← Inquiries</Link></div><h1>{i.name}</h1><div className="sub"><span className={`pill ${i.status}`}>{i.status.replace("_", " ")}</span> · {i.organization ?? i.email}</div></div>
        {can.admin(user) ? <ConfirmAction action={deleteInquiry} hidden={{ id: i.id }} danger small={false} label="Delete inquiry" title="Delete this inquiry permanently?" message="The inquiry and all internal notes are removed. Use this for spam or data-deletion requests. This cannot be undone." confirmLabel="Delete permanently" /> : null}
      </div>
      <div className="cols">
        <section className="panel">
          <h2>Details</h2>
          <dl className="kv">{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
          <h3 style={{ marginTop: 18 }}>Message</h3>
          <p style={{ whiteSpace: "pre-wrap" }} dir="auto">{i.message ?? <span className="muted">No message.</span>}</p>
        </section>
        <div>
          <section className="panel">
            <h2>Status & assignment</h2>
            <ActionForm action={updateInquiry.bind(null, i.id)} className="form-grid">
              <Select name="status" label="Status" defaultValue={i.status} options={STATUSES.map((s) => ({ value: s, label: s.replace("_", " ") }))} />
              <Select name="assigned_to" label="Assigned to" defaultValue={i.assigned_to ?? ""} options={[{ value: "", label: "Unassigned" }, ...assignable.map((p) => ({ value: p.id, label: p.full_name ?? p.email }))]} />
              <div className="full"><SubmitButton>Update</SubmitButton></div>
            </ActionForm>
          </section>
          <section className="panel">
            <h2>Internal notes</h2>
            <p className="small muted">Never visible to the person who submitted the inquiry.</p>
            <ul className="timeline">
              {(notes ?? []).length === 0 ? <li className="muted">No notes yet.</li> : null}
              {(notes ?? []).map((n) => (
                <li key={n.id}>
                  <div style={{ whiteSpace: "pre-wrap" }} dir="auto">{n.body}</div>
                  <div className="small muted">{who(n.author_id)} · {fmtDate(n.created_at)} {n.author_id === user.id || can.admin(user) ? <ConfirmAction action={deleteNote} hidden={{ id: n.id }} danger label="Delete" title="Delete note?" message="This note will be removed permanently." confirmLabel="Delete" /> : null}</div>
                </li>
              ))}
            </ul>
            <ActionForm action={addNote.bind(null, i.id)} resetOnSuccess>
              <div className="field"><label htmlFor="body">Add a note</label><textarea id="body" name="body" maxLength={4000} required dir="auto" /></div>
              <SubmitButton>Add note</SubmitButton>
            </ActionForm>
          </section>
        </div>
      </div>
    </>
  );
}
