import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { requestPasswordReset } from "../../auth-actions";
import { AuthCard } from "../AuthCard";

export const metadata = { title: "Reset password" };

export default function Forgot() {
  return (
    <AuthCard title="Reset your password">
      <ActionForm action={requestPasswordReset} resetOnSuccess>
        <div className="field"><label htmlFor="email">E-mail</label><input id="email" name="email" type="email" autoComplete="username" required /></div>
        <SubmitButton pendingText="Sending…">Send reset link</SubmitButton>
      </ActionForm>
      <p className="small" style={{ textAlign: "center", marginTop: 16 }}><Link href="/admin/login">Back to sign-in</Link></p>
    </AuthCard>
  );
}
