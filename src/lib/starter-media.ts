import "server-only";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One-click import of the supplied RUKN brand assets (./seed-assets) into the
 * media library, attached to the seeded pages, services and settings.
 * Same result as scripts/seed-media.mjs, but runs on the server with the
 * signed-in Super Administrator's permissions (RLS applies). Safe to re-run:
 * files already in the library are reused, not duplicated.
 */
type Asset = { key: string; file: string; category: string; brand?: boolean; illustrative?: boolean; max?: number; alt: [string, string] };

const ASSETS: Asset[] = [
  { key: "logo", file: "RUKN_logo_trimmed.png", category: "brand", brand: true, illustrative: false, max: 1200, alt: ["RUKN logo", "شعار ركن"] },
  { key: "logoOriginal", file: "RUKN_compact_fullcolor_3834x4000.png", category: "brand", brand: true, illustrative: false, max: 2400, alt: ["RUKN logo (original master file)", "شعار ركن (الملف الأصلي)"] },
  { key: "mark", file: "logo_mark_square.png", category: "brand", brand: true, illustrative: false, max: 512, alt: ["RUKN logo mark", "رمز شعار ركن"] },
  { key: "planning", file: "Modern_Orthodontic_Planning_Workspace-9.png", category: "treatment-planning", alt: ["Laptop showing a digital orthodontic treatment-planning setup with staged tooth positions", "حاسوب محمول يعرض إعدادًا رقميًا لتخطيط علاج تقويم الأسنان مع مراحل حركة الأسنان"] },
  { key: "planning2", file: "crop_planning_quadrant.png", category: "treatment-planning", alt: ["Virtual treatment setup displayed in planning software", "إعداد علاجي افتراضي معروض في برنامج التخطيط"] },
  { key: "aligners1", file: "Premium_Clear_Aligners_and_RUKN_Case-6.png", category: "aligners", alt: ["Clear aligners next to a navy RUKN case", "مصففات شفافة بجانب علبة ركن باللون الكحلي"] },
  { key: "aligners2", file: "Premium_RUKN_Aligner_Studio_Scene-4.png", category: "aligners", alt: ["Pair of clear aligners on a white surface with a storage case", "زوج من المصففات الشفافة على سطح أبيض مع علبة حفظ"] },
  { key: "aligners3", file: "RUKN_Clear_Aligner_Studio_Showcase-7.png", category: "aligners", alt: ["Clear aligners and case in a bright studio", "مصففات شفافة وعلبة حفظ في استوديو مضيء"] },
  { key: "aligners4", file: "RUKN_Clear_Aligners_and_Case-5.png", category: "aligners", alt: ["Upper and lower clear aligners with a RUKN case", "مصففات شفافة علوية وسفلية مع علبة ركن"] },
  { key: "retainer1", file: "RUKN_Clear_Aligner_Studio-8.png", category: "retainers", alt: ["Transparent upper and lower trays on a glass surface", "قوالب شفافة علوية وسفلية على سطح زجاجي"] },
  { key: "retainer2", file: "crop_retainer_quadrant.png", category: "retainers", alt: ["Clear trays with a navy storage case on marble", "قوالب شفافة مع علبة حفظ كحلية على سطح رخامي"] },
  { key: "teal", file: "RUKN_Clear_Aligners_in_Teal_Studio_Light-3.png", category: "aligners", alt: ["Clear aligners on a navy background with a teal accent", "مصففات شفافة على خلفية كحلية مع لمسة فيروزية"] },
  { key: "snapon", file: "crop_snapon_quadrant.png", category: "snap-on", alt: ["Removable aesthetic dental appliance next to a dental model", "جهاز سني تجميلي متحرك بجانب نموذج أسنان"] },
  { key: "showcase", file: "RUKN_Dental_Technology_Showcase-1.png", category: "general", alt: ["Overview of digital planning, clear aligners, retainers and aesthetic appliances", "نظرة عامة على التخطيط الرقمي والمصففات والمثبتات والأجهزة التجميلية"] },
];

