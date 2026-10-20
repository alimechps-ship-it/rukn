"use server";

import { assertStaff, can } from "@/lib/auth";
import {
  allLanguages, bool, createSessionClient, errMessage, int, json, revalidateSite, safeHref, slugify, str,
} from "@/lib/admin";
import type { ActionResult } from "@/components/admin/ActionForm";

const SECTION_TYPES = ["hero", "rich_text", "cards", "steps", "benefits", "services_grid", "gallery", "faq", "cta", "team", "image_text", "contact_details", "inquiry_form", "notice"];
const TEMPLATES = ["home", "standard", "about", "partnerships", "contact", "legal", "case"];
type Table = "pages" | "content_sections" | "services" | "faqs" | "team_members" | "announcements";
const TRASHABLE: Table[] = ["pages", "content_sections", "services", "faqs", "team_members", "announcements"];

async function guard() {
  const user = await assertStaff(can.content);
  return { user, db: await createSessionClient() };
}
function fail(e: unknown): ActionResult {
  return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." };
}

// ======================================================================
// Pages
// ======================================================================
export async function createPage(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const { db, user } = await guard();
    const title = str(fd, "title", 160);
    const slug = slugify(str(fd, "slug", 80) ?? title ?? "");
    const template = String(fd.get("template") ?? "standard");
    if (!title || !slug) return { ok: false, message: "Title and URL slug are required." };
    if (!TEMPLATES.includes(template)) return { ok: false, message: "Unknown template." };
    const langs = await allLanguages(db);
    const def = langs.find((l) => l.is_default)?.code ?? "en";
    const { data, error } = await db.from("pages").insert({ key: slug, slug, template, status: "draft" }).select("id").single();
    if (error) return { ok: false, message: errMessage(error) };
    const { error: e2 } = await db.from("page_translations").insert({ page_id: data.id, locale: def, variant: "draft", title, updated_by: user.id });
    if (e2) return { ok: false, message: errMessage(e2) };
    return { ok: true, message: "Page created as a draft.", redirectTo: `/admin/pages/${data.id}` };
  } catch (e) { return fail(e); }
}

export async function savePage(pageId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const user = await assertStaff(can.translate);
    const db = await createSessionClient();
    const langs = await allLanguages(db);
    if (can.content(user)) {
      const slugRaw = str(fd, "slug", 80);
      const update: Record<string, unknown> = {
        show_in_sitemap: bool(fd, "show_in_sitemap"),
        needs_legal_review: bool(fd, "needs_legal_review"),
        og_image_media_id: str(fd, "og_image_media_id") || null,
      };
      if (fd.get("is_home") !== "1") {
        update.slug = slugify(slugRaw ?? "");
        if (!update.slug) return { ok: false, message: "URL slug is required." };
        if (update.slug === "services" && fd.get("current_slug") !== "services") return { ok: false, message: "The slug “services” is reserved." };
      }
      const { error } = await db.from("pages").update(update).eq("id", pageId);
      if (error) return { ok: false, message: errMessage(error) };
    }
    for (const l of langs) {
      if (!can.locale(user, l.code)) continue;
      const title = str(fd, `tr.${l.code}.title`, 160);
      if (!title) continue;
      const { error } = await db.from("page_translations").upsert({
        page_id: pageId, locale: l.code, variant: "draft", title,
        seo_title: str(fd, `tr.${l.code}.seo_title`, 120), seo_description: str(fd, `tr.${l.code}.seo_description`, 320), updated_by: user.id,
      });
      if (error) return { ok: false, message: errMessage(error) };
    }
    if (fd.get("intent") === "publish") {
      if (!can.content(user)) return { ok: false, message: "Only Content Managers can publish." };
      const { error } = await db.rpc("publish_page", { p_id: pageId });
      if (error) return { ok: false, message: errMessage(error, "Saved, but publishing failed") };
      revalidateSite();
      return { ok: true, message: "Saved and published. The public website has been updated." };
    }
    return { ok: true, message: "Draft saved. Publish to make it public." };
  } catch (e) { return fail(e); }
}

export async function setPageStatus(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const { db } = await guard();
    const id = String(fd.get("id"));
    const status = String(fd.get("status"));
    if (status === "published") {
      const { error } = await db.rpc("publish_page", { p_id: id });
      if (error) return { ok: false, message: errMessage(error) };
    } else {
      const { error } = await db.from("pages").update({ status: "draft" }).eq("id", id);
      if (error) return { ok: false, message: errMessage(error) };
    }
    revalidateSite();
    return { ok: true, message: status === "published" ? "Page published." : "Page unpublished." };
  } catch (e) { return fail(e); }
}

