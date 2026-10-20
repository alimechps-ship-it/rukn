"use server";

import { randomUUID } from "node:crypto";
import sharp, { type Metadata as SharpMetadata } from "sharp";
import { assertStaff, can } from "@/lib/auth";
import { allLanguages, bool, createSessionClient, errMessage, revalidateSite, str } from "@/lib/admin";
import type { ActionResult } from "@/components/admin/ActionForm";

const MAX_BYTES = 10 * 1024 * 1024;
const WIDTHS = [480, 960, 1600];
const CATEGORIES = ["brand", "treatment-planning", "aligners", "retainers", "snap-on", "team", "general"];
const INCOMING = /^incoming\/[0-9a-f-]{36}\.(jpe?g|png|webp|avif)$/i;

function fail(e: unknown): ActionResult {
  return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." };
}

/**
 * Validates an image that the browser uploaded to "incoming/", converts it to
 * optimised WebP in several responsive sizes, and creates or replaces the
 * media record. The temporary upload is always removed.
 */
export async function processUpload(input: { incomingPath: string; filename: string; category: string; replaceId?: string | null; illustrative?: boolean }): Promise<{ ok: boolean; message: string; id?: string }> {
  const db = await createSessionClient();
  const cleanup = () => db.storage.from("media").remove([input.incomingPath]).catch(() => undefined);
  try {
    const user = await assertStaff(can.content);
    if (!INCOMING.test(input.incomingPath)) return { ok: false, message: "Invalid upload path." };
    const category = CATEGORIES.includes(input.category) ? input.category : "general";

    const { data: blob, error: dlErr } = await db.storage.from("media").download(input.incomingPath);
    if (dlErr || !blob) { await cleanup(); return { ok: false, message: `Upload could not be read back from storage: ${dlErr?.message ?? "not found"}` }; }
    if (blob.size > MAX_BYTES) { await cleanup(); return { ok: false, message: "File is larger than 10 MB." }; }
    const buf = Buffer.from(await blob.arrayBuffer());

    let meta: SharpMetadata;
    try {
      meta = await sharp(buf, { limitInputPixels: 50_000_000 }).metadata();
    } catch {
      await cleanup();
      return { ok: false, message: "The file is not a valid image." };
    }
    if (!meta.format || !["jpeg", "png", "webp", "avif", "heif"].includes(meta.format) || !meta.width || !meta.height) {
      await cleanup();
      return { ok: false, message: `Unsupported image format (${meta.format ?? "unknown"}). Use JPG, PNG, WebP or AVIF.` };
    }

    const id = input.replaceId ?? randomUUID();
    const folder = `library/${id}/${Date.now()}`;
    const base = sharp(buf, { limitInputPixels: 50_000_000 }).rotate();
    const full = await base.clone().resize({ width: 2400, withoutEnlargement: true }).webp({ quality: 84, alphaQuality: 100 }).toBuffer({ resolveWithObject: true });
    const uploads: { path: string; data: Buffer }[] = [{ path: `${folder}/full.webp`, data: full.data }];
    const variants: Record<string, string> = {};
    for (const w of WIDTHS) {
      if (w >= full.info.width) continue;
      const v = await base.clone().resize({ width: w }).webp({ quality: 80, alphaQuality: 100 }).toBuffer();
      uploads.push({ path: `${folder}/${w}.webp`, data: v });
      variants[String(w)] = `${folder}/${w}.webp`;
    }
    for (const u of uploads) {
      const { error } = await db.storage.from("media").upload(u.path, u.data, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
      if (error) {
        await db.storage.from("media").remove(uploads.map((x) => x.path));
        await cleanup();
        return { ok: false, message: `Storage upload failed: ${error.message}` };
      }
    }

    const record = {
      path: `${folder}/full.webp`, variants, mime_type: "image/webp", size_bytes: full.data.length,
      width: full.info.width, height: full.info.height,
    };

    if (input.replaceId) {
      const { data: old, error: oldErr } = await db.from("media_assets").select("path,variants").eq("id", input.replaceId).single();
      if (oldErr || !old) { await cleanup(); return { ok: false, message: "The image to replace was not found." }; }
      const { error } = await db.from("media_assets").update(record).eq("id", input.replaceId);
      if (error) { await db.storage.from("media").remove(uploads.map((x) => x.path)); await cleanup(); return { ok: false, message: errMessage(error) }; }
      await db.storage.from("media").remove([old.path, ...Object.values((old.variants ?? {}) as Record<string, string>)]);
    } else {
      const filename = (input.filename || "image").replace(/[^\p{L}\p{N}._ -]+/gu, "").slice(0, 200) || "image";
      const { error } = await db.from("media_assets").insert({ id, ...record, filename, category, is_illustrative: Boolean(input.illustrative), uploaded_by: user.id });
      if (error) { await db.storage.from("media").remove(uploads.map((x) => x.path)); await cleanup(); return { ok: false, message: errMessage(error) }; }
    }
    await cleanup();
    revalidateSite();
    return { ok: true, id, message: input.replaceId ? "Image replaced everywhere it is used." : `Uploaded (${full.info.width}×${full.info.height}, ${Object.keys(variants).length + 1} sizes).` };
  } catch (e) {
    await cleanup();
    return { ok: false, message: e instanceof Error ? e.message : "Unexpected error." };
  }
}

export async function saveMedia(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const user = await assertStaff(can.translate);
    const db = await createSessionClient();
    if (can.content(user)) {
      const category = String(fd.get("category"));
      const filename = str(fd, "filename", 200);
      if (!filename) return { ok: false, message: "File name is required." };
      const { error } = await db.from("media_assets").update({
        filename, category: CATEGORIES.includes(category) ? category : "general",
        is_illustrative: bool(fd, "is_illustrative"), is_brand_asset: bool(fd, "is_brand_asset"),
      }).eq("id", id);
      if (error) return { ok: false, message: errMessage(error) };
    }
    for (const l of await allLanguages(db)) {
      if (!can.locale(user, l.code) || !fd.has(`tr.${l.code}.alt_text`)) continue;
      const { error } = await db.from("media_asset_translations").upsert({ media_id: id, locale: l.code, alt_text: str(fd, `tr.${l.code}.alt_text`, 300) ?? "", caption: str(fd, `tr.${l.code}.caption`, 300) });
      if (error) return { ok: false, message: `${l.name}: ${errMessage(error)}` };
    }
    revalidateSite();
    return { ok: true, message: "Image details saved." };
  } catch (e) { return fail(e); }
}

export async function deleteMedia(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertStaff(can.content);
    const db = await createSessionClient();
    const id = String(fd.get("id"));
    const { data: usage, error: uErr } = await db.rpc("media_usage", { p_media_id: id });
    if (uErr) return { ok: false, message: errMessage(uErr) };
    if (usage?.length) return { ok: false, message: `This image is still used (${(usage as { label: string }[]).map((u) => u.label).join("; ")}). Replace or remove it there first.` };
    const { data: m, error } = await db.from("media_assets").select("path,variants").eq("id", id).single();
    if (error || !m) return { ok: false, message: "Image not found." };
    const { error: delErr } = await db.from("media_assets").delete().eq("id", id);
    if (delErr) return { ok: false, message: errMessage(delErr) };
    const { error: stErr } = await db.storage.from("media").remove([m.path, ...Object.values((m.variants ?? {}) as Record<string, string>)]);
    revalidateSite();
    return { ok: true, message: stErr ? `Record deleted, but some files could not be removed from storage: ${stErr.message}` : "Image deleted.", redirectTo: "/admin/media" };
  } catch (e) { return fail(e); }
}
