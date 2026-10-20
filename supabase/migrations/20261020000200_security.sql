-- =====================================================================
-- RUKN — authorization helpers, Row Level Security, triggers, RPCs
-- Every exposed table has RLS enabled with explicit policies for
-- SELECT / INSERT / UPDATE / DELETE. Absence of a policy = denied.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Role helpers (SECURITY DEFINER so they can read user_roles under RLS)
-- ---------------------------------------------------------------------
create or replace function public.current_app_roles()
returns public.app_role[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(r.role), '{}')
  from public.user_roles r
  join public.profiles p on p.id = r.user_id and p.is_active
  where r.user_id = auth.uid();
$$;

create or replace function public.has_role(p_role public.app_role)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_role = any (public.current_app_roles());
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select cardinality(public.current_app_roles()) > 0;
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.has_role('super_admin');
$$;

create or replace function public.can_manage_content()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_app_roles() && array['super_admin', 'content_manager']::public.app_role[];
$$;

create or replace function public.can_manage_inquiries()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_app_roles() && array['super_admin', 'sales_manager']::public.app_role[];
$$;

-- Content managers may edit every locale; translators only their permitted locales.
create or replace function public.can_translate(p_locale text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.can_manage_content()
      or (public.has_role('translator') and exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.is_active and p_locale = any (p.allowed_locales)));
$$;

revoke all on function public.current_app_roles() from public;
grant execute on function public.current_app_roles(), public.has_role(public.app_role), public.is_staff(),
  public.is_super_admin(), public.can_manage_content(), public.can_manage_inquiries(), public.can_translate(text)
  to anon, authenticated;

-- ---------------------------------------------------------------------
-- Profiles: created automatically for every new auth user (with NO role).
-- Public sign-up must be disabled in Supabase Auth; even if it is not,
-- a user without a role has no access to anything private.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Non-super-admins may only change their own display name.
create or replace function public.tg_guard_profile_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not public.is_super_admin() then
    new.email := old.email;
    new.is_active := old.is_active;
    new.allowed_locales := old.allowed_locales;
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles for each row execute function public.tg_guard_profile_update();

-- Never allow the last active super administrator to be removed or deactivated.
create or replace function public.tg_keep_one_super_admin()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare remaining int;
begin
  select count(*) into remaining
  from public.user_roles r join public.profiles p on p.id = r.user_id
  where r.role = 'super_admin' and p.is_active;
  if remaining = 0 then
    raise exception 'At least one active Super Administrator is required' using errcode = 'P0001';
  end if;
  return null;
end $$;

create constraint trigger user_roles_keep_super_admin
  after delete or update on public.user_roles
  deferrable initially deferred
  for each row when (old.role = 'super_admin')
  execute function public.tg_keep_one_super_admin();

create constraint trigger profiles_keep_super_admin
  after update of is_active on public.profiles
  deferrable initially deferred
  for each row when (old.is_active and not new.is_active)
  execute function public.tg_keep_one_super_admin();

-- First administrator bootstrap — callable only from the SQL editor / service role.
create or replace function public.bootstrap_super_admin(p_email text)
returns uuid language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then
    raise exception 'No auth user with email % — invite or create the user in Supabase Auth first', p_email;
  end if;
  insert into public.profiles (id, email) values (uid, p_email) on conflict (id) do nothing;
  update public.profiles set is_active = true where id = uid;
  insert into public.user_roles (user_id, role) values (uid, 'super_admin') on conflict do nothing;
  return uid;
