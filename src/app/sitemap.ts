import type { MetadataRoute } from "next";
import { getSitemapEntries } from "@/lib/content";
import { isSupabaseConfigured, siteOrigin } from "@/lib/env";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!isSupabaseConfigured()) return [];
  const origin = siteOrigin();
  const { locales, paths } = await getSitemapEntries();
  return paths.flatMap((p) =>
    locales.map((l) => ({
      url: `${origin}/${l}${p.path}`,
      lastModified: new Date(p.updated),
      alternates: { languages: Object.fromEntries(locales.map((x) => [x, `${origin}/${x}${p.path}`])) },
    })),
  );
}
