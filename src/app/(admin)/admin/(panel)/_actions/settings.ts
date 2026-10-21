"use server";

import { headers } from "next/headers";
import { assertStaff, can } from "@/lib/auth";
import { allLanguages, bool, createSessionClient, errMessage, int, revalidateSite, str } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase/service";
import type { ActionResult } from "@/components/admin/ActionForm";
import type { AppRole } from "@/lib/types";

function fail(e: unknown): ActionResult { return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." }; }
const HEX = /^#[0-9a-fA-F]{6}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ROLES: AppRole[] = ["super_admin", "content_manager", "sales_manager", "translator"];

// ---- Site settings ------------------------------------------------------------
export async function saveGeneralSettings(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.admin);
    const db = await createSessionClient();
    const email = str(fd, "contact_email", 200);
    if (email && !EMAIL.test(email)) return { ok: false, message: "Contact e-mail is not valid." };
    const wa = (str(fd, "whatsapp_number", 20) ?? "").replace(/[\s()-]/g, "") || null;
    if (wa && !/^\+[1-9][0-9]{6,14}$/.test(wa)) return { ok: false, message: "WhatsApp number must be in international format, e.g. +201001234567." };
    const siteUrl = str(fd, "site_url", 200);
    if (siteUrl && !/^https?:\/\/[^\s/]+$/.test(siteUrl.replace(/\/$/, ""))) return { ok: false, message: "Site URL must look like https://www.example.com (no path)." };
    const social: { network: string; url: string }[] = [];
    for (const line of (str(fd, "social_links", 4000) ?? "").split("\n")) {
      let [network, url] = line.split("|").map((x) => x?.trim());
      if (!network && !url) continue;
      // A bare link is accepted too: the name is taken from the website address.
      if (!url && /^https?:\/\//i.test(network ?? "")) {
        url = network.replace(/^http:\/\//i, "https://");
        const host = new URL(url).hostname.replace(/^(www|m)\./, "");
        const known: Record<string, string> = { "facebook.com": "Facebook", "fb.com": "Facebook", "instagram.com": "Instagram", "linkedin.com": "LinkedIn", "x.com": "X", "twitter.com": "X", "youtube.com": "YouTube", "tiktok.com": "TikTok", "wa.me": "WhatsApp" };
        network = known[host] ?? host.split(".")[0].replace(/^./, (c) => c.toUpperCase());
      }
      if (!network || !url || !/^https:\/\//.test(url)) return { ok: false, message: `Social link “${line}” must be written as Name | https://…` };
      social.push({ network: network.slice(0, 40), url: url.slice(0, 300) });
    }
    const colors: Record<string, string> = {};
    for (const k of ["navy", "teal", "white", "light", "text"]) {
      const v = str(fd, `color_${k}`, 7);
      if (v && !HEX.test(v)) return { ok: false, message: `Colour “${k}” must be a hex value like #10263D.` };
      if (v) colors[k] = v.toUpperCase();
    }
    const provider = String(fd.get("analytics_provider") ?? "");
    const analyticsId = str(fd, "analytics_id", 80);
    if (analyticsId && !/^[A-Za-z0-9._-]{3,80}$/.test(analyticsId)) return { ok: false, message: "Analytics ID contains invalid characters." };
    const country = (str(fd, "country_code", 2) ?? "EG").toUpperCase();
    const { error } = await db.from("site_settings").update({
      site_name: str(fd, "site_name", 80) ?? "RUKN",
      site_url: siteUrl ? siteUrl.replace(/\/$/, "") : null,
      country_code: /^[A-Z]{2}$/.test(country) ? country : "EG",
      logo_media_id: str(fd, "logo_media_id") || null,
      contact_email: email,
      whatsapp_number: wa,
      social_links: social,
      brand_colors: colors,
      analytics_provider: provider === "plausible" || provider === "ga4" ? provider : null,
      analytics_id: provider ? analyticsId : null,
      cookie_consent_enabled: bool(fd, "cookie_consent_enabled"),
      maintenance_mode: bool(fd, "maintenance_mode"),
    }).eq("id", 1);
    if (error) return { ok: false, message: errMessage(error) };
    revalidateSite();
    return { ok: true, message: "Settings saved. The website has been updated." };
  } catch (e) { return fail(e); }
}

export async function saveSiteTexts(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const user = await assertStaff(can.translate);
    const db = await createSessionClient();
    const fields: Record<string, number> = {
      tagline: 200, location_text: 200, business_hours: 400, footer_text: 600, case_submission_instructions: 2000,
      default_seo_title: 120, default_seo_description: 320, cookie_banner_text: 600, maintenance_message: 600,
    };
    for (const l of await allLanguages(db)) {
      if (!can.locale(user, l.code) || !fd.has(`tr.${l.code}.present`)) continue;
      const row: Record<string, unknown> = { locale: l.code };
      for (const [f, max] of Object.entries(fields)) row[f] = str(fd, `tr.${l.code}.${f}`, max);
      const { error } = await db.from("site_settings_translations").upsert(row);
      if (error) return { ok: false, message: `${l.name}: ${errMessage(error)}` };
    }
    revalidateSite();
    return { ok: true, message: "Site texts saved." };
  } catch (e) { return fail(e); }
}

