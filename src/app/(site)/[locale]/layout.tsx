import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "../site.css";
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Consent } from "@/components/site/Consent";
import { getSite } from "@/lib/content";
import { isSupabaseConfigured, siteOrigin } from "@/lib/env";
import { localizeHref, makeT } from "@/lib/i18n";
import { organizationJsonLd } from "@/lib/seo";

export const revalidate = 300;
export const dynamicParams = true;
export function generateStaticParams() { return []; }

export const viewport: Viewport = { themeColor: "#10263D", width: "device-width", initialScale: 1 };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  if (!isSupabaseConfigured()) return { title: "RUKN" };
  const { locale } = await params;
  const site = await getSite(locale);
  if (!site) return {};
  return {
    metadataBase: new URL(siteOrigin(site.settings.site_url)),
    applicationName: site.settings.site_name,
    manifest: "/site.webmanifest",
    icons: {
      // Official RUKN icon set (public/) — generated from the brand logo.
      icon: [
        { url: "/favicon.ico", sizes: "48x48" },
        { url: "/favicon.svg", type: "image/svg+xml" },
        { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      ],
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    },
    other: { "msapplication-config": "/browserconfig.xml", "msapplication-TileColor": "#10263D" },
  };
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export default async function SiteLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isSupabaseConfigured()) {
    return (
      <html lang="en"><body><main className="center-page"><div><h1>Configuration required</h1><p>Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see README).</p></div></main></body></html>
    );
  }
  const site = await getSite(locale);
  if (!site) notFound();
  const t = makeT(site.strings);
  const logoSrc = site.settings.logo?.src ?? "/rukn-logo.png";
  const colors = site.settings.brand_colors;
  const vars = [
    HEX.test(colors.navy ?? "") ? `--navy:${colors.navy};` : "",
    HEX.test(colors.teal ?? "") ? `--teal:${colors.teal};` : "",
    HEX.test(colors.light ?? "") ? `--light:${colors.light};` : "",
    HEX.test(colors.text ?? "") ? `--text:${colors.text};` : "",
  ].join("");
  const maintenance = site.settings.maintenance_mode && !site.preview;

  return (
    <html lang={locale} dir={site.dir}>
      <body>
        {vars ? <style>{`:root{${vars}}`}</style> : null}
        <a className="skip-link" href="#main">{t("skip_to_content")}</a>
        {site.preview ? (
          <div className="preview-bar"><div className="container"><span>{t("preview.banner")}</span><a href="/api/preview/exit">{t("preview.exit")}</a></div></div>
        ) : null}
        {!maintenance && site.announcements.map((a) => (
          <div className="announce" key={a.id}>
            <div className="container">{a.text} {a.href && a.link_label ? <a href={localizeHref(a.href, locale)}>{a.link_label}</a> : null}</div>
          </div>
        ))}
        <Header
          locale={locale}
          logoSrc={logoSrc}
          logoAlt={site.settings.logo?.alt || site.settings.site_name}
          nav={maintenance ? [] : site.header}
          languages={site.languages.map((l) => ({ code: l.code, name: l.name, native_name: l.native_name }))}
          cta={{ label: t("nav.cta"), href: "/case-inquiry" }}
          labels={{ menu: t("nav.menu"), close: t("nav.close"), language: t("lang.label") }}
        />
        <main id="main">
          {maintenance ? (
            <section className="center-page"><div><h1>{site.settings.site_name}</h1><p className="lead">{site.settingsTr.maintenance_message}</p></div></section>
          ) : children}
        </main>
        <Footer site={site} logoSrc={logoSrc} t={t} />
        <Consent
          provider={site.settings.analytics_provider}
          analyticsId={site.settings.analytics_id}
          consentRequired={site.settings.cookie_consent_enabled}
          domain={new URL(siteOrigin(site.settings.site_url)).host}
          text={site.settingsTr.cookie_banner_text}
          acceptLabel={t("cookie.accept")}
          declineLabel={t("cookie.decline")}
        />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: organizationJsonLd(site) }} />
      </body>
    </html>
  );
}