end $$;
revoke all on function public.bootstrap_super_admin(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Audit trail (trigger-written only; no PII from inquiries is stored)
-- ---------------------------------------------------------------------
create or replace function public.tg_audit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  rec jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  old_rec jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  eid text;
  summary text;
begin
  eid := coalesce(rec ->> 'id', rec ->> 'page_id', rec ->> 'section_id', rec ->> 'service_id', rec ->> 'faq_id',
                  rec ->> 'member_id', rec ->> 'item_id', rec ->> 'media_id', rec ->> 'announcement_id',
                  rec ->> 'inquiry_id', rec ->> 'user_id', rec ->> 'locale');
  summary := concat_ws(' · ',
    rec ->> 'key', rec ->> 'slug', rec ->> 'filename', rec ->> 'role',
    case when rec ? 'locale' then 'locale ' || (rec ->> 'locale') end,
    case when rec ? 'variant' then rec ->> 'variant' end,
    case when old_rec is not null and (old_rec ->> 'status') is distinct from (rec ->> 'status')
         then 'status ' || coalesce(old_rec ->> 'status', '∅') || ' → ' || coalesce(rec ->> 'status', '∅') end,
    case when old_rec is not null and (old_rec ->> 'deleted_at') is null and (rec ->> 'deleted_at') is not null then 'moved to trash' end,
    case when old_rec is not null and (old_rec ->> 'deleted_at') is not null and (rec ->> 'deleted_at') is null then 'restored' end);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, summary)
  values (auth.uid(), lower(tg_op), tg_table_name, eid, nullif(summary, ''));
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'languages','profiles','user_roles','media_assets','media_asset_translations','site_settings','site_settings_translations',
    'private_settings','pages','page_translations','content_sections','content_section_translations','services',
    'service_translations','service_images','faqs','faq_translations','team_members','team_member_translations',
    'navigation_items','navigation_item_translations','announcements','announcement_translations','translations',
    'inquiry_notes']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.tg_audit()', t || '_audit', t);
  end loop;
end $$;
-- Inquiries: log staff updates and deletions only (public submissions are counted on the dashboard instead).
create trigger inquiries_audit after update or delete on public.inquiries for each row execute function public.tg_audit();

-- ---------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'languages','profiles','user_roles','media_assets','media_asset_translations','site_settings','site_settings_translations',
    'private_settings','pages','page_translations','content_sections','content_section_translations','services',
    'service_translations','service_images','faqs','faq_translations','team_members','team_member_translations',
    'navigation_items','navigation_item_translations','announcements','announcement_translations','translations',
    'inquiries','inquiry_notes','audit_logs']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Private tables are not reachable by the anonymous role at all (defence in depth).
revoke all on public.inquiries, public.inquiry_notes, public.profiles, public.user_roles,
              public.private_settings, public.audit_logs from anon;

-- ---------------------------------------------------------------------
-- Visibility helpers for public content
-- ---------------------------------------------------------------------
create or replace function public.page_is_public(p_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.pages where id = p_id and status = 'published' and deleted_at is null);
$$;
create or replace function public.section_is_public(p_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.content_sections s join public.pages p on p.id = s.page_id
                 where s.id = p_id and s.status = 'published' and s.deleted_at is null
                   and p.status = 'published' and p.deleted_at is null);
$$;
create or replace function public.service_is_public(p_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.services where id = p_id and status = 'published' and deleted_at is null);
$$;
grant execute on function public.page_is_public(uuid), public.section_is_public(uuid), public.service_is_public(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------

-- languages
create policy languages_select on public.languages for select to anon, authenticated using (enabled or public.is_staff());
create policy languages_insert on public.languages for insert to authenticated with check (public.is_super_admin());
create policy languages_update on public.languages for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
create policy languages_delete on public.languages for delete to authenticated using (public.is_super_admin() and not is_default);

-- profiles (staff can see colleagues for assignment; only super admin manages)
create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid() or public.is_staff());
create policy profiles_insert on public.profiles for insert to authenticated with check (public.is_super_admin());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid() or public.is_super_admin()) with check (id = auth.uid() or public.is_super_admin());
create policy profiles_delete on public.profiles for delete to authenticated using (public.is_super_admin() and id <> auth.uid());

