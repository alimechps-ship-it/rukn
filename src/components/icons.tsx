import type { ComponentType, SVGProps } from "react";
import {
  BadgeCheck, Briefcase, Building2, Check, ClipboardCheck, Clock, Compass, Eye, Factory, FileCheck2, FlaskConical,
  Globe, Handshake, Info, Languages, Layers, Lock, Mail, MapPin, Monitor, Route, Search, Send, Share2, ShieldCheck,
  Smile, Sparkles, Stethoscope, Target, Truck, Users, Workflow,
} from "lucide-react";
import { siFacebook, siInstagram, siPinterest, siSnapchat, siTelegram, siThreads, siTiktok, siWhatsapp, siX, siYoutube, siBehance } from "simple-icons";

type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>;

/** Icons an editor can choose for cards / benefits / values (key → component). */
export const ITEM_ICONS: Record<string, Icon> = {
  team: Users, digital: Monitor, clinician: Stethoscope, case: ClipboardCheck, languages: Languages, global: Globe,
  partnership: Handshake, quality: ShieldCheck, transparency: Eye, privacy: Lock, inquiry: Send, review: Search,
  records: FileCheck2, planning: Route, production: Factory, clinic: Building2, laboratory: FlaskConical,
  distribution: Truck, mission: Target, vision: Compass, workflow: Workflow, layers: Layers, smile: Smile,
  sparkles: Sparkles, check: BadgeCheck,
};
export const ITEM_ICON_KEYS = Object.keys(ITEM_ICONS);

// Automatic choice from the item title (English + Arabic) when no icon was picked.
const KEYWORDS: [RegExp, string][] = [
  [/multidisciplin|team|فريق/i, "team"],
  [/privacy|secure|خصوصي|آمن/i, "privacy"],
  [/transparen|شفاف/i, "transparency"],
  [/responsib|مسؤولي/i, "quality"],
  [/clinician|dentist|orthodont|طبيب|أطباء|أخصائي/i, "clinician"],
  [/approv|اعتماد/i, "check"],
  [/inquiry|استفسار/i, "inquiry"],
  [/review|مراجعة/i, "review"],
  [/record|سجلات/i, "records"],
  [/planning|تخطيط/i, "planning"],
  [/production|manufactur|إنتاج|تصنيع/i, "production"],
  [/digital|رقمي/i, "digital"],
  [/case|حالة/i, "case"],
  [/english|arabic|language|العربية|الإنجليزية/i, "languages"],
  [/clinic|عيادات|عيادة/i, "clinic"],
  [/laborator|معامل|معمل/i, "laboratory"],
  [/distribut|موزع/i, "distribution"],
  [/border|international|global|world|provider|حدود|دولي|عالمي|مقدمو/i, "global"],
  [/collaborat|partner|تعاون|شراك/i, "partnership"],
  [/mission|رسالت/i, "mission"],
  [/vision|رؤي/i, "vision"],
];

export function itemIcon(explicit: string | undefined, title: string | undefined): Icon {
  if (explicit && ITEM_ICONS[explicit]) return ITEM_ICONS[explicit];
  for (const [re, key] of KEYWORDS) if (title && re.test(title)) return ITEM_ICONS[key];
  return BadgeCheck;
}

export function serviceIcon(slug: string): Icon {
  if (/plan/.test(slug)) return Monitor;
  if (/retainer/.test(slug)) return ShieldCheck;
  if (/aligner/.test(slug)) return Smile;
  if (/snap|aesthetic|smile/.test(slug)) return Sparkles;
  return Layers;
}

export { Check, Clock, Info, Mail, MapPin, Share2 };

// ---- Social networks (official marks from the CC0 "simple-icons" set) ------------------
type Brand = { title: string; path: string; hex: string };
const BRANDS: Record<string, Brand> = {
  "facebook.com": siFacebook, "fb.com": siFacebook, "instagram.com": siInstagram, "x.com": siX, "twitter.com": siX,
  "youtube.com": siYoutube, "youtu.be": siYoutube, "tiktok.com": siTiktok, "t.me": siTelegram, "telegram.me": siTelegram,
  "snapchat.com": siSnapchat, "threads.net": siThreads, "pinterest.com": siPinterest, "behance.net": siBehance,
  "wa.me": siWhatsapp, "whatsapp.com": siWhatsapp,
};

export function socialInfo(url: string, fallbackName: string) {
  let host = "";
  try { host = new URL(url).hostname.replace(/^(www|m|web)\./, ""); } catch { /* ignore */ }
  const brand = BRANDS[host];
  return { brand, isLinkedIn: /linkedin\.com$/.test(host), name: brand?.title ?? (/linkedin/.test(host) ? "LinkedIn" : fallbackName) };
}

export function SocialIcon({ url, name, size = 18 }: { url: string; name: string; size?: number }) {
  const { brand, isLinkedIn } = socialInfo(url, name);
  if (brand) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={brand.path} />
      </svg>
    );
  }
  const Fallback = isLinkedIn ? Briefcase : Globe;
  return <Fallback size={size} strokeWidth={1.8} aria-hidden="true" />;
}

export function WhatsAppIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={siWhatsapp.path} />
    </svg>
  );
}
