"use server";

import { assertStaff, can } from "@/lib/auth";
import { allLanguages, bool, createSessionClient, errMessage, revalidateSite, safeHref, slugify, str } from "@/lib/admin";
import type { ActionResult } from "@/components/admin/ActionForm";

function fail(e: unknown): ActionResult {
  return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." };
}
const STATUSES = ["draft", "published", "archived"];
async function nextOrder(db: Awaited<ReturnType<typeof createSessionClient>>, table: string) {
  const { data } = await db.from(table).select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
  return ((data as { sort_order?: number } | null)?.sort_order ?? 0) + 1;
}

/** Upserts one translation row per permitted language; skips languages left empty. */
async function saveTranslations(
  table: string, fk: string, id: string, fd: FormData, fields: Record<string, number>, required: string[],
): Promise<string | null> {
  const user = await assertStaff(can.translate);
  const db = await createSessionClient();
  for (const l of await allLanguages(db)) {
    if (!can.locale(user, l.code) || !fd.has(`tr.${l.code}.present`)) continue;
    const row: Record<string, unknown> = { [fk]: id, locale: l.code };
    for (const [f, max] of Object.entries(fields)) row[f] = str(fd, `tr.${l.code}.${f}`, max);
    if (required.some((f) => !row[f])) {
      if (Object.keys(fields).every((f) => !row[f]) && can.content(user)) await db.from(table).delete().eq(fk, id).eq("locale", l.code);
      continue;
    }
    const { error } = await db.from(table).upsert(row);
    if (error) return `${l.name}: ${errMessage(error)}`;
  }
  return null;
}

// ---- FAQs ---------------------------------------------------------------
export async function createFaq(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.content);
    const db = await createSessionClient();
    const question = str(fd, "question", 300);
    const answer = str(fd, "answer", 3000);
    if (!question || !answer) return { ok: false, message: "Question and answer are required." };
    const def = (await allLanguages(db)).find((l) => l.is_default)?.code ?? "en";
    const { data, error } = await db.from("faqs").insert({ topic: slugify(str(fd, "topic") ?? "general") || "general", status: "draft", sort_order: await nextOrder(db, "faqs") }).select("id").single();
    if (error) return { ok: false, message: errMessage(error) };
    const { error: e2 } = await db.from("faq_translations").insert({ faq_id: data.id, locale: def, question, answer });
    if (e2) return { ok: false, message: errMessage(e2) };
    return { ok: true, message: "FAQ created as a draft. Add other languages, then publish.", redirectTo: `/admin/faqs/${data.id}` };
  } catch (e) { return fail(e); }
}

export async function saveFaq(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const user = await assertStaff(can.translate);
    const db = await createSessionClient();
    if (can.content(user)) {
      const status = String(fd.get("status"));
      const { error } = await db.from("faqs").update({ topic: slugify(str(fd, "topic") ?? "general") || "general", status: STATUSES.includes(status) ? status : "draft" }).eq("id", id);
      if (error) return { ok: false, message: errMessage(error) };
    }
    const err = await saveTranslations("faq_translations", "faq_id", id, fd, { question: 300, answer: 3000 }, ["question", "answer"]);
    if (err) return { ok: false, message: err };
    revalidateSite();
    return { ok: true, message: "FAQ saved." };
  } catch (e) { return fail(e); }
}

// ---- Team ---------------------------------------------------------------
export async function createTeamMember(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.content);
    const db = await createSessionClient();
    const name = str(fd, "name", 120);
    if (!name) return { ok: false, message: "Name is required." };
    const def = (await allLanguages(db)).find((l) => l.is_default)?.code ?? "en";
    const { data, error } = await db.from("team_members").insert({ status: "draft", sort_order: await nextOrder(db, "team_members") }).select("id").single();
    if (error) return { ok: false, message: errMessage(error) };
    const { error: e2 } = await db.from("team_member_translations").insert({ member_id: data.id, locale: def, name });
    if (e2) return { ok: false, message: errMessage(e2) };
    return { ok: true, message: "Team profile created as a draft.", redirectTo: `/admin/team/${data.id}` };
  } catch (e) { return fail(e); }
}

export async function saveTeamMember(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const user = await assertStaff(can.translate);
    const db = await createSessionClient();
    if (can.content(user)) {
      const linkedin = str(fd, "linkedin_url", 300);
      if (linkedin && !/^https:\/\//.test(linkedin)) return { ok: false, message: "LinkedIn URL must start with https://" };
      const status = String(fd.get("status"));
      const { error } = await db.from("team_members").update({ linkedin_url: linkedin, photo_media_id: str(fd, "photo_media_id") || null, status: STATUSES.includes(status) ? status : "draft" }).eq("id", id);
      if (error) return { ok: false, message: errMessage(error) };
    }
    const err = await saveTranslations("team_member_translations", "member_id", id, fd, { name: 120, role_title: 120, bio: 1500 }, ["name"]);
    if (err) return { ok: false, message: err };
    revalidateSite();
    return { ok: true, message: "Team profile saved." };
  } catch (e) { return fail(e); }
}