-- user_roles
create policy user_roles_select on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_super_admin());
create policy user_roles_insert on public.user_roles for insert to authenticated with check (public.is_super_admin());
create policy user_roles_update on public.user_roles for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
create policy user_roles_delete on public.user_roles for delete to authenticated using (public.is_super_admin());

-- media
create policy media_select on public.media_assets for select to anon, authenticated using (deleted_at is null or public.is_staff());
create policy media_insert on public.media_assets for insert to authenticated with check (public.can_manage_content());
create policy media_update on public.media_assets for update to authenticated using (public.can_manage_content()) with check (public.can_manage_content());
create policy media_delete on public.media_assets for delete to authenticated using (public.can_manage_content());

create policy media_tr_select on public.media_asset_translations for select to anon, authenticated using (true);
create policy media_tr_insert on public.media_asset_translations for insert to authenticated with check (public.can_translate(locale));
create policy media_tr_update on public.media_asset_translations for update to authenticated using (public.can_translate(locale)) with check (public.can_translate(locale));
create policy media_tr_delete on public.media_asset_translations for delete to authenticated using (public.can_manage_content());

-- site settings (public, non-secret)
create policy settings_select on public.site_settings for select to anon, authenticated using (true);
create policy settings_update on public.site_settings for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
create policy settings_insert on public.site_settings for insert to authenticated with check (public.is_super_admin());
create policy settings_delete on public.site_settings for delete to authenticated using (false);

create policy settings_tr_select on public.site_settings_translations for select to anon, authenticated using (true);
create policy settings_tr_insert on public.site_settings_translations for insert to authenticated with check (public.is_super_admin() or public.can_translate(locale));
create policy settings_tr_update on public.site_settings_translations for update to authenticated using (public.is_super_admin() or public.can_translate(locale)) with check (public.is_super_admin() or public.can_translate(locale));
create policy settings_tr_delete on public.site_settings_translations for delete to authenticated using (public.is_super_admin());

-- private settings (super admin only)
create policy private_settings_select on public.private_settings for select to authenticated using (public.is_super_admin());
create policy private_settings_insert on public.private_settings for insert to authenticated with check (public.is_super_admin());
create policy private_settings_update on public.private_settings for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
create policy private_settings_delete on public.private_settings for delete to authenticated using (false);

-- pages
create policy pages_select on public.pages for select to anon, authenticated using ((status = 'published' and deleted_at is null) or public.is_staff());
create policy pages_insert on public.pages for insert to authenticated with check (public.can_manage_content());
create policy pages_update on public.pages for update to authenticated using (public.can_manage_content()) with check (public.can_manage_content());
create policy pages_delete on public.pages for delete to authenticated using (public.can_manage_content());

create policy page_tr_select on public.page_translations for select to anon, authenticated
  using ((variant = 'published' and public.page_is_public(page_id)) or public.is_staff());
create policy page_tr_insert on public.page_translations for insert to authenticated
  with check (public.can_manage_content() or (variant = 'draft' and public.can_translate(locale)));
create policy page_tr_update on public.page_translations for update to authenticated
  using (public.can_manage_content() or (variant = 'draft' and public.can_translate(locale)))
  with check (public.can_manage_content() or (variant = 'draft' and public.can_translate(locale)));
create policy page_tr_delete on public.page_translations for delete to authenticated using (public.can_manage_content());

-- sections
create policy sections_select on public.content_sections for select to anon, authenticated
  using ((status = 'published' and deleted_at is null and public.page_is_public(page_id)) or public.is_staff());
create policy sections_insert on public.content_sections for insert to authenticated with check (public.can_manage_content());
create policy sections_update on public.content_sections for update to authenticated using (public.can_manage_content()) with check (public.can_manage_content());
create policy sections_delete on public.content_sections for delete to authenticated using (public.can_manage_content());

create policy section_tr_select on public.content_section_translations for select to anon, authenticated
  using ((variant = 'published' and public.section_is_public(section_id)) or public.is_staff());
