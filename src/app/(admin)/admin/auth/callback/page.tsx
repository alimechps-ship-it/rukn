"use client";

import { useEffect, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

/** Completes invite / recovery links that carry tokens in the URL fragment. */
export default function AuthCallback() {
  const [msg, setMsg] = useState("Completing sign-in…");
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const next = new URLSearchParams(window.location.search).get("next") ?? "/admin";
    const safe = next.startsWith("/admin") ? next : "/admin";
    const access_token = hash.get("access_token");
    const refresh_token = hash.get("refresh_token");
    if (hash.get("error")) { setMsg(hash.get("error_description") ?? "This link is invalid or has expired."); return; }
    if (!access_token || !refresh_token) { window.location.replace("/admin/login?error=link"); return; }
    createBrowserSupabase().auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      if (error) setMsg("This link is invalid or has expired. Request a new one.");
      else window.location.replace(hash.get("type") === "invite" || hash.get("type") === "recovery" ? "/admin/reset-password" : safe);
    });
  }, []);
  return <main className="auth-page"><div className="auth-card"><p style={{ textAlign: "center" }}>{msg}</p></div></main>;
}
