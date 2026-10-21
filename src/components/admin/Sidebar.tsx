"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity, FileText, HelpCircle, Image as ImageIcon, Inbox, Languages, LayoutDashboard, Megaphone, Menu as MenuIcon,
  Settings, Stethoscope, Trash2, UserCog, Users,
} from "lucide-react";

const ICONS: Record<string, typeof LayoutDashboard> = {
  "/admin": LayoutDashboard, "/admin/pages": FileText, "/admin/services": Stethoscope, "/admin/faqs": HelpCircle,
  "/admin/team": Users, "/admin/navigation": MenuIcon, "/admin/announcements": Megaphone, "/admin/strings": Languages,
  "/admin/media": ImageIcon, "/admin/trash": Trash2, "/admin/inquiries": Inbox, "/admin/settings": Settings,
  "/admin/users": UserCog, "/admin/activity": Activity,
};

export interface NavGroup { label: string; items: { href: string; label: string; badge?: number }[] }

export function Sidebar({ groups, user, signOut }: { groups: NavGroup[]; user: { email: string; roles: string }; signOut: () => Promise<void> }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`));
  return (
    <>
      <div className="mobile-bar">
        <strong>RUKN Admin</strong>
        <button type="button" onClick={() => setOpen(true)} aria-expanded={open}>Menu</button>
      </div>
      <aside className={`sidebar${open ? " open" : ""}`} onClick={(e) => { if ((e.target as HTMLElement).tagName === "A") setOpen(false); }}>
        <Link href="/admin" className="logo"><img src="/icon-192.png" alt="" />RUKN</Link>
        <nav aria-label="Admin">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="group">{g.label}</div>
              {g.items.map((it) => (
                <Link key={it.href} href={it.href} className="item" aria-current={active(it.href) ? "page" : undefined}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                    {(() => { const I = ICONS[it.href]; return I ? <I size={17} strokeWidth={1.8} aria-hidden="true" /> : null; })()}
                    {it.label}
                  </span>
                  {it.badge ? <span className="badge-count">{it.badge}</span> : null}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="me">
          <div>{user.email}</div>
          <div className="roles">{user.roles}</div>
          <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
            <Link href="/admin/account" style={{ color: "#9fd7e6" }}>Account</Link>
            <form action={signOut}><button type="submit">Sign out</button></form>
          </div>
          <a href="/en" target="_blank" rel="noopener" style={{ color: "#9fd7e6", display: "inline-block", marginTop: 8 }}>View website ↗</a>
        </div>
      </aside>
    </>
  );
}