create policy section_tr_insert on public.content_section_translations for insert to authenticated
  with check (public.can_manage_content() or (variant = 'draft' and public.can_translate(locale)));
create policy section_tr_update on public.content_section_translations for update to authenticated
  using (public.can_manage_content() or (variant = 'draft' and public.can_translate(locale)))
  with check (public.can_manage_content() or (variant = 'draft' and public.can_translate(locale)));
create policy section_tr_delete on public.content_section_translations for delete to authenticated using (public.can_manage_content());

-- services
create policy services_select on public.services for select to anon, authenticated
  using ((status = 'published' and deleted_at is null) or public.is_staff());
create policy services_insert on public.services for insert to authenticated with check (public.can_manage_content());
create policy services_update on public.services for update to authenticated using (public.can_manage_content()) with check (public.can_manage_content());
create policy services_delete on public.services for delete to authenticated using (public.can_manage_content());

create policy service_tr_select on public.service_translations for select to anon, authenticated
  using ((variant = 'published' and public.service_is_public(service_id)) or public.is_staff());
create policy service_tr_insert on public.service_translations for insert to authenticated
  with check (public.can_manage_content() or (variant = 'draft' and public.can_translate(locale)));
create policy service_tr_update on public.service_translations for update to authenticated
  using (public.can_manage_content() or (variant = 'draft' and public.can_translate(locale)))
  with check (public.can_manage_content() or (variant = 'draft' and public.can_translate(locale)));
create policy service_tr_delete on public.service_translations for delete to authenticated using (public.can_manage_content());

create policy service_images_select on public.service_images for select to anon, authenticated
  using ((not is_hidden and public.service_is_public(service_id)) or public.is_staff());
create policy service_images_insert on public.service_images for insert to authenticated with check (public.can_manage_content());
create policy service_images_update on public.service_images for update to authenticated using (public.can_manage_content()) with check (public.can_manage_content());
create policy service_images_delete on public.service_images for delete to authenticated using (public.can_manage_content());

-- FAQs
create policy faqs_select on public.faqs for select to anon, authenticated using ((status = 'published' and deleted_at is null) or public.is_staff());
create policy faqs_insert on public.faqs for insert to authenticated with check (public.can_manage_content());
create policy faqs_update on public.faqs for update to authenticated using (public.can_manage_content()) with check (public.can_manage_content());
create policy faqs_delete on public.faqs for delete to authenticated using (public.can_manage_content());
create policy faq_tr_select on public.faq_translations for select to anon, authenticated
  using (exists (select 1 from public.faqs f where f.id = faq_id and f.status = 'published' and f.deleted_at is null) or public.is_staff());
create policy faq_tr_insert on public.faq_translations for insert to authenticated with check (public.can_translate(locale));
create policy faq_tr_update on public.faq_translations for update to authenticated using (public.can_translate(locale)) with check (public.can_translate(locale));
create policy faq_tr_delete on public.faq_translations for delete to authenticated using (public.can_manage_content());

-- Team
create policy team_select on public.team_members for select to anon, authenticated using ((status = 'published' and deleted_at is null) or public.is_staff());
create policy team_insert on public.team_members for insert to authenticated with check (public.can_manage_content());
create policy team_update on public.team_members for update to authenticated using (public.can_manage_content()) with check (public.can_manage_content());
create policy team_delete on public.team_members for delete to authenticated using (public.can_manage_content());
create policy team_tr_select on public.team_member_translations for select to anon, authenticated
  using (exists (select 1 from public.team_members m where m.id = member_id and m.status = 'published' and m.deleted_at is null) or public.is_staff());
create policy team_tr_insert on public.team_member_translations for insert to authenticated with check (public.can_translate(locale));
create policy team_tr_update on public.team_member_translations for update to authenticated using (public.can_translate(locale)) with check (public.can_translate(locale));
create policy team_tr_delete on public.team_member_translations for delete to authenticated using (public.can_manage_content());

