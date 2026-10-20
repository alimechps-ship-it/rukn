import Link from "next/link";
import { localizeHref } from "@/lib/i18n";
import type { SiteData } from "@/lib/types";

export function Footer({ site, logoSrc, t }: { site: SiteData; logoSrc: string; t: (k: string) => string }) {
  const { locale, settings, settingsTr } = site;
  const services = site.footer.filter((n) => n.href.startsWith("/services"));
  const company = site.footer.filter((n) => !n.href.startsWith("/services"));
  const year = new Date().getFullYear();
  const wa = settings.whatsapp_number ? `https://wa.me/${settings.whatsapp_number.replace(/\D/g, "")}` : null;
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoSrc} alt={settings.site_name} width={156} height={166} loading="lazy" />
            {settingsTr.footer_text ? <p>{settingsTr.footer_text}</p> : null}
            {settingsTr.location_text ? <p><strong>{settingsTr.location_text}</strong></p> : null}
          </div>
          {services.length ? (
            <div>
              <h2>{t("footer.services")}</h2>
              <ul>{services.map((n) => <li key={n.id}><Link href={localizeHref(n.href, locale)}>{n.label}</Link></li>)}</ul>
            </div>
          ) : null}
          {company.length ? (
            <div>
              <h2>{t("footer.company")}</h2>
              <ul>{company.map((n) => <li key={n.id}>{n.is_external ? <a href={n.href} rel="noopener noreferrer" target="_blank">{n.label}</a> : <Link href={localizeHref(n.href, locale)}>{n.label}</Link>}</li>)}</ul>
            </div>
          ) : null}
          {settings.contact_email || wa || settings.social_links.length ? (
            <div>
              <h2>{t("footer.contact")}</h2>
              <ul>
                {settings.contact_email ? <li><a href={`mailto:${settings.contact_email}`}><bdi>{settings.contact_email}</bdi></a></li> : null}
                {wa ? <li><a href={wa} rel="noopener noreferrer" target="_blank">{t("contact.whatsapp")}</a></li> : null}
                {settings.social_links.map((s) => (
                  <li key={s.url}><a href={s.url} rel="noopener noreferrer" target="_blank">{s.network}</a></li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div className="footer-bottom">
          <span>© {year} {settings.site_name}. {t("footer.rights")}</span>
          <ul>{site.legal.map((n) => <li key={n.id}><Link href={localizeHref(n.href, locale)}>{n.label}</Link></li>)}</ul>
        </div>
      </div>
    </footer>
  );
}
