-- =====================================================================
-- RUKN — core schema
-- PostgreSQL / Supabase. All primary keys are UUIDs unless the natural
-- key is a short code (languages) or a singleton (site settings).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------
create type public.app_role as enum ('super_admin', 'content_manager', 'sales_manager', 'translator');
create type public.publish_status as enum ('draft', 'published', 'archived');
create type public.content_variant as enum ('draft', 'published');
create type public.inquiry_status as enum ('new', 'in_review', 'contacted', 'qualified', 'converted', 'closed');
create type public.inquiry_type as enum ('contact', 'case', 'partnership');

-- ---------------------------------------------------------------------
-- Generic updated_at trigger
-- ---------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Languages (add a row to add a language — no rebuild needed)
-- ---------------------------------------------------------------------
create table public.languages (
  code        text primary key check (code ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  name        text not null check (char_length(name) between 1 and 60),
  native_name text not null check (char_length(native_name) between 1 and 60),
  dir         text not null default 'ltr' check (dir in ('ltr', 'rtl')),
  enabled     boolean not null default true,
  is_default  boolean not null default false,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index languages_single_default on public.languages (is_default) where is_default;
create trigger languages_updated before update on public.languages for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- Staff profiles and roles (private)
-- ---------------------------------------------------------------------
create table public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  email           text not null,
  full_name       text check (char_length(full_name) <= 120),
  is_active       boolean not null default true,
  allowed_locales text[] not null default '{}',     -- used by the translator role
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger profiles_updated before update on public.profiles for each row execute function public.tg_set_updated_at();

create table public.user_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       public.app_role not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  unique (user_id, role)
);
create index user_roles_user_idx on public.user_roles (user_id);

-- ---------------------------------------------------------------------
-- Media library (files live in Supabase Storage bucket "media")
-- ---------------------------------------------------------------------
create table public.media_assets (
  id              uuid primary key default gen_random_uuid(),
  bucket          text not null default 'media',
  path            text not null,                        -- original (optimised) object path
  variants        jsonb not null default '{}'::jsonb,  -- {"480": "path", "960": "path", ...}
  filename        text not null check (char_length(filename) between 1 and 200),
  mime_type       text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
  size_bytes      int not null check (size_bytes > 0 and size_bytes <= 15728640),
  width           int check (width > 0),
  height          int check (height > 0),
  category        text not null default 'general' check (category in ('brand', 'treatment-planning', 'aligners', 'retainers', 'snap-on', 'team', 'general')),
  is_brand_asset  boolean not null default false,
  is_illustrative boolean not null default false,       -- shows an "Illustrative image" label publicly
  uploaded_by     uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (bucket, path)
);
create index media_assets_category_idx on public.media_assets (category) where deleted_at is null;
create trigger media_assets_updated before update on public.media_assets for each row execute function public.tg_set_updated_at();

create table public.media_asset_translations (
  media_id   uuid not null references public.media_assets (id) on delete cascade,
  locale     text not null references public.languages (code) on update cascade on delete cascade,
  alt_text   text not null default '' check (char_length(alt_text) <= 300),
  caption    text check (char_length(caption) <= 300),
  updated_at timestamptz not null default now(),
  primary key (media_id, locale)
);
create trigger media_asset_translations_updated before update on public.media_asset_translations for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- Site settings (public singleton) + private settings (staff only)
-- ---------------------------------------------------------------------
create table public.site_settings (
  id                     int primary key default 1 check (id = 1),
  site_name              text not null default 'RUKN' check (char_length(site_name) between 1 and 80),
  site_url               text check (site_url is null or site_url ~ '^https?://'),
  logo_media_id          uuid references public.media_assets (id) on delete set null,
  favicon_media_id       uuid references public.media_assets (id) on delete set null,
  og_image_media_id      uuid references public.media_assets (id) on delete set null,
  contact_email          text check (contact_email is null or contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  whatsapp_number        text check (whatsapp_number is null or whatsapp_number ~ '^\+[1-9][0-9]{6,14}$'),
  country_code           text not null default 'EG' check (country_code ~ '^[A-Z]{2}$'),
  social_links           jsonb not null default '[]'::jsonb,   -- [{"network":"linkedin","url":"https://..."}]
  brand_colors           jsonb not null default '{"navy":"#10263D","teal":"#16809A","white":"#FFFFFF","light":"#F3F7FA","text":"#1D2939"}'::jsonb,
  analytics_provider     text check (analytics_provider in ('plausible', 'ga4')),
  analytics_id           text check (analytics_id is null or analytics_id ~ '^[A-Za-z0-9._-]{3,80}$'),
  cookie_consent_enabled boolean not null default true,
  maintenance_mode       boolean not null default false,
  updated_at             timestamptz not null default now()
);
create trigger site_settings_updated before update on public.site_settings for each row execute function public.tg_set_updated_at();

create table public.site_settings_translations (
  locale                        text primary key references public.languages (code) on update cascade on delete cascade,
  tagline                       text check (char_length(tagline) <= 200),
  location_text                 text check (char_length(location_text) <= 200),
  business_hours                text check (char_length(business_hours) <= 400),
  footer_text                   text check (char_length(footer_text) <= 600),
  case_submission_instructions  text check (char_length(case_submission_instructions) <= 2000),
  default_seo_title             text check (char_length(default_seo_title) <= 120),
  default_seo_description       text check (char_length(default_seo_description) <= 320),
  cookie_banner_text            text check (char_length(cookie_banner_text) <= 600),
  maintenance_message           text check (char_length(maintenance_message) <= 600),
  updated_at                    timestamptz not null default now()
);
create trigger site_settings_translations_updated before update on public.site_settings_translations for each row execute function public.tg_set_updated_at();

create table public.private_settings (
  id                     int primary key default 1 check (id = 1),
  notifications_enabled  boolean not null default false,
  notification_emails    text[] not null default '{}',
  notify_on_types        public.inquiry_type[] not null default '{contact,case,partnership}',
  updated_at             timestamptz not null default now()
);
create trigger private_settings_updated before update on public.private_settings for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- Pages and their sections (draft / published variants per locale)
-- ---------------------------------------------------------------------
create table public.pages (
  id                uuid primary key default gen_random_uuid(),
  key               text not null unique check (key ~ '^[a-z0-9-]{2,60}$'),   -- stable internal key: home, about, ...
  slug              text not null unique check (slug ~ '^[a-z0-9-]{0,80}$'),  -- '' for home
  template          text not null default 'standard' check (template in ('home', 'standard', 'about', 'partnerships', 'contact', 'legal', 'case')),
  status            public.publish_status not null default 'draft',
  show_in_sitemap   boolean not null default true,
  needs_legal_review boolean not null default false,
  og_image_media_id uuid references public.media_assets (id) on delete set null,
  sort_order        int not null default 0,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create trigger pages_updated before update on public.pages for each row execute function public.tg_set_updated_at();

create table public.page_translations (
  page_id         uuid not null references public.pages (id) on delete cascade,
  locale          text not null references public.languages (code) on update cascade on delete cascade,
  variant         public.content_variant not null default 'draft',
  title           text not null check (char_length(title) between 1 and 160),
  seo_title       text check (char_length(seo_title) <= 120),
  seo_description text check (char_length(seo_description) <= 320),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles (id) on delete set null,
  primary key (page_id, locale, variant)
);
create trigger page_translations_updated before update on public.page_translations for each row execute function public.tg_set_updated_at();

create table public.content_sections (
  id           uuid primary key default gen_random_uuid(),
  page_id      uuid not null references public.pages (id) on delete cascade,
  key          text not null check (key ~ '^[a-z0-9-]{2,60}$'),
  type         text not null check (type in ('hero', 'rich_text', 'cards', 'steps', 'benefits', 'services_grid', 'gallery', 'faq', 'cta', 'team', 'image_text', 'contact_details', 'inquiry_form', 'notice')),
  status       public.publish_status not null default 'draft',
  sort_order   int not null default 0,
  media_id     uuid references public.media_assets (id) on delete set null,
  settings     jsonb not null default '{}'::jsonb,   -- non-translatable options (e.g. form type, background)
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  unique (page_id, key)
);
create index content_sections_page_idx on public.content_sections (page_id, sort_order) where deleted_at is null;
create trigger content_sections_updated before update on public.content_sections for each row execute function public.tg_set_updated_at();

create table public.content_section_translations (
  section_id       uuid not null references public.content_sections (id) on delete cascade,
  locale           text not null references public.languages (code) on update cascade on delete cascade,
  variant          public.content_variant not null default 'draft',
  eyebrow          text check (char_length(eyebrow) <= 120),
  heading          text check (char_length(heading) <= 200),
  subheading       text check (char_length(subheading) <= 400),
  body             text check (char_length(body) <= 8000),
  items            jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),   -- [{"title":"..","text":".."}]
  primary_label    text check (char_length(primary_label) <= 80),
  primary_href     text check (char_length(primary_href) <= 300),
  secondary_label  text check (char_length(secondary_label) <= 80),
  secondary_href   text check (char_length(secondary_href) <= 300),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles (id) on delete set null,
  primary key (section_id, locale, variant)
);
create trigger content_section_translations_updated before update on public.content_section_translations for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- Services
-- ---------------------------------------------------------------------
create table public.services (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  status         public.publish_status not null default 'draft',
  sort_order     int not null default 0,
  is_featured    boolean not null default false,
  main_media_id  uuid references public.media_assets (id) on delete set null,
  cta_href       text check (char_length(cta_href) <= 300),
  show_price     boolean not null default false,
  price_amount   numeric(12, 2) check (price_amount is null or price_amount >= 0),
  price_currency text check (price_currency is null or price_currency ~ '^[A-Z]{3}$'),
  published_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  constraint price_complete check (not show_price or (price_amount is not null and price_currency is not null))
);
create trigger services_updated before update on public.services for each row execute function public.tg_set_updated_at();

create table public.service_translations (
  service_id      uuid not null references public.services (id) on delete cascade,
  locale          text not null references public.languages (code) on update cascade on delete cascade,
  variant         public.content_variant not null default 'draft',
  title           text not null check (char_length(title) between 1 and 160),     -- page headline
  nav_title       text check (char_length(nav_title) <= 80),                      -- short name for menus/cards
  summary         text check (char_length(summary) <= 400),
  description     text check (char_length(description) <= 4000),
  features_heading text check (char_length(features_heading) <= 160),
  features        jsonb not null default '[]'::jsonb check (jsonb_typeof(features) = 'array'),   -- ["..", ".."]
  workflow_heading text check (char_length(workflow_heading) <= 160),
  workflow        jsonb not null default '[]'::jsonb check (jsonb_typeof(workflow) = 'array'),   -- [{"title":"..","text":".."}]
  notice          text check (char_length(notice) <= 600),
  cta_label       text check (char_length(cta_label) <= 80),
  price_note      text check (char_length(price_note) <= 200),
  seo_title       text check (char_length(seo_title) <= 120),
  seo_description text check (char_length(seo_description) <= 320),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles (id) on delete set null,
  primary key (service_id, locale, variant)
);
create trigger service_translations_updated before update on public.service_translations for each row execute function public.tg_set_updated_at();

create table public.service_images (
  id         uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services (id) on delete cascade,
  media_id   uuid not null references public.media_assets (id) on delete restrict,
  sort_order int not null default 0,
  is_hidden  boolean not null default false,
  created_at timestamptz not null default now(),
  unique (service_id, media_id)
);
create index service_images_service_idx on public.service_images (service_id, sort_order);

-- ---------------------------------------------------------------------
-- FAQs, team, navigation, announcements
-- ---------------------------------------------------------------------
create table public.faqs (
  id         uuid primary key default gen_random_uuid(),
  topic      text not null default 'general' check (topic ~ '^[a-z0-9-]{2,40}$'),
  status     public.publish_status not null default 'draft',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger faqs_updated before update on public.faqs for each row execute function public.tg_set_updated_at();

create table public.faq_translations (
  faq_id     uuid not null references public.faqs (id) on delete cascade,
  locale     text not null references public.languages (code) on update cascade on delete cascade,
  question   text not null check (char_length(question) between 1 and 300),
  answer     text not null check (char_length(answer) between 1 and 3000),
  updated_at timestamptz not null default now(),
  primary key (faq_id, locale)
);
create trigger faq_translations_updated before update on public.faq_translations for each row execute function public.tg_set_updated_at();

create table public.team_members (
  id             uuid primary key default gen_random_uuid(),
  status         public.publish_status not null default 'draft',
  sort_order     int not null default 0,
  photo_media_id uuid references public.media_assets (id) on delete set null,
  linkedin_url   text check (linkedin_url is null or linkedin_url ~ '^https://'),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create trigger team_members_updated before update on public.team_members for each row execute function public.tg_set_updated_at();

create table public.team_member_translations (
  member_id  uuid not null references public.team_members (id) on delete cascade,
  locale     text not null references public.languages (code) on update cascade on delete cascade,
  name       text not null check (char_length(name) between 1 and 120),
  role_title text check (char_length(role_title) <= 120),
  bio        text check (char_length(bio) <= 1500),
  updated_at timestamptz not null default now(),
  primary key (member_id, locale)
);
create trigger team_member_translations_updated before update on public.team_member_translations for each row execute function public.tg_set_updated_at();

create table public.navigation_items (
  id         uuid primary key default gen_random_uuid(),
  location   text not null check (location in ('header', 'footer', 'footer_legal')),
  href       text not null check (char_length(href) between 1 and 300),
  is_visible boolean not null default true,
  is_external boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index navigation_items_loc_idx on public.navigation_items (location, sort_order);
create trigger navigation_items_updated before update on public.navigation_items for each row execute function public.tg_set_updated_at();

create table public.navigation_item_translations (
  item_id    uuid not null references public.navigation_items (id) on delete cascade,
  locale     text not null references public.languages (code) on update cascade on delete cascade,
  label      text not null check (char_length(label) between 1 and 80),
  updated_at timestamptz not null default now(),
  primary key (item_id, locale)
);
create trigger navigation_item_translations_updated before update on public.navigation_item_translations for each row execute function public.tg_set_updated_at();

create table public.announcements (
  id         uuid primary key default gen_random_uuid(),
  status     public.publish_status not null default 'draft',
  href       text check (char_length(href) <= 300),
  starts_at  timestamptz,
  ends_at    timestamptz,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create trigger announcements_updated before update on public.announcements for each row execute function public.tg_set_updated_at();

create table public.announcement_translations (
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  locale          text not null references public.languages (code) on update cascade on delete cascade,
  text            text not null check (char_length(text) between 1 and 300),
  link_label      text check (char_length(link_label) <= 60),
  updated_at      timestamptz not null default now(),
  primary key (announcement_id, locale)
);

-- ---------------------------------------------------------------------
-- Interface strings (form labels, buttons, small UI text) per locale
-- ---------------------------------------------------------------------
create table public.translations (
  id         uuid primary key default gen_random_uuid(),
  namespace  text not null check (namespace ~ '^[a-z0-9_]{2,40}$'),
  key        text not null check (key ~ '^[a-z0-9_.]{2,80}$'),
  locale     text not null references public.languages (code) on update cascade on delete cascade,
  value      text not null check (char_length(value) <= 2000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  unique (namespace, key, locale)
);
create trigger translations_updated before update on public.translations for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- Inquiries (private) — never exposed to anonymous reads
-- ---------------------------------------------------------------------
create table public.inquiries (
  id                uuid primary key default gen_random_uuid(),
  type              public.inquiry_type not null,
  status            public.inquiry_status not null default 'new',
  name              text not null check (char_length(name) between 2 and 120),
  email             text not null check (char_length(email) <= 200 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  country           text check (char_length(country) <= 80),
  organization      text check (char_length(organization) <= 160),
  professional_role text check (char_length(professional_role) <= 80),
  phone             text check (char_length(phone) <= 40),
  service_id        uuid references public.services (id) on delete set null,
  service_label     text check (char_length(service_label) <= 160),
  message           text check (char_length(message) <= 4000),
  locale            text check (char_length(locale) <= 10),
  source_path       text check (char_length(source_path) <= 300),
  consent           boolean not null default false,
  client_key        text check (char_length(client_key) <= 128),   -- salted hash of IP, never the raw IP
  assigned_to       uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (consent)
);
create index inquiries_created_idx on public.inquiries (created_at desc);
create index inquiries_status_idx on public.inquiries (status);
create index inquiries_type_idx on public.inquiries (type);
create index inquiries_email_idx on public.inquiries (lower(email));
create trigger inquiries_updated before update on public.inquiries for each row execute function public.tg_set_updated_at();

create table public.inquiry_notes (
  id         uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries (id) on delete cascade,
  author_id  uuid references public.profiles (id) on delete set null,
  body       text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index inquiry_notes_inquiry_idx on public.inquiry_notes (inquiry_id, created_at);

-- ---------------------------------------------------------------------
-- Audit log (written only by triggers)
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  summary     text,
  created_at  timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
