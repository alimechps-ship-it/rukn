"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowLeftRight, BarChart3, BellRing, BookOpen, Building2, Calculator, ChevronDown, ExternalLink, Factory, FilePlus2, FileSpreadsheet, FileText,
  FolderKanban, HandCoins, HelpCircle, Image as ImageIcon, Inbox, Languages, LayoutDashboard, ListTree, LogOut, Megaphone, Menu as MenuIcon, PanelLeftClose,
  PanelLeftOpen, Receipt, ScrollText, Search, Settings, Sparkles, Stethoscope, Tags, Trash2, UserCog, UserRound, Users, Wallet, X,
} from "lucide-react";

const ICONS: Record<string, typeof LayoutDashboard> = {
  "/admin": LayoutDashboard, "/admin/pages": FileText, "/admin/services": Stethoscope, "/admin/faqs": HelpCircle,
  "/admin/team": Users, "/admin/navigation": MenuIcon, "/admin/announcements": Megaphone, "/admin/strings": Languages,
  "/admin/media": ImageIcon, "/admin/trash": Trash2, "/admin/inquiries": Inbox, "/admin/settings": Settings,
  "/admin/users": UserCog, "/admin/activity": Activity,
  "/admin/cases": FolderKanban, "/admin/cases/new": FilePlus2, "/admin/reports": BarChart3, "/admin/price-list": Tags,
  "/admin/finance/receivables": Receipt, "/admin/finance/cash": Wallet, "/admin/finance/people": HandCoins, "/admin/finance/notices": BellRing,
  "/admin/statement": ScrollText, "/admin/assistant": Sparkles, "/admin/partners": Building2, "/admin/work": Factory,
  "/admin/partner-bills": FileSpreadsheet, "/admin/partner-statement": ScrollText, "/admin/finance/to-price": Calculator,
  "/admin/finance/journal": BookOpen, "/admin/finance/accounts": ListTree, "/admin/finance/rates": ArrowLeftRight,
};

export interface NavItem { href: string; label: string; ar?: string; badge?: number }
export interface NavGroup { key: string; label: string; ar?: string; items: NavItem[] }

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const norm = (s: string) => s.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");

export function Sidebar({ groups, user, signOut }: {
  groups: NavGroup[]; user: { email: string; name: string; roles: string }; signOut: () => Promise<void>;
}) {
  const path = usePathname();
  const [mobile, setMobile] = useState(false);
  const [mini, setMini] = useState(false);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");

  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  const matches = (href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`));
  const active = (href: string) => matches(href) && !hrefs.some((h) => h.length > href.length && h.startsWith(href) && matches(h));
  const activeGroup = groups.find((g) => g.items.some((i) => active(i.href)))?.key;

  useEffect(() => {
    setMini(store.get("rukn.nav.mini") === "1");
    try { setClosed(JSON.parse(store.get("rukn.nav.closed") ?? "{}")); } catch { /* ignore */ }
  }, []);
  useEffect(() => { document.documentElement.dataset.nav = mini ? "mini" : "full"; }, [mini]);
  useEffect(() => { setMobile(false); }, [path]);

  const toggleGroup = (k: string) => setClosed((c) => { const n = { ...c, [k]: !c[k] }; store.set("rukn.nav.closed", JSON.stringify(n)); return n; });
  const toggleMini = () => setMini((m) => { store.set("rukn.nav.mini", m ? "0" : "1"); return !m; });

  const filtered = useMemo(() => {
    const t = norm(q.trim());
    if (!t) return groups;
    return groups.map((g) => ({ ...g, items: g.items.filter((i) => norm(`${i.label} ${i.ar ?? ""} ${g.label} ${g.ar ?? ""}`).includes(t)) })).filter((g) => g.items.length);
  }, [q, groups]);
  const initials = (user.name || user.email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");

  return (
    <>
      <header className="mobile-bar">
        <button type="button" className="nav-icon-btn" onClick={() => setMobile(true)} aria-label="Open menu" aria-expanded={mobile}><MenuIcon size={20} /></button>
        <Link href="/admin" className="mobile-brand"><img src="/icon-192.png" alt="" />RUKN</Link>
        <span className="mobile-avatar" aria-hidden="true">{initials}</span>
      </header>
      {mobile ? <div className="nav-scrim" onClick={() => setMobile(false)} aria-hidden="true" /> : null}

      <aside className={`sidebar${mobile ? " open" : ""}${mini ? " mini" : ""}`} aria-label="Main menu">
        <div className="side-head">
          <Link href="/admin" className="logo" title="RUKN">
            <img src="/icon-192.png" alt="" />
            <span className="logo-text"><strong>RUKN</strong><small>Back office · لوحة التحكم</small></span>
          </Link>
          <button type="button" className="nav-icon-btn only-desktop" onClick={toggleMini} aria-label={mini ? "Expand menu" : "Collapse menu"} title={mini ? "Expand menu" : "Collapse menu"}>
            {mini ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <button type="button" className="nav-icon-btn only-mobile" onClick={() => setMobile(false)} aria-label="Close menu"><X size={18} /></button>
        </div>

        <label className="side-search">
          <Search size={15} aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a page · ابحث عن صفحة" aria-label="Find a page" />
        </label>

        <nav className="side-nav" aria-label="Admin">
          {filtered.map((g) => {
            const isClosed = !q && closed[g.key] && g.key !== activeGroup;
            const count = g.items.reduce((a, i) => a + (i.badge ?? 0), 0);
            return (
              <section key={g.key} className={`nav-group${isClosed ? " closed" : ""}`}>
                {g.items.length > 1 || g.key !== "overview" ? (
                  <button type="button" className="group-head" onClick={() => toggleGroup(g.key)} aria-expanded={!isClosed}>
                    <span className="group-label">{g.label}{g.ar ? <span className="ar"> · {g.ar}</span> : null}</span>
                    {isClosed && count ? <span className="badge-count">{count}</span> : null}
                    <ChevronDown size={14} className="chev" aria-hidden="true" />
                  </button>
                ) : null}
                <div className="group-items">
                  {g.items.map((it) => {
                    const I = ICONS[it.href];
                    return (
                      <Link key={it.href} href={it.href} className="item" aria-current={active(it.href) ? "page" : undefined} title={mini ? `${it.label}${it.ar ? ` · ${it.ar}` : ""}` : undefined}>
                        <span className="item-icon">{I ? <I size={18} strokeWidth={1.8} aria-hidden="true" /> : null}{mini && it.badge ? <span className="dot" /> : null}</span>
                        <span className="item-text">
                          <span className="item-label">{it.label}</span>
                          {it.ar ? <span className="item-ar">{it.ar}</span> : null}
                        </span>
                        {it.badge ? <span className="badge-count">{it.badge > 99 ? "99+" : it.badge}</span> : null}
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {!filtered.length ? <p className="side-empty">No page matches “{q}”.</p> : null}
        </nav>

        <div className="me">
          <div className="me-row">
            <span className="avatar" aria-hidden="true">{initials}</span>
            <span className="me-text">
              <strong title={user.email}>{user.name || user.email}</strong>
              <small>{user.roles}</small>
            </span>
          </div>
          <div className="me-actions">
            <Link href="/admin/account" className="me-btn" title="My account"><UserRound size={16} /><span>Account</span></Link>
            <a href="/en" target="_blank" rel="noopener" className="me-btn" title="View website"><ExternalLink size={16} /><span>Website</span></a>
            <form action={signOut}><button type="submit" className="me-btn" title="Sign out"><LogOut size={16} /><span>Sign out</span></button></form>
          </div>
        </div>
      </aside>
    </>
  );
}
