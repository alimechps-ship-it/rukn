import type { Metadata } from "next";
import { siteOrigin } from "./env";
import type { Media, SiteData } from "./types";

/** Builds canonical, hreflang alternates and Open Graph metadata for a localized path. */
export function buildMetadata(
  site: SiteData,
  opts: { title?: string | null; description?: string | null; path: string; image?: Media | null; noIndex?: boolean },
): Metadata {
  const origin = siteOrigin(site.settings.site_url);
  const path = opts.path === "/" ? "" : opts.path;
  const languages: Record<string, string> = {};
  for (const l of site.languages) languages[l.code] = `${origin}/${l.code}${path}`;
  languages["x-default"] = `${origin}/${site.defaultLocale}${path}`;
  const title = opts.title || site.settingsTr.default_seo_title || site.settings.site_name;
  const description = opts.description || site.settingsTr.default_seo_description || undefined;
  const image = opts.image ?? site.settings.ogImage;
  return {
    metadataBase: new URL(origin),
    title: { absolute: title },
    description,
    alternates: { canonical: `${origin}/${site.locale}${path}`, languages },
    openGraph: {
      type: "website",
      siteName: site.settings.site_name,
      title,
      description,
      url: `${origin}/${site.locale}${path}`,
      locale: site.locale,
      alternateLocale: site.languages.filter((l) => l.code !== site.locale).map((l) => l.code),
      images: image ? [{ url: image.src, width: image.width ?? undefined, height: image.height ?? undefined, alt: image.alt }] : undefined,
    },
    twitter: { card: image ? "summary_large_image" : "summary", title, description },
    robots: opts.noIndex || site.preview ? { index: false, follow: false } : undefined,
  };
}

/** Organization structured data built only from configured, verified facts. */
export function organizationJsonLd(site: SiteData) {
  const origin = siteOrigin(site.settings.site_url);
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: site.settings.site_name,
    url: origin,
    logo: site.settings.logo?.src ?? `${origin}/rukn-logo.png`,
    address: { "@type": "PostalAddress", addressCountry: site.settings.country_code },
  };
  if (site.settings.contact_email) {
    data.contactPoint = [{ "@type": "ContactPoint", email: site.settings.contact_email, contactType: "customer support", availableLanguage: site.languages.map((l) => l.name) }];
  }
  if (site.settings.social_links.length) data.sameAs = site.settings.social_links.map((l) => l.url);
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