// ======================================================================
// Sections
// ======================================================================
export async function createSection(pageId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const { db, user } = await guard();
    const type = String(fd.get("type") ?? "");
    const heading = str(fd, "heading", 200);
    if (!SECTION_TYPES.includes(type)) return { ok: false, message: "Choose a section type." };
    const key = slugify(str(fd, "key", 60) ?? heading ?? type) || type;
    const { data: last } = await db.from("content_sections").select("sort_order").eq("page_id", pageId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await db.from("content_sections").insert({ page_id: pageId, key, type, status: "draft", sort_order: (last?.sort_order ?? 0) + 1 }).select("id").single();
    if (error) return { ok: false, message: errMessage(error) };
    const langs = await allLanguages(db);
    const def = langs.find((l) => l.is_default)?.code ?? "en";
    await db.from("content_section_translations").insert({ section_id: data.id, locale: def, variant: "draft", heading, updated_by: user.id });
    return { ok: true, message: "Section created as a draft.", redirectTo: `/admin/sections/${data.id}` };
  } catch (e) { return fail(e); }
}

export async function saveSection(sectionId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const user = await assertStaff(can.translate);
    const db = await createSessionClient();
    const langs = await allLanguages(db);
    if (can.content(user)) {
      const settings: Record<string, unknown> = {};
      if (fd.has("settings.form")) settings.form = ["contact", "case", "partnership"].includes(String(fd.get("settings.form"))) ? fd.get("settings.form") : "contact";
      if (fd.has("settings.layout")) settings.layout = fd.get("settings.layout") === "split" ? "split" : "full";
      if (fd.has("settings.topic")) settings.topic = slugify(String(fd.get("settings.topic"))) || "general";
      if (fd.has("settings.featured_only_present")) settings.featured_only = bool(fd, "settings.featured_only");
      if (fd.has("settings.compact_present")) settings.compact = bool(fd, "settings.compact");
      if (fd.has("settings.media_ids")) settings.media_ids = json<string[]>(fd, "settings.media_ids", []).filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 24);
      const { data: current } = await db.from("content_sections").select("settings").eq("id", sectionId).single();
      const { error } = await db.from("content_sections").update({
        key: slugify(str(fd, "key", 60) ?? "") || undefined,
        media_id: fd.has("media_id") ? str(fd, "media_id") || null : undefined,
        settings: { ...(current?.settings ?? {}), ...settings },
      }).eq("id", sectionId);
      if (error) return { ok: false, message: errMessage(error) };
    }
    for (const l of langs) {
      if (!can.locale(user, l.code) || !fd.has(`tr.${l.code}.present`)) continue;
      const p = (k: string, max = 8000) => str(fd, `tr.${l.code}.${k}`, max);
      const row = {
        section_id: sectionId, locale: l.code, variant: "draft" as const,
        eyebrow: p("eyebrow", 120), heading: p("heading", 200), subheading: p("subheading", 400), body: p("body", 8000),
        items: json<{ title?: string; text?: string }[]>(fd, `tr.${l.code}.items`, []).slice(0, 30).map((i) => ({ title: String(i.title ?? "").slice(0, 200), text: String(i.text ?? "").slice(0, 1000) })),
        primary_label: p("primary_label", 80), primary_href: safeHref(p("primary_href", 300)),
        secondary_label: p("secondary_label", 80), secondary_href: safeHref(p("secondary_href", 300)),
        updated_by: user.id,
      };
      const empty = !row.eyebrow && !row.heading && !row.subheading && !row.body && !row.items.length && !row.primary_label;
      if (empty) {
        // Clearing every field removes this language's draft (visitors then see the default language).
        if (can.content(user)) await db.from("content_section_translations").delete().eq("section_id", sectionId).eq("locale", l.code).eq("variant", "draft");
        continue;
      }
      const { error } = await db.from("content_section_translations").upsert(row);
      if (error) return { ok: false, message: `${l.name}: ${errMessage(error)}` };
    }
    if (fd.get("intent") === "publish") {
      if (!can.content(user)) return { ok: false, message: "Draft saved. Only Content Managers can publish." };
      const { error } = await db.rpc("publish_section", { p_id: sectionId });
      if (error) return { ok: false, message: errMessage(error, "Saved, but publishing failed") };
      revalidateSite();
      return { ok: true, message: "Saved and published. The public website has been updated." };
    }
    return { ok: true, message: "Draft saved. Use Preview to check it, then Publish." };
  } catch (e) { return fail(e); }
}

export async function setSectionStatus(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const { db } = await guard();
    const id = String(fd.get("id"));
    if (fd.get("status") === "published") {
      const { error } = await db.rpc("publish_section", { p_id: id });
      if (error) return { ok: false, message: errMessage(error) };
    } else {
      const { error } = await db.from("content_sections").update({ status: "draft" }).eq("id", id);
      if (error) return { ok: false, message: errMessage(error) };
    }
    revalidateSite();
    return { ok: true, message: fd.get("status") === "published" ? "Published." : "Unpublished." };
  } catch (e) { return fail(e); }
}

export async function discardDraft(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const { db, user } = await guard();
    const id = String(fd.get("id"));
    const kind = String(fd.get("kind"));
    const table = kind === "service" ? "service_translations" : "content_section_translations";
    const fk = kind === "service" ? "service_id" : "section_id";
    const { data: pub } = await db.from(table).select("*").eq(fk, id).eq("variant", "published");
    if (!pub?.length) return { ok: false, message: "Nothing has been published yet, so there is nothing to revert to." };
    await db.from(table).delete().eq(fk, id).eq("variant", "draft");
    const { error } = await db.from(table).insert(pub.map((r) => ({ ...r, variant: "draft", updated_at: undefined, updated_by: user.id })));
    if (error) return { ok: false, message: errMessage(error) };
    return { ok: true, message: "Draft changes discarded — the draft now matches the published version." };
  } catch (e) { return fail(e); }
}

