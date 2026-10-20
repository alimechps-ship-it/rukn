import { SUPABASE_URL } from "./env";
import type { Media, MediaRow } from "./types";

export function storageUrl(bucket: string, path: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function pickLocaleRow<T extends { locale: string }>(rows: T[] | null | undefined, locale: string, fallback: string): T | undefined {
  if (!rows?.length) return undefined;
  return rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === fallback) ?? rows[0];
}

/** Turns a media row into everything needed for a responsive <img>. */
export function toMedia(row: MediaRow | null | undefined, locale: string, fallback: string): Media | null {
  if (!row || row.deleted_at) return null;
  const tr = pickLocaleRow(row.media_asset_translations, locale, fallback);
  const variants = Object.entries(row.variants ?? {})
    .map(([w, p]) => [Number(w), p] as const)
    .filter(([w]) => Number.isFinite(w) && w > 0)
    .sort((a, b) => a[0] - b[0]);
  const srcSet = [
    ...variants.map(([w, p]) => `${storageUrl(row.bucket, p)} ${w}w`),
    row.width ? `${storageUrl(row.bucket, row.path)} ${row.width}w` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return {
    id: row.id,
    src: storageUrl(row.bucket, row.path),
    srcSet,
    width: row.width,
    height: row.height,
    alt: tr?.alt_text ?? "",
    caption: tr?.caption ?? null,
    isIllustrative: row.is_illustrative,
  };
}

export const MEDIA_SELECT = "id,bucket,path,variants,filename,mime_type,size_bytes,width,height,category,is_brand_asset,is_illustrative,created_at,updated_at,deleted_at,media_asset_translations(locale,alt_text,caption)";
