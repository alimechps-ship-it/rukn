import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { Check, Text } from "@/components/admin/fields";
import { can, requireStaff, ROLE_LABELS } from "@/lib/auth";
import { allLanguages, createSessionClient, fmtDate } from "@/lib/admin";
import type { AppRole } from "@/lib/types";
import { addUser, removeUser, sendPasswordReset, setUserPassword, updateUserAccess } from "../_actions/settings";
import { COUNTRIES } from "@/lib/cases";

export const metadata = { title: "Users & roles" };
const ROLES = Object.keys(ROLE_LABELS) as AppRole[];
const ROLE_HELP: Record<AppRole, string> = {
  super_admin: "Everything, including users and settings",
  content_manager: "Pages, services, media, FAQs, publishing",
  sales_manager: "Inquiries and internal notes",
  translator: "Draft translations in permitted languages only",
  case_manager: "All cases: processing, payments, shipping, reports",
  agent: "Field agent: submits and follows his own cases only",
  planner: "External treatment-planning doctor / clinic: sees only the work orders sent to him",
  lab: "External production lab (aligners, Snap-On, retainers): sees only its work orders",
};

export default async function Users() {
  const me = await requireStaff(can.admin);
  const db = await createSessionClient();
  const [{ data: profiles, error }, { data: roles }, langs, { data: partners }] = await Promise.all([
    db.from("profiles").select("*").order("created_at"),
    db.from("user_roles").select("user_id,role"),
    allLanguages(db),
    db.from("partners").select("id,name,kind").eq("active", true).order("name"),
  ]);
  const partnerOptions = (partners ?? []).map((p) => ({ value: p.id as string, label: `${p.name} (${p.kind === "lab" ? "lab" : "planner"})` }));
  const serviceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return (
    <>
      <div className="topbar"><div><h1>Users & roles</h1><div className="sub">There is no public registration. Only a Super Administrator can add people.</div></div></div>
      {error ? <div className="flash err">{error.message}</div> : null}
      {!serviceKey ? <div className="flash warn">SUPABASE_SERVICE_ROLE_KEY is not set on the server, so creating accounts, setting passwords and removing accounts are unavailable. Add it in Vercel → Settings → Environment Variables, then redeploy.</div> : null}
      <section className="panel highlight" id="add">
        <h2>Add a user · إضافة مستخدم</h2>
        <p className="small muted" style={{ marginTop: -6 }}>
          For an agent: fill the details, tick <strong>Agent</strong>, and press <strong>Create account</strong>. Leave the password empty to generate a strong one —
          it is shown once so you can send it to the agent (e.g. by WhatsApp). No e-mail or Supabase step is needed.
        </p>
        <ActionForm action={addUser} className="form-grid" resetOnSuccess>
          <Text name="email" label="E-mail (used to sign in)" type="email" required />
          <Text name="full_name" label="Full name" required />
          <Text name="password" label="Password (optional — empty = generate)" type="text" />
          <Text name="phone" label="Phone / WhatsApp" type="tel" />
          <Text name="organization" label="Company / organization (agents)" />
          <div className="field"><label htmlFor="new-country">Country (agents)</label><input id="new-country" name="country" type="text" list="country-list" autoComplete="off" maxLength={80} /></div>
          <Text name="region" label="Region / territory (agents)" />
          <div className="field"><label htmlFor="new-partner">Partner (planners / labs)</label><select id="new-partner" name="partner_id" defaultValue=""><option value="">—</option>{partnerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
          <div className="field full"><label>Roles</label><div className="btn-row">{ROLES.map((r) => <label key={r} className="check" title={ROLE_HELP[r]}><input type="checkbox" name={`role_${r}`} defaultChecked={r === "agent"} /> {ROLE_LABELS[r]}</label>)}</div></div>
          <div className="field full"><label>Translator languages</label><div className="btn-row">{langs.map((l) => <label key={l.code} className="check"><input type="checkbox" name={`locale_${l.code}`} /> {l.native_name}</label>)}</div></div>
          <div className="full btn-row">
            <SubmitButton name="mode" value="create" disabled={!serviceKey} pendingText="Creating…">Create account</SubmitButton>
            <SubmitButton name="mode" value="invite" className="btn secondary" disabled={!serviceKey} pendingText="Sending…">Send e-mail invitation instead</SubmitButton>
          </div>
        </ActionForm>
        <datalist id="country-list">{COUNTRIES.map(([code, name]) => <option key={code} value={name} />)}</datalist>
      </section>
      {(profiles ?? []).map((p) => {
        const mine = (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role as AppRole);
        return (
          <section className="panel" key={p.id}>
            <div className="panel-head">
              <div><h2 style={{ margin: 0 }}>{p.full_name || p.email}</h2><div className="small muted">{p.email} · joined {fmtDate(p.created_at)} {p.id === me.id ? "· this is you" : ""}</div></div>
              <div className="btn-row">
                <details className="inline-details">
                  <summary className="btn secondary small">Set password</summary>
                  <ActionForm action={setUserPassword.bind(null, p.id)} className="inline-form">
                    <input name="password" type="text" placeholder="empty = generate" aria-label="New password" autoComplete="off" />
                    <SubmitButton className="btn small" disabled={!serviceKey}>Set</SubmitButton>
                  </ActionForm>
                </details>
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
                <div className="field"><label htmlFor={`partner-${p.id}`}>Partner (planners / labs)</label><select id={`partner-${p.id}`} name="partner_id" defaultValue={p.partner_id ?? ""}><option value="">—</option>{partnerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
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