// ======================================================================
// Ordering, trash, restore, permanent delete (shared)
// ======================================================================
export async function move(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const { db } = await guard();
    const table = String(fd.get("table"));
    const id = String(fd.get("id"));
    const dir = fd.get("dir") === "up" ? -1 : 1;
    const scope = fd.get("scope") ? String(fd.get("scope")) : null;
    const scopeVal = fd.get("scopeVal") ? String(fd.get("scopeVal")) : null;
    if (!["content_sections", "services", "faqs", "team_members", "navigation_items", "announcements", "pages"].includes(table)) return { ok: false, message: "Invalid table." };
    if (scope && !["page_id", "location", "topic"].includes(scope)) return { ok: false, message: "Invalid scope." };
    let q = db.from(table).select("id,sort_order").order("sort_order").order("created_at");
    if (scope && scopeVal) q = q.eq(scope, scopeVal);
    if (table !== "navigation_items") q = q.is("deleted_at", null);
    const { data, error } = await q;
    if (error || !data) return { ok: false, message: errMessage(error) };
    const idx = data.findIndex((r) => r.id === id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= data.length) return { ok: true, message: "Already at the edge." };
    const order = [...data];
    [order[idx], order[j]] = [order[j], order[idx]];
    for (let i = 0; i < order.length; i++) {
      if (order[i].sort_order !== i + 1) {
        const { error: e } = await db.from(table).update({ sort_order: i + 1 }).eq("id", order[i].id);
        if (e) return { ok: false, message: errMessage(e) };
      }
    }
    revalidateSite();
    return { ok: true, message: "Order updated." };
  } catch (e) { return fail(e); }
}

export async function trash(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const { db } = await guard();
    const table = String(fd.get("table")) as Table;
    if (!TRASHABLE.includes(table)) return { ok: false, message: "Invalid table." };
    if (table === "pages") {
      const { data } = await db.from("pages").select("key").eq("id", String(fd.get("id"))).single();
      if (data?.key === "home") return { ok: false, message: "The home page cannot be deleted. Edit or unpublish its sections instead." };
    }
    const { error } = await db.from(table).update({ deleted_at: new Date().toISOString() }).eq("id", String(fd.get("id")));
    if (error) return { ok: false, message: errMessage(error) };
    revalidateSite();
    return { ok: true, message: "Moved to Trash. You can restore it from the Trash page.", redirectTo: fd.get("redirect") ? String(fd.get("redirect")) : undefined };
  } catch (e) { return fail(e); }
}

export async function restore(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const { db } = await guard();
    const table = String(fd.get("table")) as Table;
    if (!TRASHABLE.includes(table)) return { ok: false, message: "Invalid table." };
    const { error } = await db.from(table).update({ deleted_at: null }).eq("id", String(fd.get("id")));
    if (error) return { ok: false, message: errMessage(error) };
    revalidateSite();
    return { ok: true, message: "Restored." };
  } catch (e) { return fail(e); }
}

export async function destroy(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const { db } = await guard();
    const table = String(fd.get("table")) as Table;
    if (!TRASHABLE.includes(table)) return { ok: false, message: "Invalid table." };
    const { data, error } = await db.from(table).delete().eq("id", String(fd.get("id"))).not("deleted_at", "is", null).select("id");
    if (error) return { ok: false, message: errMessage(error) };
    if (!data?.length) return { ok: false, message: "Only items in the Trash can be deleted permanently." };
    revalidateSite();
    return { ok: true, message: "Deleted permanently." };
  } catch (e) { return fail(e); }
}

export async function setStatus(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const { db } = await guard();
    const table = String(fd.get("table"));
    const status = String(fd.get("status"));
    if (!["faqs", "team_members", "announcements"].includes(table)) return { ok: false, message: "Invalid table." };
    if (!["draft", "published", "archived"].includes(status)) return { ok: false, message: "Invalid status." };
    const { error } = await db.from(table).update({ status }).eq("id", String(fd.get("id")));
    if (error) return { ok: false, message: errMessage(error) };
    revalidateSite();
    return { ok: true, message: status === "published" ? "Published." : "Unpublished." };
  } catch (e) { return fail(e); }
}

export async function setSortValue(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const { db } = await guard();
    const table = String(fd.get("table"));
    if (!["content_sections", "services", "faqs", "team_members", "navigation_items", "announcements"].includes(table)) return { ok: false, message: "Invalid table." };
    const { error } = await db.from(table).update({ sort_order: int(fd, "sort_order") }).eq("id", String(fd.get("id")));
    if (error) return { ok: false, message: errMessage(error) };
    revalidateSite();
    return { ok: true, message: "Saved." };
  } catch (e) { return fail(e); }
}