-- Navigation
create policy nav_select on public.navigation_items for select to anon, authenticated using (is_visible or public.is_staff());
create policy nav_insert on public.navigation_items for insert to authenticated with check (public.can_manage_content());
create policy nav_update on public.navigation_items for update to authenticated using (public.can_manage_content()) with check (public.can_manage_content());
create policy nav_delete on public.navigation_items for delete to authenticated using (public.can_manage_content());
create policy nav_tr_select on public.navigation_item_translations for select to anon, authenticated using (true);
create policy nav_tr_insert on public.navigation_item_translations for insert to authenticated with check (public.can_translate(locale));
create policy nav_tr_update on public.navigation_item_translations for update to authenticated using (public.can_translate(locale)) with check (public.can_translate(locale));
create policy nav_tr_delete on public.navigation_item_translations for delete to authenticated using (public.can_manage_content());

-- Announcements
create policy ann_select on public.announcements for select to anon, authenticated
  using ((status = 'published' and deleted_at is null and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())) or public.is_staff());
create policy ann_insert on public.announcements for insert to authenticated with check (public.can_manage_content());
create policy ann_update on public.announcements for update to authenticated using (public.can_manage_content()) with check (public.can_manage_content());
create policy ann_delete on public.announcements for delete to authenticated using (public.can_manage_content());
create policy ann_tr_select on public.announcement_translations for select to anon, authenticated
  using (exists (select 1 from public.announcements a where a.id = announcement_id and a.status = 'published' and a.deleted_at is null) or public.is_staff());
create policy ann_tr_insert on public.announcement_translations for insert to authenticated with check (public.can_translate(locale));
create policy ann_tr_update on public.announcement_translations for update to authenticated using (public.can_translate(locale)) with check (public.can_translate(locale));
create policy ann_tr_delete on public.announcement_translations for delete to authenticated using (public.can_manage_content());

-- UI strings
create policy strings_select on public.translations for select to anon, authenticated using (true);
create policy strings_insert on public.translations for insert to authenticated with check (public.can_translate(locale));
create policy strings_update on public.translations for update to authenticated using (public.can_translate(locale)) with check (public.can_translate(locale));
create policy strings_delete on public.translations for delete to authenticated using (public.can_manage_content());

-- Inquiries: NO anonymous policies. Public submissions use submit_inquiry().
create policy inquiries_select on public.inquiries for select to authenticated using (public.can_manage_inquiries());
create policy inquiries_insert on public.inquiries for insert to authenticated with check (public.can_manage_inquiries());
create policy inquiries_update on public.inquiries for update to authenticated using (public.can_manage_inquiries()) with check (public.can_manage_inquiries());
create policy inquiries_delete on public.inquiries for delete to authenticated using (public.is_super_admin());

create policy notes_select on public.inquiry_notes for select to authenticated using (public.can_manage_inquiries());
create policy notes_insert on public.inquiry_notes for insert to authenticated with check (public.can_manage_inquiries() and author_id = auth.uid());
create policy notes_update on public.inquiry_notes for update to authenticated
  using (public.can_manage_inquiries() and (author_id = auth.uid() or public.is_super_admin()))
  with check (public.can_manage_inquiries());
create policy notes_delete on public.inquiry_notes for delete to authenticated
  using (public.can_manage_inquiries() and (author_id = auth.uid() or public.is_super_admin()));

-- Audit log: readable according to role; never writable by clients.
create policy audit_select on public.audit_logs for select to authenticated using (
  public.is_super_admin()
  or (public.can_manage_content() and entity_type not in ('inquiries', 'inquiry_notes', 'profiles', 'user_roles', 'private_settings'))
  or (public.has_role('sales_manager') and entity_type in ('inquiries', 'inquiry_notes'))
  or (public.has_role('translator') and entity_type like '%translations'));
