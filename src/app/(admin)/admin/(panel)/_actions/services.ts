"use server";

import { assertStaff, can } from "@/lib/auth";
import { allLanguages, bool, createSessionClient, errMessage, int, json, lines, revalidateSite, safeHref, slugify, str } from "@/lib/admin";
import type { ActionResult } from "@/components/admin/ActionForm";

function fail(e: unknown): ActionResult {
  return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." };
}

export async function createService(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const user = await assertStaff(can.content);
    const db = await createSessionClient();
    const title = str(fd, "title", 160);
    const slug = slugify(str(fd, "slug", 80) ?? title ?? "");
    if (!title || !slug) return { ok: false, message: "Title and slug are required." };
    const { data: last } = await db.from("services").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await db.from("services").insert({ slug, status: "draft", sort_order: (last?.sort_order ?? 0) + 1, cta_href: `/case-inquiry?service=${slug}` }).select("id").single();
    if (error) return { ok: false, message: errMessage(error) };
    const langs = await allLanguages(db);
    const def = langs.find((l) => l.is_default)?.code ?? "en";
    const { error: e2 } = await db.from("service_translations").insert({ service_id: data.id, locale: def, variant: "draft", title, nav_title: title, updated_by: user.id });
    if (e2) return { ok: false, message: errMessage(e2) };
    return { ok: true, message: "Service created as a draft.", redirectTo: `/admin/services/${data.id}` };
  } catch (e) { return fail(e); }
}

export async function saveService(serviceId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const user = await assertStaff(can.translate);
    const db = await createSessionClient();
    const langs = await allLanguages(db);

    if (can.content(user)) {
      const showPrice = bool(fd, "show_price");
      const amountRaw = str(fd, "price_amount", 20);
      const amount = amountRaw ? Number(amountRaw) : null;
      const currency = (str(fd, "price_currency", 3) ?? "").toUpperCase() || null;
      if (showPrice && (amount === null || !Number.isFinite(amount) || amount < 0 || !currency || !/^[A-Z]{3}$/.test(currency))) {
        return { ok: false, message: "To display a price, enter a valid amount and a 3-letter currency code (e.g. USD, EUR, EGP)." };
      }
      const slug = slugify(str(fd, "slug", 80) ?? "");
      if (!slug) return { ok: false, message: "Slug is required." };
      const { error } = await db.from("services").update({
        slug,
        is_featured: bool(fd, "is_featured"),
        sort_order: int(fd, "sort_order"),
        main_media_id: str(fd, "main_media_id") || null,
        cta_href: safeHref(str(fd, "cta_href", 300)),
        show_price: showPrice,
        price_amount: amount !== null && Number.isFinite(amount) ? amount : null,
        price_currency: currency,
      }).eq("id", serviceId);
      if (error) return { ok: false, message: errMessage(error) };

      // Gallery: replace the ordered set
      const gallery = json<string[]>(fd, "gallery", []).filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 24);
      const { error: delErr } = await db.from("service_images").delete().eq("service_id", serviceId);
      if (delErr) return { ok: false, message: errMessage(delErr) };
      if (gallery.length) {
        const { error: insErr } = await db.from("service_images").insert(gallery.map((media_id, i) => ({ service_id: serviceId, media_id, sort_order: i + 1 })));
        if (insErr) return { ok: false, message: errMessage(insErr) };
      }
    }

    for (const l of langs) {
      if (!can.locale(user, l.code) || !fd.has(`tr.${l.code}.present`)) continue;
      const p = (k: string, max = 4000) => str(fd, `tr.${l.code}.${k}`, max);
      const title = p("title", 160);
      if (!title) continue; // a translation needs at least a title
      const { error } = await db.from("service_translations").upsert({
        service_id: serviceId, locale: l.code, variant: "draft", title,
        nav_title: p("nav_title", 80), summary: p("summary", 400), description: p("description", 4000),
        features_heading: p("features_heading", 160), features: lines(fd, `tr.${l.code}.features`).map((x) => x.slice(0, 300)),
        workflow_heading: p("workflow_heading", 160),
        workflow: json<{ title?: string; text?: string }[]>(fd, `tr.${l.code}.workflow`, []).slice(0, 20).map((i) => ({ title: String(i.title ?? "").slice(0, 200), text: String(i.text ?? "").slice(0, 1000) })),
        notice: p("notice", 600), cta_label: p("cta_label", 80), price_note: p("price_note", 200),
        seo_title: p("seo_title", 120), seo_description: p("seo_description", 320), updated_by: user.id,
      });
      if (error) return { ok: false, message: `${l.name}: ${errMessage(error)}` };
    }

    if (fd.get("intent") === "publish") {
      if (!can.content(user)) return { ok: false, message: "Draft saved. Only Content Managers can publish." };
      const { error } = await db.rpc("publish_service", { p_id: serviceId });
      if (error) return { ok: false, message: errMessage(error, "Saved, but publishing failed") };
      revalidateSite();
      return { ok: true, message: "Saved and published. The public website has been updated." };
    }
    // Non-translated settings (image, price, order…) are live immediately for published services.
    revalidateSite();
    return { ok: true, message: "Saved. Text changes are drafts until you publish; image, order and price settings apply immediately." };
  } catch (e) { return fail(e); }
}

export async function setServiceStatus(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.content);
    const db = await createSessionClient();
    const id = String(fd.get("id"));
    const status = String(fd.get("status"));
    if (status === "published") {
      const { error } = await db.rpc("publish_service", { p_id: id });
      if (error) return { ok: false, message: errMessage(error) };
    } else if (status === "draft" || status === "archived") {
      const { error } = await db.from("services").update({ status }).eq("id", id);
      if (error) return { ok: false, message: errMessage(error) };
    } else return { ok: false, message: "Invalid status." };
    revalidateSite();
    return { ok: true, message: status === "published" ? "Service published." : status === "archived" ? "Service archived (hidden from the website)." : "Service unpublished." };
  } catch (e) { return fail(e); }
}
