import "server-only";
import { revalidatePath } from "next/cache";
import { createSessionClient } from "./supabase/server";
import { MEDIA_SELECT, storageUrl } from "./media";
import type { Language, MediaRow } from "./types";

export type Db = Awaited<ReturnType<typeof createSessionClient>>;
export { createSessionClient };

/** Purge the public cache so published changes appear immediately. */
export function revalidateSite() {
  revalidatePath("/", "layout");
}

export async function allLanguages(db: Db): Promise<Language[]> {
  const { data } = await db.from("languages").select("*").order("sort_order");
  return (data ?? []) as Language[];
}

export async function pickerMedia(db: Db) {
  const { data } = await db.from("media_assets").select(MEDIA_SELECT).is("deleted_at", null).order("created_at", { ascending: false }).limit(500);
  return ((data ?? []) as unknown as MediaRow[]).map((m) => ({
    id: m.id,
    filename: m.filename,
    category: m.category,
    src: storageUrl(m.bucket, m.variants?.["480"] ?? m.path),
  }));
}

// ---- FormData parsing --------------------------------------------------
export const str = (fd: FormData, k: string, max = 8000) => {
  const v = fd.get(k);
  if (v === null) return null;
  const s = String(v).replace(/\r\n/g, "\n").trim();
  return s.length ? s.slice(0, max) : null;
};
export const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
export const int = (fd: FormData, k: string, d = 0) => {
  const n = Number.parseInt(String(fd.get(k) ?? ""), 10);
  return Number.isFinite(n) ? n : d;
};
export function json<T>(fd: FormData, k: string, fallback: T): T {
  try {
    const v = fd.get(k);
    return v ? (JSON.parse(String(v)) as T) : fallback;
  } catch {
    return fallback;
  }
}
export const lines = (fd: FormData, k: string) =>
  (str(fd, k, 20000) ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 50);

/** Accepts internal paths (/about), anchors, mailto/tel and http(s) URLs only. */
export function safeHref(v: string | null): string | null {
  if (!v) return null;
  if (/^(\/(?!\/)|#|mailto:|tel:|https?:\/\/)/i.test(v)) return v.slice(0, 300);
  return null;
}

export function slugify(v: string) {
  return v.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

export function errMessage(error: { message?: string; code?: string } | null | undefined, fallback = "The change could not be saved.") {
  if (!error) return fallback;
  if (error.code === "23505") return "That value is already used (it must be unique).";
  if (error.code === "23514") return "One of the values is not allowed (validation failed).";
  if (error.code === "42501") return "You do not have permission to perform this action.";
  if (error.code === "23503") return "This item is still referenced elsewhere.";
  return `${fallback} (${error.message ?? "unknown error"})`;
}

/** True when the draft translations differ from what is published. */
export function hasPendingChanges(rows: Record<string, unknown>[], fields: string[]) {
  const key = (r: Record<string, unknown>) => fields.map((f) => JSON.stringify(r[f] ?? null)).join("|");
  const drafts = rows.filter((r) => r.variant === "draft");
  const pub = rows.filter((r) => r.variant === "published");
  if (drafts.length !== pub.length) return true;
  return drafts.some((d) => {
    const p = pub.find((x) => x.locale === d.locale);
    return !p || key(p) !== key(d);
  });
}

export const SECTION_TR_FIELDS = ["eyebrow", "heading", "subheading", "body", "items", "primary_label", "primary_href", "secondary_label", "secondary_href"];
export const SERVICE_TR_FIELDS = ["title", "nav_title", "summary", "description", "features_heading", "features", "workflow_heading", "workflow", "notice", "cta_label", "price_note", "seo_title", "seo_description", "why_heading", "why_patients", "why_clinicians"];
export const PAGE_TR_FIELDS = ["title", "seo_title", "seo_description"];

export function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" });
}
