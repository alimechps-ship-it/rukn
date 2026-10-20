"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSessionClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/components/admin/ActionForm";

async function origin() {
  const h = await headers();
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

function safeNext(v: FormDataEntryValue | null) {
  const s = String(v ?? "");
  return s.startsWith("/admin") && !s.startsWith("//") ? s : "/admin";
}

export async function signIn(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const email = String(fd.get("email") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return { ok: false, message: "Enter your e-mail and password." };
  const db = await createSessionClient();
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    return { ok: false, message: error.status === 429 ? "Too many attempts. Please wait and try again." : "Invalid e-mail or password." };
  }
  redirect(safeNext(fd.get("next")));
}

export async function signOut() {
  const db = await createSessionClient();
  await db.auth.signOut();
  redirect("/admin/login");
}

export async function requestPasswordReset(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const email = String(fd.get("email") ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, message: "Enter a valid e-mail address." };
  const db = await createSessionClient();
  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: `${await origin()}/admin/auth/confirm?next=/admin/reset-password`,
  });
  if (error && error.status === 429) return { ok: false, message: "Too many requests. Please wait a few minutes and try again." };
  // Same answer whether or not the account exists (no account enumeration).
  return { ok: true, message: "If an account exists for this address, a password reset link has been sent." };
}

export async function updatePassword(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const password = String(fd.get("password") ?? "");
  const confirm = String(fd.get("confirm") ?? "");
  if (password.length < 10) return { ok: false, message: "Use at least 10 characters." };
  if (password !== confirm) return { ok: false, message: "The passwords do not match." };
  const db = await createSessionClient();
  const { data } = await db.auth.getUser();
  if (!data.user) return { ok: false, message: "Your reset link has expired. Request a new one." };
  const { error } = await db.auth.updateUser({ password });
  if (error) return { ok: false, message: `Password could not be changed: ${error.message}` };
  return { ok: true, message: "Password updated.", redirectTo: "/admin" };
}
