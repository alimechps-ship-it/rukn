import "server-only";
import { cache } from "react";
import { draftMode } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPublicClient } from "./supabase/public";
import { createSessionClient } from "./supabase/server";
import { MEDIA_SELECT, pickLocaleRow, toMedia } from "./media";
import type {
  Faq, Item, Language, MediaRow, NavItem, PageData, Section, SectionTr, Service, ServiceTr, SiteData, TeamMember,
} from "./types";

type Variant = "draft" | "published";

/**
 * Returns the client and variant to read. In preview (draft) mode a staff
 * session is used and draft content is read; RLS still guarantees that
 * only staff can see drafts.
 */
const getReader = cache(async (): Promise<{ db: SupabaseClient; variant: Variant; preview: boolean }> => {
  let preview = false;
  try {
    preview = (await draftMode()).isEnabled;
  } catch {
    preview = false;
  }
  if (preview) {
    const db = (await createSessionClient()) as unknown as SupabaseClient;
    const { data } = await db.rpc("is_staff");
    if (data === true) return { db, variant: "draft", preview: true };
  }
  return { db: createPublicClient(), variant: "published", preview: false };
});

function byVariant<T extends { variant?: string }>(rows: T[] | null | undefined, variant: Variant): T[] {
  return (rows ?? []).filter((r) => r.variant === variant);
}

function asItems(v: unknown): Item[] {
  return Array.isArray(v) ? v.filter((x) => x && typeof x === "object").map((x) => ({ title: String((x as Item).title ?? ""), text: String((x as Item).text ?? ""), icon: typeof (x as Item).icon === "string" ? (x as Item).icon : undefined })) : [];
}

export const getLanguages = cache(async (): Promise<Language[]> => {
  const { db } = await getReader();
  const { data, error } = await db.from("languages").select("*").eq("enabled", true).order("sort_order");
  if (error) throw new Error(`Could not load languages: ${error.message}`);
  return (data ?? []) as Language[];
});

