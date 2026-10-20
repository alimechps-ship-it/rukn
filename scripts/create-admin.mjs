#!/usr/bin/env node
/**
 * Creates the FIRST Super Administrator (there is no public sign-up).
 *
 *   node scripts/create-admin.mjs owner@example.com            → sends an invitation e-mail
 *   INITIAL_ADMIN_PASSWORD='…' node scripts/create-admin.mjs owner@example.com
 *                                                              → creates the user with that password
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server secret — never commit it).
 * Run it from a trusted machine only.
 */
import "./_env.mjs";
import { requireEnv } from "./_env.mjs";
import { createClient } from "@supabase/supabase-js";

requireEnv("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("Usage: node scripts/create-admin.mjs <email>");
  process.exit(1);
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const site = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
const password = process.env.INITIAL_ADMIN_PASSWORD;

let userId;
const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
const existing = list?.users?.find((u) => u.email?.toLowerCase() === email);
if (existing) {
  userId = existing.id;
  console.log(`User ${email} already exists.`);
} else if (password) {
  if (password.length < 10) { console.error("INITIAL_ADMIN_PASSWORD must be at least 10 characters."); process.exit(1); }
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) { console.error("Could not create user:", error.message); process.exit(1); }
  userId = data.user.id;
  console.log(`Created ${email} with the supplied password.`);
} else {
  const { data, error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo: `${site}/admin/auth/confirm?next=/admin/reset-password` });
  if (error) { console.error("Invitation failed:", error.message); process.exit(1); }
  userId = data.user.id;
  console.log(`Invitation e-mail sent to ${email}.`);
}

const { error: rpcErr } = await db.rpc("bootstrap_super_admin", { p_email: email });
if (rpcErr) { console.error("Could not grant Super Administrator:", rpcErr.message); process.exit(1); }
console.log(`✔ ${email} (${userId}) is now a Super Administrator. Sign in at ${site}/admin/login`);