export async function saveNotifications(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.admin);
    const db = await createSessionClient();
    const emails = (str(fd, "notification_emails", 2000) ?? "").split(/[\s,;]+/).filter(Boolean);
    const bad = emails.find((e) => !EMAIL.test(e));
    if (bad) return { ok: false, message: `“${bad}” is not a valid e-mail address.` };
    const types = ["contact", "case", "partnership"].filter((t) => bool(fd, `type_${t}`));
    const { error } = await db.from("private_settings").upsert({ id: 1, notifications_enabled: bool(fd, "notifications_enabled"), notification_emails: emails.slice(0, 10), notify_on_types: types });
    if (error) return { ok: false, message: errMessage(error) };
    const configured = Boolean(process.env.RESEND_API_KEY && process.env.NOTIFICATION_FROM_EMAIL && process.env.SUPABASE_SERVICE_ROLE_KEY);
    return { ok: true, message: configured ? "Notification settings saved." : "Saved — but e-mails will only be sent after RESEND_API_KEY, NOTIFICATION_FROM_EMAIL and SUPABASE_SERVICE_ROLE_KEY are set on the server." };
  } catch (e) { return fail(e); }
}

// ---- Languages ----------------------------------------------------------------
export async function addLanguage(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.admin);
    const db = await createSessionClient();
    const code = String(fd.get("code") ?? "").trim();
    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(code)) return { ok: false, message: "Use an ISO language code such as fr, de or pt-BR." };
    const { error } = await db.from("languages").insert({
      code, name: str(fd, "name", 60) ?? code, native_name: str(fd, "native_name", 60) ?? code,
      dir: fd.get("dir") === "rtl" ? "rtl" : "ltr", enabled: false, is_default: false, sort_order: 50,
    });
    if (error) return { ok: false, message: errMessage(error) };
    return { ok: true, message: `Language added (disabled). Translate the content, then enable it.` };
  } catch (e) { return fail(e); }
}

export async function updateLanguage(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.admin);
    const db = await createSessionClient();
    const code = String(fd.get("code"));
    const makeDefault = bool(fd, "is_default");
    const enabled = bool(fd, "enabled");
    if (makeDefault && !enabled) return { ok: false, message: "The default language must be enabled." };
    const langs = await allLanguages(db);
    const current = langs.find((l) => l.code === code);
    if (!current) return { ok: false, message: "Language not found." };
    if (current.is_default && !enabled) return { ok: false, message: "You cannot disable the default language. Make another language the default first." };
    if (makeDefault && !current.is_default) {
      const { error } = await db.from("languages").update({ is_default: false }).eq("is_default", true);
      if (error) return { ok: false, message: errMessage(error) };
    }
    const { error } = await db.from("languages").update({ enabled, is_default: makeDefault || current.is_default, sort_order: int(fd, "sort_order", current.sort_order), name: str(fd, "name", 60) ?? current.name, native_name: str(fd, "native_name", 60) ?? current.native_name }).eq("code", code);
    if (error) return { ok: false, message: errMessage(error) };
    revalidateSite();
    return { ok: true, message: "Language updated." };
  } catch (e) { return fail(e); }
}