export const getSite = cache(async (locale: string): Promise<SiteData | null> => {
  const { db, preview } = await getReader();
  const languages = await getLanguages();
  const lang = languages.find((l) => l.code === locale);
  if (!lang) return null;
  const def = languages.find((l) => l.is_default)?.code ?? "en";

  const mediaJoin = (fk: string) => `${fk}:media_assets!site_settings_${fk}_media_id_fkey(${MEDIA_SELECT})`;
  const [settingsRes, settingsTrRes, navRes, annRes, stringsRes] = await Promise.all([
    db.from("site_settings").select(`*, ${mediaJoin("logo")}, ${mediaJoin("favicon")}, ${mediaJoin("og_image")}`).eq("id", 1).maybeSingle(),
    db.from("site_settings_translations").select("*").in("locale", [locale, def]),
    db.from("navigation_items").select("id,location,href,is_external,sort_order,is_visible,navigation_item_translations(locale,label)").eq("is_visible", true).order("sort_order"),
    db.from("announcements").select("id,href,sort_order,status,starts_at,ends_at,deleted_at,announcement_translations(locale,text,link_label)").eq("status", "published").is("deleted_at", null).order("sort_order"),
    db.from("translations").select("key,locale,value").eq("namespace", "ui").in("locale", [locale, def]),
  ]);
  if (settingsRes.error) throw new Error(`Could not load settings: ${settingsRes.error.message}`);
  const s = settingsRes.data as Record<string, unknown> | null;

  const strings: Record<string, string> = {};
  for (const r of (stringsRes.data ?? []).filter((r) => r.locale === def)) strings[r.key] = r.value;
  for (const r of (stringsRes.data ?? []).filter((r) => r.locale === locale)) strings[r.key] = r.value;

  const nav = (navRes.data ?? []).map((n) => ({
    location: n.location as string,
    item: {
      id: n.id,
      href: n.href,
      is_external: n.is_external,
      label: pickLocaleRow(n.navigation_item_translations, locale, def)?.label ?? n.href,
    } as NavItem,
  }));

  const now = Date.now();
  const announcements = (annRes.data ?? [])
    .filter((a) => (!a.starts_at || Date.parse(a.starts_at) <= now) && (!a.ends_at || Date.parse(a.ends_at) > now))
    .map((a) => {
      const tr = pickLocaleRow(a.announcement_translations, locale, def);
      return tr ? { id: a.id, href: a.href, text: tr.text, link_label: tr.link_label } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const pick = (k: string) => {
    const own = (settingsTrRes.data ?? []).find((r) => r.locale === locale)?.[k];
    const fb = (settingsTrRes.data ?? []).find((r) => r.locale === def)?.[k];
    return (own ?? fb ?? null) as string | null;
  };

  return {
    locale,
    dir: lang.dir,
    defaultLocale: def,
    languages,
    preview,
    settings: {
      site_name: (s?.site_name as string) ?? "RUKN",
      site_url: (s?.site_url as string) ?? null,
      contact_email: (s?.contact_email as string) ?? null,
      whatsapp_number: (s?.whatsapp_number as string) ?? null,
      country_code: (s?.country_code as string) ?? "EG",
      social_links: Array.isArray(s?.social_links) ? (s!.social_links as { network: string; url: string }[]).filter((l) => l?.url) : [],
      brand_colors: (s?.brand_colors as Record<string, string>) ?? {},
      analytics_provider: (s?.analytics_provider as "plausible" | "ga4" | null) ?? null,
      analytics_id: (s?.analytics_id as string) ?? null,
      cookie_consent_enabled: Boolean(s?.cookie_consent_enabled ?? true),
      maintenance_mode: Boolean(s?.maintenance_mode),
      logo: toMedia(s?.logo as MediaRow | null, locale, def),
      favicon: toMedia(s?.favicon as MediaRow | null, locale, def),
      ogImage: toMedia(s?.og_image as MediaRow | null, locale, def),
    },
    settingsTr: {
      tagline: pick("tagline"),
      location_text: pick("location_text"),
      business_hours: pick("business_hours"),
      footer_text: pick("footer_text"),
      case_submission_instructions: pick("case_submission_instructions"),
      default_seo_title: pick("default_seo_title"),
      default_seo_description: pick("default_seo_description"),
      cookie_banner_text: pick("cookie_banner_text"),
      maintenance_message: pick("maintenance_message"),
    },
    header: nav.filter((n) => n.location === "header").map((n) => n.item),
    footer: nav.filter((n) => n.location === "footer").map((n) => n.item),
    legal: nav.filter((n) => n.location === "footer_legal").map((n) => n.item),
    announcements,
    strings,
  };
});

function sectionTr(rows: Record<string, unknown>[], locale: string, def: string): SectionTr {
  const r = (pickLocaleRow(rows as { locale: string }[], locale, def) ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === "string" && (r[k] as string).length ? (r[k] as string) : null);
  return {
    eyebrow: str("eyebrow"),
    heading: str("heading"),
    subheading: str("subheading"),
    body: str("body"),
    items: asItems(r.items),
    primary_label: str("primary_label"),
    primary_href: str("primary_href"),
    secondary_label: str("secondary_label"),
    secondary_href: str("secondary_href"),
  };
}

export const getPage = cache(async (slug: string, locale: string): Promise<PageData | null> => {
  const { db, variant, preview } = await getReader();
  const languages = await getLanguages();
  const def = languages.find((l) => l.is_default)?.code ?? "en";

  let q = db
    .from("pages")
    .select(`id,key,slug,template,status,needs_legal_review,updated_at,deleted_at,page_translations(*),og:media_assets!pages_og_image_media_id_fkey(${MEDIA_SELECT})`)
    .eq("slug", slug)
    .is("deleted_at", null);
  if (!preview) q = q.eq("status", "published");
  const { data: page, error } = await q.maybeSingle();
  if (error) throw new Error(`Could not load page: ${error.message}`);
  if (!page) return null;

  let sq = db
    .from("content_sections")
    .select(`id,key,type,status,sort_order,settings,content_section_translations(*),media:media_assets!content_sections_media_id_fkey(${MEDIA_SELECT})`)
    .eq("page_id", page.id)
    .is("deleted_at", null)
    .order("sort_order");
  if (!preview) sq = sq.eq("status", "published");
  const { data: sections, error: sErr } = await sq;
  if (sErr) throw new Error(`Could not load sections: ${sErr.message}`);

  const ptr = pickLocaleRow(byVariant(page.page_translations, variant), locale, def);
  return {
    id: page.id,
    key: page.key,
    slug: page.slug,
    template: page.template,
    needs_legal_review: page.needs_legal_review,
    updated_at: page.updated_at,
    title: ptr?.title ?? page.key,
    seo_title: ptr?.seo_title ?? null,
    seo_description: ptr?.seo_description ?? null,
    ogImage: toMedia(page.og as unknown as MediaRow | null, locale, def),
    sections: (sections ?? [])
      .map((s) => ({
        id: s.id,
        key: s.key,
        type: s.type,
        settings: (s.settings ?? {}) as Record<string, unknown>,
        media: toMedia(s.media as unknown as MediaRow | null, locale, def),
        tr: sectionTr(byVariant(s.content_section_translations, variant), locale, def),
        _hasTr: byVariant(s.content_section_translations, variant).length > 0,
      }))
      .filter((s) => s._hasTr)
      .map(({ _hasTr, ...s }) => { void _hasTr; return s as Section; }),
  };
});

function serviceTr(rows: Record<string, unknown>[], locale: string, def: string): ServiceTr | null {
  const r = pickLocaleRow(rows as { locale: string }[], locale, def) as Record<string, unknown> | undefined;
  if (!r) return null;
  const str = (k: string) => (typeof r[k] === "string" && (r[k] as string).length ? (r[k] as string) : null);
  return {
    title: String(r.title ?? ""),
    nav_title: str("nav_title"),
    summary: str("summary"),
    description: str("description"),
    features_heading: str("features_heading"),
    features: Array.isArray(r.features) ? (r.features as unknown[]).map(String).filter(Boolean) : [],
    workflow_heading: str("workflow_heading"),
    workflow: asItems(r.workflow),
    notice: str("notice"),
    cta_label: str("cta_label"),
    price_note: str("price_note"),
    seo_title: str("seo_title"),
    seo_description: str("seo_description"),
  };
}

const SERVICE_SELECT = `id,slug,status,sort_order,is_featured,cta_href,show_price,price_amount,price_currency,updated_at,deleted_at,
  service_translations(*),
  main:media_assets!services_main_media_id_fkey(${MEDIA_SELECT}),
  service_images(id,sort_order,is_hidden,media:media_assets!service_images_media_id_fkey(${MEDIA_SELECT}))`;

export const getServices = cache(async (locale: string): Promise<Service[]> => {
  const { db, variant, preview } = await getReader();
  const languages = await getLanguages();
  const def = languages.find((l) => l.is_default)?.code ?? "en";
  let q = db.from("services").select(SERVICE_SELECT).is("deleted_at", null).order("sort_order");
  q = preview ? q.neq("status", "archived") : q.eq("status", "published");
  const { data, error } = await q;
  if (error) throw new Error(`Could not load services: ${error.message}`);
  return (data ?? [])
    .map((s) => {
      const tr = serviceTr(byVariant(s.service_translations, variant), locale, def);
      if (!tr) return null;
      return {
        id: s.id,
        slug: s.slug,
        is_featured: s.is_featured,
        sort_order: s.sort_order,
        cta_href: s.cta_href,
        show_price: s.show_price,
        price_amount: s.price_amount === null ? null : Number(s.price_amount),
        price_currency: s.price_currency,
        updated_at: s.updated_at,
        media: toMedia(s.main as unknown as MediaRow | null, locale, def),
        gallery: (s.service_images ?? [])
          .filter((i) => !i.is_hidden)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((i) => toMedia(i.media as unknown as MediaRow | null, locale, def))
          .filter((m): m is NonNullable<typeof m> => m !== null),
        tr,
      } satisfies Service;
    })
    .filter((s): s is Service => s !== null);
});

export async function getService(slug: string, locale: string) {
  return (await getServices(locale)).find((s) => s.slug === slug) ?? null;
}

export const getFaqs = cache(async (locale: string, topic = "general"): Promise<Faq[]> => {
  const { db, preview } = await getReader();
  const languages = await getLanguages();
  const def = languages.find((l) => l.is_default)?.code ?? "en";
  let q = db.from("faqs").select("id,sort_order,status,faq_translations(locale,question,answer)").eq("topic", topic).is("deleted_at", null).order("sort_order");
  if (!preview) q = q.eq("status", "published");
  const { data } = await q;
  return (data ?? [])
    .map((f) => {
      const tr = pickLocaleRow(f.faq_translations, locale, def);
      return tr ? { id: f.id, question: tr.question, answer: tr.answer } : null;
    })
    .filter((f): f is Faq => f !== null);
});

export const getTeam = cache(async (locale: string): Promise<TeamMember[]> => {
  const { db, preview } = await getReader();
  const languages = await getLanguages();
  const def = languages.find((l) => l.is_default)?.code ?? "en";
  let q = db
    .from("team_members")
    .select(`id,sort_order,status,linkedin_url,team_member_translations(locale,name,role_title,bio),photo:media_assets!team_members_photo_media_id_fkey(${MEDIA_SELECT})`)
    .is("deleted_at", null)
    .order("sort_order");
  if (!preview) q = q.eq("status", "published");
  const { data } = await q;
  return (data ?? [])
    .map((m) => {
      const tr = pickLocaleRow(m.team_member_translations, locale, def);
      return tr
        ? { id: m.id, name: tr.name, role_title: tr.role_title, bio: tr.bio, linkedin_url: m.linkedin_url, photo: toMedia(m.photo as unknown as MediaRow | null, locale, def) }
        : null;
    })
    .filter((m): m is TeamMember => m !== null);
});

export const getMediaByIds = cache(async (idsKey: string, locale: string) => {
  const ids = idsKey.split(",").filter(Boolean);
  if (!ids.length) return [];
  const { db } = await getReader();
  const languages = await getLanguages();
  const def = languages.find((l) => l.is_default)?.code ?? "en";
  const { data } = await db.from("media_assets").select(MEDIA_SELECT).in("id", ids).is("deleted_at", null);
  const rows = (data ?? []) as unknown as MediaRow[];
  return ids
    .map((id) => rows.find((r) => r.id === id))
    .map((r) => toMedia(r, locale, def))
    .filter((m): m is NonNullable<typeof m> => m !== null);
});

/** All published routes for the sitemap. */
export async function getSitemapEntries() {
  const db = createPublicClient();
  const [langs, pages, services] = await Promise.all([
    db.from("languages").select("code,is_default").eq("enabled", true).order("sort_order"),
    db.from("pages").select("slug,updated_at,show_in_sitemap").eq("status", "published").is("deleted_at", null),
    db.from("services").select("slug,updated_at").eq("status", "published").is("deleted_at", null),
  ]);
  return {
    locales: (langs.data ?? []).map((l) => l.code as string),
    defaultLocale: (langs.data ?? []).find((l) => l.is_default)?.code ?? "en",
    paths: [
      ...(pages.data ?? []).filter((p) => p.show_in_sitemap).map((p) => ({ path: p.slug ? `/${p.slug}` : "", updated: p.updated_at as string })),
      ...(services.data ?? []).map((s) => ({ path: `/services/${s.slug}`, updated: s.updated_at as string })),
    ],
  };
}
