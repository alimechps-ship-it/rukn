"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { localizeHref, switchLocalePath, LOCALE_COOKIE } from "@/lib/i18n";
import type { Language, NavItem } from "@/lib/types";

interface Props {
  locale: string;
  logoSrc: string;
  logoAlt: string;
  nav: NavItem[];
  languages: Pick<Language, "code" | "native_name" | "name">[];
  cta: { label: string; href: string };
  labels: { menu: string; close: string; language: string };
}

function rememberLocale(code: string) {
  document.cookie = `${LOCALE_COOKIE}=${code}; path=/; max-age=31536000; samesite=lax`;
}

export function Header({ locale, logoSrc, logoAlt, nav, languages, cta, labels }: Props) {
  const pathname = usePathname() || `/${locale}`;
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const isCurrent = (href: string) => {
    const full = localizeHref(href, locale);
    return pathname === full || (full !== `/${locale}` && pathname.startsWith(`${full}/`));
  };

  const LangSwitch = () => (
    <nav className="lang-switch" aria-label={labels.language}>
      {languages.map((l) => (
        <a
          key={l.code}
          href={switchLocalePath(pathname, l.code)}
          hrefLang={l.code}
          lang={l.code}
          aria-current={l.code === locale ? "true" : undefined}
          onClick={() => rememberLocale(l.code)}
          title={l.name}
        >
          {l.code === "ar" ? "عربي" : l.code.toUpperCase()}
        </a>
      ))}
    </nav>
  );

  return (
    <header className={`site-header${scrolled ? " scrolled" : ""}`}>
      <div className="container header-inner">
        <Link href={`/${locale}`} className="brand" aria-label={logoAlt}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} alt={logoAlt} width={156} height={166} />
        </Link>
        <nav className="main-nav" aria-label="Main">
          <ul>
            {nav.map((item) => (
              <li key={item.id}>
                <Link href={localizeHref(item.href, locale)} aria-current={isCurrent(item.href) ? "page" : undefined}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="header-actions">
          <LangSwitch />
          <Link className="btn btn-teal" href={localizeHref(cta.href, locale)}>{cta.label}</Link>
          <button type="button" className="menu-toggle" aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen(true)}>
            <span className="visually-hidden">{labels.menu}</span>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
          </button>
        </div>
      </div>
      <div id="mobile-menu" className="mobile-panel" hidden={!open} role="dialog" aria-modal="true" aria-label={labels.menu}>
        <div className="top">
          <Link href={`/${locale}`} className="brand" aria-label={logoAlt}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoSrc} alt={logoAlt} width={156} height={166} style={{ height: 44, width: "auto" }} />
          </Link>
          <button type="button" className="menu-toggle" style={{ display: "inline-flex" }} onClick={() => setOpen(false)}>
            <span className="visually-hidden">{labels.close}</span>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <ul>
          {nav.map((item) => (
            <li key={item.id}><Link href={localizeHref(item.href, locale)}>{item.label}</Link></li>
          ))}
        </ul>
        <LangSwitch />
        <Link className="btn btn-teal" href={localizeHref(cta.href, locale)}>{cta.label}</Link>
      </div>
    </header>
  );
}