export async function importStarterMedia(db: SupabaseClient, userId: string): Promise<{ imported: number; reused: number; warnings: string[] }> {
  const dir = path.join(process.cwd(), "seed-assets");
  const ids: Record<string, string> = {};
  const warnings: string[] = [];
  let imported = 0;
  let reused = 0;

  for (const a of ASSETS) {
    const { data: existing } = await db.from("media_assets").select("id").eq("filename", a.file).is("deleted_at", null).maybeSingle();
    if (existing) { ids[a.key] = existing.id; reused++; continue; }

    let buf: Buffer;
    try { buf = await readFile(path.join(dir, a.file)); } catch { warnings.push(`File not found on server: ${a.file}`); continue; }

    const id = randomUUID();
    const folder = `library/${id}/${Date.now()}`;
    const base = sharp(buf).rotate();
    const full = await base.clone().resize({ width: a.max ?? 2400, withoutEnlargement: true }).webp({ quality: 84, alphaQuality: 100 }).toBuffer({ resolveWithObject: true });
    const files = [{ path: `${folder}/full.webp`, data: full.data }];
    const variants: Record<string, string> = {};
    for (const w of [480, 960, 1600]) {
      if (w >= full.info.width) continue;
      files.push({ path: `${folder}/${w}.webp`, data: await base.clone().resize({ width: w }).webp({ quality: 80, alphaQuality: 100 }).toBuffer() });
      variants[String(w)] = `${folder}/${w}.webp`;
    }
    for (const f of files) {
      const { error } = await db.storage.from("media").upload(f.path, f.data, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
      if (error) throw new Error(`${a.file}: storage upload failed — ${error.message}`);
    }
    const { error } = await db.from("media_assets").insert({
      id, path: `${folder}/full.webp`, variants, filename: a.file, mime_type: "image/webp", size_bytes: full.data.length,
      width: full.info.width, height: full.info.height, category: a.category, is_brand_asset: Boolean(a.brand),
      is_illustrative: false, uploaded_by: userId,
    });
    if (error) throw new Error(`${a.file}: ${error.message}`);
    await db.from("media_asset_translations").insert([
      { media_id: id, locale: "en", alt_text: a.alt[0] },
      { media_id: id, locale: "ar", alt_text: a.alt[1] },
    ]);
    ids[a.key] = id;
    imported++;
  }

  const must = async (p: PromiseLike<{ error: { message: string } | null }>, label: string) => {
    const { error } = await p;
    if (error) warnings.push(`${label}: ${error.message}`);
  };

  // Settings (only fill empty slots so admin choices are never overwritten)
  const { data: s } = await db.from("site_settings").select("logo_media_id,favicon_media_id,og_image_media_id").eq("id", 1).maybeSingle();
  await must(db.from("site_settings").update({
    logo_media_id: s?.logo_media_id ?? ids.logo ?? null,
    // Favicon and share image use the built-in icon set in /public unless chosen manually.
    favicon_media_id: s?.favicon_media_id ?? null,
    og_image_media_id: s?.og_image_media_id ?? null,
  }).eq("id", 1), "settings");

  // Services
  const services: [string, string | undefined, (string | undefined)[]][] = [
    ["digital-treatment-planning", ids.planning, [ids.planning2]],
    ["clear-aligners", ids.aligners1, [ids.aligners2, ids.aligners3, ids.aligners4, ids.teal]],
    ["clear-retainers", ids.retainer1, [ids.retainer2]],
    ["snap-on-smile", ids.snapon, []],
  ];
  for (const [slug, main, gallery] of services) {
    const { data: svc } = await db.from("services").select("id,main_media_id").eq("slug", slug).maybeSingle();
    if (!svc) { warnings.push(`Service not found: ${slug}`); continue; }
    if (!svc.main_media_id && main) await must(db.from("services").update({ main_media_id: main }).eq("id", svc.id), slug);
    const { count } = await db.from("service_images").select("id", { count: "exact", head: true }).eq("service_id", svc.id);
    const g = gallery.filter((x): x is string => Boolean(x));
    if (!count && g.length) await must(db.from("service_images").insert(g.map((m, i) => ({ service_id: svc.id, media_id: m, sort_order: i + 1 }))), `${slug} gallery`);
  }

  // Home page sections
  const { data: home } = await db.from("pages").select("id").eq("key", "home").maybeSingle();
  if (home) {
    const { data: secs } = await db.from("content_sections").select("id,key,media_id,settings").eq("page_id", home.id);
    const sec = (k: string) => secs?.find((x) => x.key === k);
    const hero = sec("hero");
    if (hero && !hero.media_id && ids.planning) await must(db.from("content_sections").update({ media_id: ids.planning }).eq("id", hero.id), "home/hero");
    const about = sec("about-summary");
    if (about && !about.media_id && ids.teal) await must(db.from("content_sections").update({ media_id: ids.teal }).eq("id", about.id), "home/about-summary");
    const gal = sec("gallery");
    const current = (gal?.settings as { media_ids?: string[] } | null)?.media_ids ?? [];
    if (gal && !current.length) {
      const media_ids = [ids.aligners1, ids.planning2, ids.retainer1, ids.snapon, ids.aligners3].filter(Boolean);
      await must(db.from("content_sections").update({ settings: { ...((gal.settings as object) ?? {}), media_ids } }).eq("id", gal.id), "home/gallery");
    }
  }

  return { imported, reused, warnings };
}
