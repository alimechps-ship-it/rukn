import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { Check, Text } from "@/components/admin/fields";
import { can, requireStaff, ROLE_LABELS } from "@/lib/auth";
import { allLanguages, createSessionClient, fmtDate } from "@/lib/admin";
import type { AppRole } from "@/lib/types";
import { inviteUser, removeUser, sendPasswordReset, updateUserAccess } from "../_actions/settings";

export const metadata = { title: "Users & roles" };
const ROLES = Object.keys(ROLE_LABELS) as AppRole[];
const ROLE_HELP: Record<AppRole, string> = {
  super_admin: "Everything, including users and settings",
  content_manager: "Pages, services, media, FAQs, publishing",
  sales_manager: "Inquiries and internal notes",
  translator: "Draft translations in permitted languages only",
  case_manager: "All cases: processing, payments, shipping, reports",
  agent: "Field agent: submits and follows his own cases only",
};

export default async function Users() {
  const me = await requireStaff(can.admin);
  const db = await createSessionClient();
  const [{ data: profiles, error }, { data: roles }, langs] = await Promise.all([
    db.from("profiles").select("*").order("created_at"),
    db.from("user_roles").select("user_id,role"),
    allLanguages(db),
  ]);
  const serviceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return (
    <>
      <div className="topbar"><div><h1>Users & roles</h1><div className="sub">There is no public registration. People join only by invitation.</div></div></div>
      {error ? <div className="flash err">{error.message}</div> : null}
      {!serviceKey ? <div className="flash warn">SUPABASE_SERVICE_ROLE_KEY is not set on the server, so invitations and account removal are unavailable here. You can invite users from the Supabase dashboard and assign roles below.</div> : null}
      <section className="panel">
        <h2>Invite a team member</h2>
        <ActionForm action={inviteUser} className="form-grid" resetOnSuccess>
          <Text name="email" label="E-mail" type="email" required />
          <Text name="full_name" label="Full name" />
          <Text name="organization" label="Company / organization (agents)" />
          <Text name="country" label="Country (agents)" />
          <Text name="region" label="Region / territory (agents)" />
          <Text name="phone" label="Phone / WhatsApp" type="tel" />
          <div className="field full"><label>Roles</label><div className="btn-row">{ROLES.map((r) => <label key={r} className="check" title={ROLE_HELP[r]}><input type="checkbox" name={`role_${r}`} /> {ROLE_LABELS[r]}</label>)}</div></div>
          <div className="field full"><label>Translator languages</label><div className="btn-row">{langs.map((l) => <label key={l.code} className="check"><input type="checkbox" name={`locale_${l.code}`} /> {l.native_name}</label>)}</div></div>
          <div className="full"><SubmitButton disabled={!serviceKey}>Send invitation</SubmitButton></div>
        </ActionForm>
      </section>
      {(profiles ?? []).map((p) => {
        const mine = (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role as AppRole);
        return (
          <section className="panel" key={p.id}>
            <div className="panel-head">
              <div><h2 style={{ margin: 0 }}>{p.full_name || p.email}</h2><div className="small muted">{p.email} · joined {fmtDate(p.created_at)} {p.id === me.id ? "· this is you" : ""}</div></div>
              <div className="btn-row">
                <ConfirmAction action={sendPasswordReset} hidden={{ email: p.email }} label="Send password reset" title="Send password reset?" message={`A reset link will be e-mailed to ${p.email}.`} confirmLabel="Send" />
                {p.id !== me.id ? <ConfirmAction action={removeUser} hidden={{ id: p.id }} danger label="Remove account" title="Remove this account?" message="The person loses access immediately and their login is deleted. Their past notes remain but show as a former staff member." confirmLabel="Remove" /> : null}
              </div>
            </div>
            <ActionForm action={updateUserAccess.bind(null, p.id)}>
              <div className="form-grid">
                <Text name="full_name" label="Full name" defaultValue={p.full_name} />
                <Check name="is_active" label="Active (can sign in to the admin)" defaultChecked={p.is_active} />
                <Text name="organization" label="Company / organization" defaultValue={p.organization} />
                <Text name="country" label="Country" defaultValue={p.country} />
                <Text name="region" label="Region / territory" defaultValue={p.region} />
                <Text name="phone" label="Phone / WhatsApp" type="tel" defaultValue={p.phone} />
                <div className="field full"><label>Roles</label><div className="btn-row">{ROLES.map((r) => <label key={r} className="check" title={ROLE_HELP[r]}><input type="checkbox" name={`role_${r}`} defaultChecked={mine.includes(r)} /> {ROLE_LABELS[r]}</label>)}</div></div>
                <div className="field full"><label>Translator languages</label><div className="btn-row">{langs.map((l) => <label key={l.code} className="check"><input type="checkbox" name={`locale_${l.code}`} defaultChecked={(p.allowed_locales ?? []).includes(l.code)} /> {l.native_name}</label>)}</div></div>
              </div>
              <SubmitButton className="btn secondary">Save access</SubmitButton>
            </ActionForm>
          </section>
        );
      })}
    </>
  );
}
