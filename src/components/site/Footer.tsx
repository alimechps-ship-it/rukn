import Link from "next/link";
import { localizeHref } from "@/lib/i18n";
import type { SiteData } from "@/lib/types";
import { Mail, MapPin, SocialIcon, WhatsAppIcon } from "@/components/icons";

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
            {settingsTr.location_text ? <p className="with-icon"><MapPin size={18} strokeWidth={1.8} aria-hidden="true" /><strong>{settingsTr.location_text}</strong></p> : null}
            {settings.social_links.length ? (
              <div className="social-row">
                {settings.social_links.map((s) => (
                  <a key={s.url} className="social-btn" href={s.url} target="_blank" rel="noopener noreferrer" aria-label={s.network} title={s.network}>
                    <SocialIcon url={s.url} name={s.network} />
                  </a>
                ))}
              </div>
            ) : null}
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
          {settings.contact_email || wa ? (
            <div>
              <h2>{t("footer.contact")}</h2>
              <ul>
                {settings.contact_email ? <li><a className="with-icon" href={`mailto:${settings.contact_email}`}><Mail size={17} strokeWidth={1.8} aria-hidden="true" /><bdi>{settings.contact_email}</bdi></a></li> : null}
                {wa ? <li><a className="with-icon" href={wa} rel="noopener noreferrer" target="_blank"><WhatsAppIcon size={17} />{t("contact.whatsapp")}</a></li> : null}
              </ul>
            </div>
          ) : null}
        </div>
        <div className="footer-bottom">
          <span>© {year} {settings.site_name}. {t("footer.rights")}</span>
          <ul>{site.legal.map((n) => <li key={n.id}><Link href={localizeHref(n.href, locale)}>{n.label}</Link></li>)}</ul>
        </div>
      </div>
      {wa ? (
        <a className="wa-float" href={wa} target="_blank" rel="noopener noreferrer" aria-label={t("contact.whatsapp")} title={t("contact.whatsapp")}>
          <WhatsAppIcon size={28} />
        </a>
      ) : null}
    </footer>
  );
}
