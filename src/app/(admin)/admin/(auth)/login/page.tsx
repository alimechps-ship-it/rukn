import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { isSupabaseConfigured } from "@/lib/env";
import { signIn } from "../../auth-actions";
import { AuthCard } from "../AuthCard";

export const metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <AuthCard title="Administrator sign-in">
      {!isSupabaseConfigured() ? <div className="flash err">Supabase is not configured. See README → Environment variables.</div> : null}
      {sp.error ? <div className="flash err">{sp.error === "link" ? "This link is invalid or has expired. Request a new one." : "Sign-in failed."}</div> : null}
      <ActionForm action={signIn}>
        <input type="hidden" name="next" value={sp.next ?? "/admin"} />
        <div className="field"><label htmlFor="email">E-mail</label><input id="email" name="email" type="email" autoComplete="username" required /></div>
        <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
        <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>
      </ActionForm>
      <p className="small muted" style={{ textAlign: "center", marginTop: 16 }}>
        <Link href="/admin/forgot-password">Forgot your password?</Link>
        <br />Accounts are created by invitation only.
      </p>
    </AuthCard>
  );
}
