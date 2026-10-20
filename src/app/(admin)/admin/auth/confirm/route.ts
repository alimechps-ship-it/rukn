import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSessionClient } from "@/lib/supabase/server";

/** Handles e-mail links (invite / recovery) using either token_hash (OTP) or PKCE code. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const next = sp.get("next")?.startsWith("/admin") ? sp.get("next")! : "/admin";
  const db = await createSessionClient();
  const tokenHash = sp.get("token_hash");
  const type = sp.get("type") as EmailOtpType | null;
  const code = sp.get("code");
  let ok = false;
  if (tokenHash && type) ok = !(await db.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  else if (code) ok = !(await db.auth.exchangeCodeForSession(code)).error;
  if (!ok) {
    // Links sent by the admin API use the implicit flow (tokens in the URL fragment).
    return NextResponse.redirect(new URL(`/admin/auth/callback?next=${encodeURIComponent(next)}`, req.url));
  }
  return NextResponse.redirect(new URL(next, req.url));
}
