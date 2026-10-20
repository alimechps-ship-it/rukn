#!/usr/bin/env node
/**
 * One-off: uploads the supplied RUKN brand assets from ./seed-assets to Supabase
 * Storage (optimised WebP, responsive sizes), registers them in the media library
 * and attaches them to the seeded pages/services. Safe to re-run (skips files
 * already imported). Afterwards everything is managed from /admin/media.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
import "./_env.mjs";
import { requireEnv } from "./_env.mjs";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

requireEnv("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// The product images supplied are rendered marketing visuals, so they are marked
// "illustrative" (a small label is shown on the website). Untick it in the admin
// for photos of real RUKN products.
const ASSETS = [
  { key: "logo", file: "RUKN_logo_trimmed.png", category: "brand", brand: true, illustrative: false, max: 1200,
    alt: ["RUKN logo", "شعار ركن"] },  // original logo with the transparent margin trimmed (no redraw)
  { key: "logoOriginal", file: "RUKN_compact_fullcolor_3834x4000.png", category: "brand", brand: true, illustrative: false, max: 2400,
    alt: ["RUKN logo (original master file)", "شعار ركن (الملف الأصلي)"] },
  { key: "mark", file: "logo_mark_square.png", category: "brand", brand: true, illustrative: false, max: 512,
    alt: ["RUKN logo mark", "رمز شعار ركن"] },
  { key: "planning", file: "Modern_Orthodontic_Planning_Workspace-9.png", category: "treatment-planning",
    alt: ["Laptop showing a digital orthodontic treatment-planning setup with staged tooth positions", "حاسوب محمول يعرض إعدادًا رقميًا لتخطيط علاج تقويم الأسنان مع مراحل حركة الأسنان"] },
  { key: "planning2", file: "crop_planning_quadrant.png", category: "treatment-planning",
    alt: ["Virtual treatment setup displayed in planning software", "إعداد علاجي افتراضي معروض في برنامج التخطيط"] },
  { key: "aligners1", file: "Premium_Clear_Aligners_and_RUKN_Case-6.png", category: "aligners",
    alt: ["Clear aligners next to a navy RUKN case", "مصففات شفافة بجانب علبة ركن باللون الكحلي"] },
  { key: "aligners2", file: "Premium_RUKN_Aligner_Studio_Scene-4.png", category: "aligners",
    alt: ["Pair of clear aligners on a white surface with a storage case", "زوج من المصففات الشفافة على سطح أبيض مع علبة حفظ"] },
  { key: "aligners3", file: "RUKN_Clear_Aligner_Studio_Showcase-7.png", category: "aligners",
    alt: ["Clear aligners and case in a bright studio", "مصففات شفافة وعلبة حفظ في استوديو مضيء"] },
  { key: "aligners4", file: "RUKN_Clear_Aligners_and_Case-5.png", category: "aligners",
    alt: ["Upper and lower clear aligners with a RUKN case", "مصففات شفافة علوية وسفلية مع علبة ركن"] },
  { key: "retainer1", file: "RUKN_Clear_Aligner_Studio-8.png", category: "retainers",
    alt: ["Transparent upper and lower trays on a glass surface", "قوالب شفافة علوية وسفلية على سطح زجاجي"] },
  { key: "retainer2", file: "crop_retainer_quadrant.png", category: "retainers",
    alt: ["Clear trays with a navy storage case on marble", "قوالب شفافة مع علبة حفظ كحلية على سطح رخامي"] },
  { key: "teal", file: "RUKN_Clear_Aligners_in_Teal_Studio_Light-3.png", category: "aligners",
    alt: ["Clear aligners on a navy background with a teal accent", "مصففات شفافة على خلفية كحلية مع لمسة فيروزية"] },
  { key: "snapon", file: "crop_snapon_quadrant.png", category: "snap-on",
    alt: ["Removable aesthetic dental appliance next to a dental model", "جهاز سني تجميلي متحرك بجانب نموذج أسنان"] },
  { key: "showcase", file: "RUKN_Dental_Technology_Showcase-1.png", category: "general",
    alt: ["Overview of digital planning, clear aligners, retainers and aesthetic appliances", "نظرة عامة على التخطيط الرقمي والمصففات والمثبتات والأجهزة التجميلية"] },
];

async function upload(asset) {
  const { data: existing } = await db.from("media_assets").select("id").eq("filename", asset.file).maybeSingle();
  if (existing) { console.log(`• ${asset.file} already imported`); return existing.id; }
  const buf = readFileSync(`seed-assets/${asset.file}`);
  const id = randomUUID();
  const folder = `library/${id}/${Date.now()}`;
  const base = sharp(buf).rotate();
  const full = await base.clone().resize({ width: asset.max ?? 2400, withoutEnlargement: true }).webp({ quality: 84, alphaQuality: 100 }).toBuffer({ resolveWithObject: true });
  const files = [{ path: `${folder}/full.webp`, data: full.data }];
  const variants = {};
  for (const w of [480, 960, 1600]) {
    if (w >= full.info.width) continue;
    files.push({ path: `${folder}/${w}.webp`, data: await base.clone().resize({ width: w }).webp({ quality: 80, alphaQuality: 100 }).toBuffer() });
    variants[w] = `${folder}/${w}.webp`;
  }
  for (const f of files) {
    const { error } = await db.storage.from("media").upload(f.path, f.data, { contentType: "image/webp", cacheControl: "31536000" });
    if (error) throw new Error(`${asset.file}: ${error.message}`);
  }
  const { error } = await db.from("media_assets").insert({
    id, path: `${folder}/full.webp`, variants, filename: asset.file, mime_type: "image/webp", size_bytes: full.data.length,
    width: full.info.width, height: full.info.height, category: asset.category, is_brand_asset: Boolean(asset.brand),
    is_illustrative: asset.illustrative ?? true,
  });
  if (error) throw new Error(`${asset.file}: ${error.message}`);
  await db.from("media_asset_translations").insert([
    { media_id: id, locale: "en", alt_text: asset.alt[0] },
    { media_id: id, locale: "ar", alt_text: asset.alt[1] },
  ]);
  console.log(`✔ ${asset.file} → ${full.info.width}×${full.info.height}, ${files.length} sizes`);
  return id;
}

const ids = {};
for (const a of ASSETS) ids[a.key] = await upload(a);

const must = async (p, label) => { const { error } = await p; if (error) throw new Error(`${label}: ${error.message}`); };

await must(db.from("site_settings").update({ logo_media_id: ids.logo, favicon_media_id: ids.mark, og_image_media_id: ids.showcase }).eq("id", 1), "settings");

const svc = async (slug, main, gallery) => {
  const { data } = await db.from("services").select("id").eq("slug", slug).maybeSingle();
  if (!data) return console.warn(`! service ${slug} not found`);
  await must(db.from("services").update({ main_media_id: main }).eq("id", data.id), slug);
  await db.from("service_images").delete().eq("service_id", data.id);
  if (gallery.length) await must(db.from("service_images").insert(gallery.map((m, i) => ({ service_id: data.id, media_id: m, sort_order: i + 1 }))), `${slug} gallery`);
};
await svc("digital-treatment-planning", ids.planning, [ids.planning2]);
await svc("clear-aligners", ids.aligners1, [ids.aligners2, ids.aligners3, ids.aligners4, ids.teal]);
await svc("clear-retainers", ids.retainer1, [ids.retainer2]);
await svc("snap-on-smile", ids.snapon, []);

const section = async (pageKey, key, patch) => {
  const { data: page } = await db.from("pages").select("id").eq("key", pageKey).single();
  const { data: s } = await db.from("content_sections").select("id,settings").eq("page_id", page.id).eq("key", key).maybeSingle();
  if (!s) return console.warn(`! section ${pageKey}/${key} not found`);
  await must(db.from("content_sections").update(typeof patch === "function" ? patch(s) : patch).eq("id", s.id), `${pageKey}/${key}`);
};
await section("home", "hero", { media_id: ids.planning });
await section("home", "about-summary", { media_id: ids.teal });
await section("home", "gallery", (s) => ({ settings: { ...(s.settings ?? {}), media_ids: [ids.aligners1, ids.planning2, ids.retainer1, ids.snapon, ids.aligners3] } }));

console.log("\nDone. Images are now managed from /admin/media.");
