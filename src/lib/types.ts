export type Dir = "ltr" | "rtl";
export type PublishStatus = "draft" | "published" | "archived";
export type AppRole = "super_admin" | "content_manager" | "sales_manager" | "translator" | "case_manager" | "agent";
export type InquiryStatus = "new" | "in_review" | "contacted" | "qualified" | "converted" | "closed";
export type InquiryType = "contact" | "case" | "partnership";

export interface Language {
  code: string;
  name: string;
  native_name: string;
  dir: Dir;
  enabled: boolean;
  is_default: boolean;
  sort_order: number;
}

export interface MediaRow {
  id: string;
  bucket: string;
  path: string;
  variants: Record<string, string>;
  filename: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  category: string;
  is_brand_asset: boolean;
  is_illustrative: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  media_asset_translations?: { locale: string; alt_text: string; caption: string | null }[];
}

export interface Media {
  id: string;
  src: string;
  srcSet: string;
  width: number | null;
  height: number | null;
  alt: string;
  caption: string | null;
  isIllustrative: boolean;
}

export interface Item {
  title?: string;
  text?: string;
  icon?: string;
}

export interface SectionTr {
  eyebrow: string | null;
  heading: string | null;
  subheading: string | null;
  body: string | null;
  items: Item[];
  primary_label: string | null;
  primary_href: string | null;
  secondary_label: string | null;
  secondary_href: string | null;
}

export interface Section {
  id: string;
  key: string;
  type: string;
  settings: Record<string, unknown>;
  media: Media | null;
  tr: SectionTr;
}

export interface ServiceTr {
  title: string;
  nav_title: string | null;
  summary: string | null;
  description: string | null;
  features_heading: string | null;
  features: string[];
  workflow_heading: string | null;
  workflow: Item[];
  notice: string | null;
  cta_label: string | null;
  price_note: string | null;
  seo_title: string | null;
  seo_description: string | null;
  why_heading: string | null;
  why_patients: Item[];
  why_clinicians: Item[];
}

export interface Service {
  id: string;
  slug: string;
  is_featured: boolean;
  sort_order: number;
  cta_href: string | null;
  show_price: boolean;
  price_amount: number | null;
  price_currency: string | null;
  updated_at: string;
  media: Media | null;
  gallery: Media[];
  tr: ServiceTr;
}

export interface NavItem {
  id: string;
  href: string;
  label: string;
  is_external: boolean;
}

export interface SiteSettings {
  site_name: string;
  site_url: string | null;
  contact_email: string | null;
  whatsapp_number: string | null;
  country_code: string;
  social_links: { network: string; url: string }[];
  brand_colors: Record<string, string>;
  analytics_provider: "plausible" | "ga4" | null;
  analytics_id: string | null;
  cookie_consent_enabled: boolean;
  maintenance_mode: boolean;
  logo: Media | null;
  favicon: Media | null;
  ogImage: Media | null;
}

export interface SiteSettingsTr {
  tagline: string | null;
  location_text: string | null;
  business_hours: string | null;
  footer_text: string | null;
  case_submission_instructions: string | null;
  default_seo_title: string | null;
  default_seo_description: string | null;
  cookie_banner_text: string | null;
  maintenance_message: string | null;
}

export interface SiteData {
  locale: string;
  dir: Dir;
  defaultLocale: string;
  languages: Language[];
  settings: SiteSettings;
  settingsTr: SiteSettingsTr;
  header: NavItem[];
  footer: NavItem[];
  legal: NavItem[];
  announcements: { id: string; text: string; href: string | null; link_label: string | null }[];
  strings: Record<string, string>;
  preview: boolean;
}

export interface PageData {
  id: string;
  key: string;
  slug: string;
  template: string;
  needs_legal_review: boolean;
  updated_at: string;
  title: string;
  seo_title: string | null;
  seo_description: string | null;
  ogImage: Media | null;
  sections: Section[];
}

export interface Faq {
  id: string;
  question: string;
  answer: string;
}

export interface TeamMember {
  id: string;
  name: string;
  role_title: string | null;
  bio: string | null;
  linkedin_url: string | null;
  photo: Media | null;
}