// ---- Announcements ------------------------------------------------------
export async function createAnnouncement(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.content);
    const db = await createSessionClient();
    const text = str(fd, "text", 300);
    if (!text) return { ok: false, message: "Text is required." };
    const def = (await allLanguages(db)).find((l) => l.is_default)?.code ?? "en";
    const { data, error } = await db.from("announcements").insert({ status: "draft", sort_order: await nextOrder(db, "announcements") }).select("id").single();
    if (error) return { ok: false, message: errMessage(error) };
    const { error: e2 } = await db.from("announcement_translations").insert({ announcement_id: data.id, locale: def, text });
    if (e2) return { ok: false, message: errMessage(e2) };
    return { ok: true, message: "Announcement created as a draft.", redirectTo: `/admin/announcements/${data.id}` };
  } catch (e) { return fail(e); }
}

export async function saveAnnouncement(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const user = await assertStaff(can.translate);
    const db = await createSessionClient();
    if (can.content(user)) {
      const starts = str(fd, "starts_at");
      const ends = str(fd, "ends_at");
      const status = String(fd.get("status"));
      const { error } = await db.from("announcements").update({
        href: safeHref(str(fd, "href", 300)),
        starts_at: starts ? new Date(starts).toISOString() : null,
        ends_at: ends ? new Date(ends).toISOString() : null,
        status: STATUSES.includes(status) ? status : "draft",
      }).eq("id", id);
      if (error) return { ok: false, message: errMessage(error) };
    }
    const err = await saveTranslations("announcement_translations", "announcement_id", id, fd, { text: 300, link_label: 60 }, ["text"]);
    if (err) return { ok: false, message: err };
    revalidateSite();
    return { ok: true, message: "Announcement saved." };
  } catch (e) { return fail(e); }
}

// ---- Navigation -----------------------------------------------------------
export async function createNavItem(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.content);
    const db = await createSessionClient();
    const location = String(fd.get("location"));
    const href = safeHref(str(fd, "href", 300));
    const label = str(fd, "label", 80);
    if (!["header", "footer", "footer_legal"].includes(location)) return { ok: false, message: "Choose a location." };
    if (!href || !label) return { ok: false, message: "A label and a valid link (/path or https://…) are required." };
    const def = (await allLanguages(db)).find((l) => l.is_default)?.code ?? "en";
    const { data: last } = await db.from("navigation_items").select("sort_order").eq("location", location).order("sort_order", { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await db.from("navigation_items").insert({ location, href, is_external: /^https?:/i.test(href), sort_order: (last?.sort_order ?? 0) + 1 }).select("id").single();
    if (error) return { ok: false, message: errMessage(error) };
    const { error: e2 } = await db.from("navigation_item_translations").insert({ item_id: data.id, locale: def, label });
    if (e2) return { ok: false, message: errMessage(e2) };
    revalidateSite();
    return { ok: true, message: "Link added. Add the other language labels below." };
  } catch (e) { return fail(e); }
}

export async function saveNavItem(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const user = await assertStaff(can.translate);
    const db = await createSessionClient();
    if (can.content(user)) {
      const href = safeHref(str(fd, "href", 300));
      if (!href) return { ok: false, message: "Enter a valid link (/path or https://…)." };
      const { error } = await db.from("navigation_items").update({ href, is_visible: bool(fd, "is_visible"), is_external: /^https?:/i.test(href) }).eq("id", id);
      if (error) return { ok: false, message: errMessage(error) };
    }
    const err = await saveTranslations("navigation_item_translations", "item_id", id, fd, { label: 80 }, ["label"]);
    if (err) return { ok: false, message: err };
    revalidateSite();
    return { ok: true, message: "Saved." };
  } catch (e) { return fail(e); }
}

export async function deleteNavItem(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.content);
    const db = await createSessionClient();
    const { error } = await db.from("navigation_items").delete().eq("id", String(fd.get("id")));
    if (error) return { ok: false, message: errMessage(error) };
    revalidateSite();
    return { ok: true, message: "Link deleted." };
  } catch (e) { return fail(e); }
}

// ---- Interface strings ------------------------------------------------------
export async function saveString(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const user = await assertStaff(can.translate);
    const db = await createSessionClient();
    const key = String(fd.get("key") ?? "");
    if (!/^[a-z0-9_.]{2,80}$/.test(key)) return { ok: false, message: "Invalid key." };
    for (const l of await allLanguages(db)) {
      if (!can.locale(user, l.code) || !fd.has(`v.${l.code}`)) continue;
      const value = str(fd, `v.${l.code}`, 2000);
      if (!value) continue;
      const { error } = await db.from("translations").upsert({ namespace: "ui", key, locale: l.code, value, updated_by: user.id }, { onConflict: "namespace,key,locale" });
      if (error) return { ok: false, message: `${l.name}: ${errMessage(error)}` };
    }
    revalidateSite();
    return { ok: true, message: `Saved “${key}”.` };
  } catch (e) { return fail(e); }
}