// ---- Users ----------------------------------------------------------------------
async function origin() {
  const h = await headers();
  const env = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (env) return env;
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

function parseRoles(fd: FormData) {
  return ROLES.filter((r) => bool(fd, `role_${r}`));
}
async function parseLocales(fd: FormData) {
  const db = await createSessionClient();
  return (await allLanguages(db)).map((l) => l.code).filter((c) => bool(fd, `locale_${c}`));
}

export async function inviteUser(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const admin = await assertStaff(can.admin);
    const svc = createServiceClient();
    if (!svc) return { ok: false, message: "Invitations need SUPABASE_SERVICE_ROLE_KEY on the server. Alternatively invite the user from the Supabase dashboard (Authentication → Users → Invite), then assign roles here." };
    const email = (str(fd, "email", 200) ?? "").toLowerCase();
    if (!EMAIL.test(email)) return { ok: false, message: "Enter a valid e-mail address." };
    const roles = parseRoles(fd);
    if (!roles.length) return { ok: false, message: "Select at least one role." };
    const { data, error } = await svc.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${await origin()}/admin/auth/confirm?next=/admin/reset-password`,
      data: { full_name: str(fd, "full_name", 120) ?? "" },
    });
    if (error || !data.user) return { ok: false, message: `Invitation failed: ${error?.message ?? "unknown error"}` };
    const db = await createSessionClient();
    await db.from("profiles").update({ full_name: str(fd, "full_name", 120), allowed_locales: await parseLocales(fd) }).eq("id", data.user.id);
    const { error: rErr } = await db.from("user_roles").insert(roles.map((role) => ({ user_id: data.user!.id, role, created_by: admin.id })));
    if (rErr) return { ok: false, message: `User invited, but roles could not be saved: ${errMessage(rErr)}` };
    return { ok: true, message: `Invitation e-mail sent to ${email}.` };
  } catch (e) { return fail(e); }
}

export async function updateUserAccess(userId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const admin = await assertStaff(can.admin);
    const db = await createSessionClient();
    const roles = parseRoles(fd);
    const { data: current } = await db.from("user_roles").select("role").eq("user_id", userId);
    const have = (current ?? []).map((r) => r.role as AppRole);
    const add = roles.filter((r) => !have.includes(r));
    const remove = have.filter((r) => !roles.includes(r));
    const { error: pErr } = await db.from("profiles").update({ full_name: str(fd, "full_name", 120), is_active: bool(fd, "is_active"), allowed_locales: await parseLocales(fd) }).eq("id", userId);
    if (pErr) return { ok: false, message: pErr.message.includes("Super Administrator") ? "At least one active Super Administrator is required." : errMessage(pErr) };
    if (add.length) {
      const { error } = await db.from("user_roles").insert(add.map((role) => ({ user_id: userId, role, created_by: admin.id })));
      if (error) return { ok: false, message: errMessage(error) };
    }
    if (remove.length) {
      const { error } = await db.from("user_roles").delete().eq("user_id", userId).in("role", remove);
      if (error) return { ok: false, message: error.message.includes("Super Administrator") ? "At least one active Super Administrator is required." : errMessage(error) };
    }
    return { ok: true, message: "Access updated." };
  } catch (e) { return fail(e); }
}

export async function sendPasswordReset(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.admin);
    const db = await createSessionClient();
    const email = String(fd.get("email") ?? "");
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: `${await origin()}/admin/auth/confirm?next=/admin/reset-password` });
    if (error) return { ok: false, message: `Could not send reset e-mail: ${error.message}` };
    return { ok: true, message: `Password reset e-mail sent to ${email}.` };
  } catch (e) { return fail(e); }
}

export async function removeUser(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const admin = await assertStaff(can.admin);
    const id = String(fd.get("id"));
    if (id === admin.id) return { ok: false, message: "You cannot remove your own account." };
    const svc = createServiceClient();
    if (!svc) return { ok: false, message: "Removing accounts needs SUPABASE_SERVICE_ROLE_KEY. You can deactivate the user instead, or delete them in the Supabase dashboard." };
    const { error } = await svc.auth.admin.deleteUser(id);
    if (error) return { ok: false, message: error.message.includes("Super Administrator") ? "At least one active Super Administrator is required." : `Could not remove user: ${error.message}` };
    return { ok: true, message: "User removed." };
  } catch (e) { return fail(e); }
}

// ---- Own account ------------------------------------------------------------------
export async function updateOwnAccount(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const me = await assertStaff(can.staff);
    const db = await createSessionClient();
    const { error } = await db.from("profiles").update({ full_name: str(fd, "full_name", 120) }).eq("id", me.id);
    if (error) return { ok: false, message: errMessage(error) };
    const password = String(fd.get("password") ?? "");
    if (password) {
      if (password.length < 10) return { ok: false, message: "Name saved. Password must be at least 10 characters." };
      if (password !== String(fd.get("confirm") ?? "")) return { ok: false, message: "Name saved. The passwords do not match." };
      const { error: pErr } = await db.auth.updateUser({ password });
      if (pErr) return { ok: false, message: `Name saved. Password not changed: ${pErr.message}` };
      return { ok: true, message: "Profile and password updated." };
    }
    return { ok: true, message: "Profile updated." };
  } catch (e) { return fail(e); }
}

// ---- Starter images ------------------------------------------------------------
export async function importStarterImages(_: ActionResult, _fd: FormData): Promise<ActionResult> {
  try {
    const admin = await assertStaff(can.admin);
    const db = await createSessionClient();
    const { importStarterMedia } = await import("@/lib/starter-media");
    const r = await importStarterMedia(db as never, admin.id);
    revalidateSite();
    const base = `Done: ${r.imported} image(s) imported, ${r.reused} already in the library. Images are attached to the logo, services and home page.`;
    return { ok: r.warnings.length === 0, message: r.warnings.length ? `${base} Warnings: ${r.warnings.join(" | ")}` : base };
  } catch (e) { return fail(e); }
}