create policy audit_insert on public.audit_logs for insert to authenticated with check (false);
create policy audit_update on public.audit_logs for update to authenticated using (false);
create policy audit_delete on public.audit_logs for delete to authenticated using (false);

-- ---------------------------------------------------------------------
-- Public inquiry submission (validated + rate limited)
-- ---------------------------------------------------------------------
create or replace function public.submit_inquiry(
  p_type text, p_name text, p_email text, p_country text, p_organization text, p_professional_role text,
  p_phone text, p_service_slug text, p_message text, p_locale text, p_source_path text,
  p_consent boolean, p_client_key text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_service public.services%rowtype;
  v_label text;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if p_type not in ('contact', 'case', 'partnership') then raise exception 'INVALID_TYPE' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'INVALID_NAME' using errcode = '22023'; end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 200 then raise exception 'INVALID_EMAIL' using errcode = '22023'; end if;
  if coalesce(p_consent, false) is not true then raise exception 'CONSENT_REQUIRED' using errcode = '22023'; end if;
  if char_length(coalesce(p_message, '')) > 4000 then raise exception 'MESSAGE_TOO_LONG' using errcode = '22023'; end if;

  -- Rate limits: per client key, per e-mail address and a global ceiling.
  if p_client_key is not null and (select count(*) from public.inquiries
       where client_key = p_client_key and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'RATE_LIMITED' using errcode = 'P0429';
  end if;
  if (select count(*) from public.inquiries where lower(email) = v_email and created_at > now() - interval '1 day') >= 10 then
    raise exception 'RATE_LIMITED' using errcode = 'P0429';
  end if;
  if (select count(*) from public.inquiries where created_at > now() - interval '1 hour') >= 300 then
    raise exception 'RATE_LIMITED' using errcode = 'P0429';
  end if;

  if nullif(btrim(coalesce(p_service_slug, '')), '') is not null then
    select * into v_service from public.services
     where slug = btrim(p_service_slug) and status = 'published' and deleted_at is null;
    if found then
      select coalesce(nav_title, title) into v_label from public.service_translations
       where service_id = v_service.id and variant = 'published'
       order by (locale = 'en') desc limit 1;
    end if;
  end if;

  insert into public.inquiries (type, name, email, country, organization, professional_role, phone,
                                service_id, service_label, message, locale, source_path, consent, client_key)
  values (p_type::public.inquiry_type, left(btrim(p_name), 120), v_email, left(nullif(btrim(p_country), ''), 80),
          left(nullif(btrim(p_organization), ''), 160), left(nullif(btrim(p_professional_role), ''), 80),
          left(nullif(btrim(p_phone), ''), 40), v_service.id, v_label, nullif(btrim(p_message), ''),
          left(p_locale, 10), left(p_source_path, 300), true, left(p_client_key, 128))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.submit_inquiry(text, text, text, text, text, text, text, text, text, text, text, boolean, text) from public;
grant execute on function public.submit_inquiry(text, text, text, text, text, text, text, text, text, text, text, boolean, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Publishing workflow (runs with the caller's rights → RLS still applies)
-- ---------------------------------------------------------------------
create or replace function public.publish_section(p_id uuid)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if not public.can_manage_content() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from public.content_section_translations where section_id = p_id and variant = 'published';
  insert into public.content_section_translations (section_id, locale, variant, eyebrow, heading, subheading, body, items,
         primary_label, primary_href, secondary_label, secondary_href, updated_by)
  select section_id, locale, 'published', eyebrow, heading, subheading, body, items,
         primary_label, primary_href, secondary_label, secondary_href, auth.uid()
  from public.content_section_translations where section_id = p_id and variant = 'draft';
  update public.content_sections set status = 'published', published_at = now() where id = p_id;
end $$;

create or replace function public.publish_page(p_id uuid)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if not public.can_manage_content() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from public.page_translations where page_id = p_id and variant = 'published';
  insert into public.page_translations (page_id, locale, variant, title, seo_title, seo_description, updated_by)
  select page_id, locale, 'published', title, seo_title, seo_description, auth.uid()
  from public.page_translations where page_id = p_id and variant = 'draft';
  update public.pages set status = 'published', published_at = now() where id = p_id;
end $$;

create or replace function public.publish_service(p_id uuid)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if not public.can_manage_content() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from public.service_translations where service_id = p_id and variant = 'published';
  insert into public.service_translations (service_id, locale, variant, title, nav_title, summary, description,
         features_heading, features, workflow_heading, workflow, notice, cta_label, price_note, seo_title, seo_description, updated_by)
  select service_id, locale, 'published', title, nav_title, summary, description,
         features_heading, features, workflow_heading, workflow, notice, cta_label, price_note, seo_title, seo_description, auth.uid()
  from public.service_translations where service_id = p_id and variant = 'draft';
  update public.services set status = 'published', published_at = now() where id = p_id;
end $$;

grant execute on function public.publish_section(uuid), public.publish_page(uuid), public.publish_service(uuid) to authenticated;
revoke execute on function public.publish_section(uuid), public.publish_page(uuid), public.publish_service(uuid) from anon;

-- ---------------------------------------------------------------------
-- Where is a media asset used?  (invoker → only what the caller may see)
-- ---------------------------------------------------------------------
create or replace function public.media_usage(p_media_id uuid)
returns table (entity_type text, entity_id uuid, label text)
language sql stable security invoker set search_path = public, pg_temp as $$
  select 'service', s.id, 'Service main image: ' || s.slug from public.services s where s.main_media_id = p_media_id and s.deleted_at is null
  union all
  select 'service_gallery', s.id, 'Service gallery: ' || s.slug from public.service_images i join public.services s on s.id = i.service_id where i.media_id = p_media_id
  union all
  select 'section', c.id, 'Section: ' || p.key || ' / ' || c.key from public.content_sections c join public.pages p on p.id = c.page_id where c.media_id = p_media_id and c.deleted_at is null
  union all
  select 'page', p.id, 'Page share image: ' || p.key from public.pages p where p.og_image_media_id = p_media_id
  union all
  select 'team', m.id, 'Team member photo' from public.team_members m where m.photo_media_id = p_media_id and m.deleted_at is null
  union all
  select 'settings', null::uuid, 'Site settings: logo' from public.site_settings where logo_media_id = p_media_id
  union all
  select 'settings', null::uuid, 'Site settings: favicon' from public.site_settings where favicon_media_id = p_media_id
  union all
  select 'settings', null::uuid, 'Site settings: default share image' from public.site_settings where og_image_media_id = p_media_id;
$$;
grant execute on function public.media_usage(uuid) to authenticated;
revoke execute on function public.media_usage(uuid) from anon;

-- ---------------------------------------------------------------------
-- Dashboard metrics (real counts; invoker → RLS decides what is counted)
-- ---------------------------------------------------------------------
create or replace function public.inquiry_stats()
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare result jsonb;
begin
  if not public.can_manage_inquiries() then return null; end if;
  select jsonb_build_object(
    'total', (select count(*) from public.inquiries),
    'new', (select count(*) from public.inquiries where status = 'new'),
    'last_30_days', (select count(*) from public.inquiries where created_at > now() - interval '30 days'),
    'by_type', coalesce((select jsonb_object_agg(type, n) from (select type, count(*) n from public.inquiries group by type) t), '{}'::jsonb),
    'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.inquiries group by status) t), '{}'::jsonb),
    'by_service', coalesce((select jsonb_agg(jsonb_build_object('service', coalesce(service_label, 'Not specified'), 'count', n) order by n desc)
                   from (select service_label, count(*) n from public.inquiries group by service_label) t), '[]'::jsonb))
  into result;
  return result;
end $$;
grant execute on function public.inquiry_stats() to authenticated;
revoke execute on function public.inquiry_stats() from anon;
