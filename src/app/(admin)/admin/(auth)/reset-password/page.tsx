import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { createSessionClient } from "@/lib/supabase/server";
import { updatePassword } from "../../auth-actions";
import { AuthCard } from "../AuthCard";

export const metadata = { title: "Choose a new password" };

export default async function ResetPassword() {
  const db = await createSessionClient();
  const { data } = await db.auth.getUser();
  if (!data.user) redirect("/admin/login?error=link");
  return (
    <AuthCard title="Choose a password">
      <p className="small muted" style={{ textAlign: "center" }}>{data.user.email}</p>
      <ActionForm action={updatePassword}>
        <div className="field"><label htmlFor="password">New password</label><input id="password" name="password" type="password" minLength={10} autoComplete="new-password" required /><div className="hint">At least 10 characters.</div></div>
        <div className="field"><label htmlFor="confirm">Repeat password</label><input id="confirm" name="confirm" type="password" minLength={10} autoComplete="new-password" required /></div>
        <SubmitButton>Save password</SubmitButton>
      </ActionForm>
    </AuthCard>
  );
}
