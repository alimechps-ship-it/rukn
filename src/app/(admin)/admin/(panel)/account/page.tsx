import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { Text } from "@/components/admin/fields";
import { requireStaff, ROLE_LABELS } from "@/lib/auth";
import { updateOwnAccount } from "../_actions/settings";

export const metadata = { title: "My account" };

export default async function Account() {
  const me = await requireStaff();
  return (
    <>
      <div className="topbar"><div><h1>My account</h1><div className="sub">{me.email} · {me.roles.map((r) => ROLE_LABELS[r]).join(", ")}</div></div></div>
      <section className="panel" style={{ maxWidth: 640 }}>
        <ActionForm action={updateOwnAccount} className="form-grid">
          <Text name="full_name" label="Display name" defaultValue={me.fullName} full />
          <Text name="password" label="New password (optional)" type="password" />
          <Text name="confirm" label="Repeat new password" type="password" />
          <div className="full"><SubmitButton>Save</SubmitButton></div>
        </ActionForm>
      </section>
    </>
  );
}
