-- =====================================================================
-- RUKN — Row Level Security & permission tests (allowed AND denied).
-- Run with: npm run test:db   (see tests/db/run.sh)
-- Any failure raises an exception and stops the run (ON_ERROR_STOP).
-- =====================================================================
\set QUIET on
set client_min_messages = notice;
\o /dev/null

create schema t;
grant usage on schema t to anon, authenticated;
create table t.results (n serial, name text, passed boolean);
grant all on t.results to anon, authenticated;
grant usage on sequence t.results_n_seq to anon, authenticated;

create function t.ok(cond boolean, name text) returns void language plpgsql as $$
begin
  insert into t.results (name, passed) values (name, coalesce(cond, false));
  if coalesce(cond, false) then raise notice 'PASS  %', name;
  else raise exception 'FAIL  %', name; end if;
end $$;
grant execute on function t.ok(boolean, text) to anon, authenticated;

create function t.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', case when p_uid is null then '{}' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, false);
$$;
grant execute on function t.login(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Fixtures (as database owner)
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'super@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'content@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'sales@test.local'),
  ('00000000-0000-0000-0000-00000000000d', 'translator@test.local'),
  ('00000000-0000-0000-0000-00000000000e', 'norole@test.local'),
  ('00000000-0000-0000-0000-00000000000f', 'inactive@test.local');

select t.ok((select count(*) = 6 from public.profiles), 'profiles are created automatically for new auth users (with no role)');
select public.bootstrap_super_admin('super@test.local');
insert into public.user_roles (user_id, role) values
  ('00000000-0000-0000-0000-00000000000b', 'content_manager'),
  ('00000000-0000-0000-0000-00000000000c', 'sales_manager'),
  ('00000000-0000-0000-0000-00000000000d', 'translator'),
  ('00000000-0000-0000-0000-00000000000f', 'sales_manager');
update public.profiles set allowed_locales = '{ar}' where id = '00000000-0000-0000-0000-00000000000d';
update public.profiles set is_active = false where id = '00000000-0000-0000-0000-00000000000f';

-- A draft-only section that must never be visible publicly
insert into public.content_sections (id, page_id, key, type, status)
select '11111111-1111-1111-1111-111111111111', id, 'secret-draft', 'rich_text', 'draft' from public.pages where key = 'home';
insert into public.content_section_translations (section_id, locale, variant, heading)
values ('11111111-1111-1111-1111-111111111111', 'en', 'draft', 'UNPUBLISHED HEADLINE');

-- A draft service
insert into public.services (id, slug, status) values ('22222222-2222-2222-2222-222222222222', 'draft-service', 'draft');
insert into public.service_translations (service_id, locale, variant, title) values ('22222222-2222-2222-2222-222222222222', 'en', 'draft', 'Hidden service');

-- An existing inquiry
insert into public.inquiries (id, type, name, email, consent) values ('33333333-3333-3333-3333-333333333333', 'contact', 'Existing Lead', 'lead@example.com', true);
insert into public.private_settings (id) values (1) on conflict do nothing;

-- =====================================================================
-- ANONYMOUS VISITOR
-- =====================================================================
select t.login(null);
set role anon;

select t.ok((select count(*) > 0 from public.pages), 'anon can read published pages');
select t.ok((select count(*) > 0 from public.services), 'anon can read published services');
select t.ok((select count(*) = 0 from public.services where slug = 'draft-service'), 'anon cannot see draft services');
select t.ok((select count(*) = 0 from public.service_translations where variant = 'draft'), 'anon cannot read draft service translations');
select t.ok((select count(*) = 0 from public.content_sections where key = 'secret-draft'), 'anon cannot see draft sections');
select t.ok((select count(*) = 0 from public.content_section_translations where variant = 'draft'), 'anon cannot read any draft section translations');
select t.ok((select count(*) > 0 from public.content_section_translations where variant = 'published'), 'anon can read published section translations');
select t.ok((select count(*) > 0 from public.translations), 'anon can read interface strings');

do $$ begin
  perform count(*) from public.inquiries;
  perform t.ok(false, 'anon must not read inquiries');
exception when insufficient_privilege then perform t.ok(true, 'anon cannot read inquiries (permission denied)'); end $$;

do $$ begin
  insert into public.inquiries (type, name, email, consent) values ('contact', 'Direct Insert', 'x@example.com', true);
  perform t.ok(false, 'anon must not insert inquiries directly');
exception when insufficient_privilege then perform t.ok(true, 'anon cannot insert inquiries directly'); end $$;

do $$ begin
  perform count(*) from public.inquiry_notes;
  perform t.ok(false, 'anon must not read notes');
exception when insufficient_privilege then perform t.ok(true, 'anon cannot read inquiry notes'); end $$;

do $$ begin
  perform count(*) from public.profiles;
  perform t.ok(false, 'anon must not read profiles');
exception when insufficient_privilege then perform t.ok(true, 'anon cannot read staff profiles'); end $$;

do $$ begin
  perform count(*) from public.user_roles;
  perform t.ok(false, 'anon must not read roles');
exception when insufficient_privilege then perform t.ok(true, 'anon cannot read user roles'); end $$;

do $$ begin
  perform count(*) from public.private_settings;
  perform t.ok(false, 'anon must not read private settings');
exception when insufficient_privilege then perform t.ok(true, 'anon cannot read private settings'); end $$;

do $$ begin
  perform count(*) from public.audit_logs;
  perform t.ok(false, 'anon must not read audit log');
exception when insufficient_privilege then perform t.ok(true, 'anon cannot read the audit log'); end $$;

do $$ declare n int; begin
  update public.service_translations set title = 'HACKED' where variant = 'published';
  get diagnostics n = row_count;
  perform t.ok(n = 0, 'anon cannot update content (0 rows changed)');
end $$;

do $$ declare n int; begin
  delete from public.services;
  get diagnostics n = row_count;
  perform t.ok(n = 0, 'anon cannot delete services (0 rows deleted)');
end $$;

do $$ declare n int; begin
  update public.site_settings set maintenance_mode = true;
  get diagnostics n = row_count;
  perform t.ok(n = 0, 'anon cannot change site settings');
end $$;

do $$ begin
  insert into public.media_assets (path, filename, mime_type, size_bytes) values ('x.webp', 'x', 'image/webp', 10);
  perform t.ok(false, 'anon must not insert media');
exception when insufficient_privilege then perform t.ok(true, 'anon cannot insert media records (RLS)'); end $$;

do $$ begin
  insert into storage.objects (bucket_id, name) values ('media', 'evil.png');
  perform t.ok(false, 'anon must not upload files');
exception when insufficient_privilege then perform t.ok(true, 'anon cannot upload to the media bucket'); end $$;

do $$ begin
  perform public.publish_section('11111111-1111-1111-1111-111111111111');
  perform t.ok(false, 'anon must not publish');
exception when insufficient_privilege then perform t.ok(true, 'anon cannot execute publish functions'); end $$;

do $$ begin
  perform public.bootstrap_super_admin('norole@test.local');
  perform t.ok(false, 'anon must not bootstrap admins');
exception when insufficient_privilege then perform t.ok(true, 'anon cannot call bootstrap_super_admin'); end $$;

-- Public inquiry submission (validated + rate-limited)
do $$ declare v uuid; begin
  v := public.submit_inquiry('case', 'Dr. Test', 'Doctor@Example.com', 'Egypt', 'Clinic', 'dentist', null,
                             'clear-aligners', 'Hello', 'en', '/en/case-inquiry', true, 'client-A');
  perform t.ok(v is not null, 'anon can submit an inquiry through submit_inquiry()');
end $$;

do $$ begin
  perform public.submit_inquiry('contact', 'Bad Email', 'not-an-email', null, null, null, null, null, 'x', 'en', '/', true, 'client-B');
  perform t.ok(false, 'invalid e-mail must be rejected');
exception when sqlstate '22023' then perform t.ok(true, 'submit_inquiry rejects invalid e-mail'); end $$;

do $$ begin
  perform public.submit_inquiry('contact', 'No Consent', 'a@example.com', null, null, null, null, null, 'x', 'en', '/', false, 'client-B');
  perform t.ok(false, 'missing consent must be rejected');
exception when sqlstate '22023' then perform t.ok(true, 'submit_inquiry requires consent'); end $$;

do $$ begin
  perform public.submit_inquiry('admin', 'Bad Type', 'a@example.com', null, null, null, null, null, 'x', 'en', '/', true, 'client-B');
  perform t.ok(false, 'invalid type must be rejected');
exception when sqlstate '22023' then perform t.ok(true, 'submit_inquiry rejects unknown inquiry types'); end $$;

do $$ declare i int; begin
  for i in 1..4 loop
    perform public.submit_inquiry('contact', 'Flood', 'flood' || i || '@example.com', null, null, null, null, null, 'x', 'en', '/', true, 'client-A');
  end loop;
  perform public.submit_inquiry('contact', 'Flood', 'flood6@example.com', null, null, null, null, null, 'x', 'en', '/', true, 'client-A');
  perform t.ok(false, 'sixth submission within an hour must be rate limited');
exception when sqlstate 'P0429' then perform t.ok(true, 'submit_inquiry rate-limits a client after 5 submissions per hour'); end $$;

reset role;
select t.ok((select service_label = 'Clear Aligners' and email = 'doctor@example.com' from public.inquiries where name = 'Dr. Test'),
            'submitted inquiry is stored with normalised e-mail and service label');

-- =====================================================================
-- AUTHENTICATED USER WITHOUT A ROLE (e.g. accidental sign-up)
-- =====================================================================
select t.login('00000000-0000-0000-0000-00000000000e');
set role authenticated;
select t.ok((select count(*) = 0 from public.inquiries), 'user without a role sees zero inquiries');
select t.ok((select count(*) = 0 from public.content_section_translations where variant = 'draft'), 'user without a role cannot read drafts');
select t.ok((select count(*) = 0 from public.private_settings), 'user without a role cannot read private settings');
do $$ declare n int; begin
  update public.pages set status = 'draft';
  get diagnostics n = row_count;
  perform t.ok(n = 0, 'user without a role cannot change pages');
end $$;
do $$ begin
  insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-00000000000e', 'super_admin');
  perform t.ok(false, 'user must not grant himself a role');
exception when insufficient_privilege then perform t.ok(true, 'user without a role cannot grant himself Super Administrator'); end $$;
do $$ begin
  update public.profiles set allowed_locales = '{en,ar}', is_active = true where id = auth.uid();
  perform t.ok((select allowed_locales = '{}' from public.profiles where id = auth.uid()), 'non-admin cannot change own permissions on profile');
end $$;
reset role;

-- =====================================================================
-- SALES MANAGER
-- =====================================================================
select t.login('00000000-0000-0000-0000-00000000000c');
set role authenticated;
select t.ok((select count(*) >= 2 from public.inquiries), 'sales manager can read inquiries');
do $$ declare n int; begin
  update public.inquiries set status = 'contacted' where id = '33333333-3333-3333-3333-333333333333';
  get diagnostics n = row_count;
  perform t.ok(n = 1, 'sales manager can change inquiry status');
end $$;
do $$ begin
  insert into public.inquiry_notes (inquiry_id, author_id, body) values ('33333333-3333-3333-3333-333333333333', auth.uid(), 'Called the lead.');
  perform t.ok(true, 'sales manager can add an internal note');
end $$;
do $$ begin
  insert into public.inquiry_notes (inquiry_id, author_id, body) values ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-00000000000a', 'Forged');
  perform t.ok(false, 'notes must not be forged for other authors');
exception when insufficient_privilege then perform t.ok(true, 'sales manager cannot write notes as another user'); end $$;
do $$ declare n int; begin
  delete from public.inquiries where id = '33333333-3333-3333-3333-333333333333';
  get diagnostics n = row_count;
  perform t.ok(n = 0, 'sales manager cannot delete inquiries (super admin only)');
end $$;
do $$ declare n int; begin
  update public.service_translations set title = 'X' where variant = 'draft';
  get diagnostics n = row_count;
  perform t.ok(n = 0, 'sales manager cannot edit content');
end $$;
select t.ok((select count(*) = 0 from public.private_settings), 'sales manager cannot read private settings');
select t.ok((select (public.inquiry_stats() ->> 'total')::int >= 2), 'sales manager receives real inquiry statistics');
do $$ begin
  insert into storage.objects (bucket_id, name) values ('media', 'sales.png');
  perform t.ok(false, 'sales must not upload media');
exception when insufficient_privilege then perform t.ok(true, 'sales manager cannot upload media'); end $$;
reset role;

-- =====================================================================
-- INACTIVE STAFF
-- =====================================================================
select t.login('00000000-0000-0000-0000-00000000000f');
set role authenticated;
select t.ok((select count(*) = 0 from public.inquiries), 'deactivated sales manager loses access to inquiries');
reset role;

-- =====================================================================
-- CONTENT MANAGER
-- =====================================================================
select t.login('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select t.ok((select count(*) = 0 from public.inquiries), 'content manager cannot read inquiries');
select t.ok((select count(*) = 0 from public.inquiry_notes), 'content manager cannot read internal notes');
select t.ok((select public.inquiry_stats() is null), 'content manager receives no inquiry statistics');
select t.ok((select count(*) = 1 from public.content_sections where key = 'secret-draft'), 'content manager can see draft sections');
do $$ declare n int; begin
  update public.content_section_translations set heading = 'New headline (draft)'
  where variant = 'draft' and locale = 'en' and section_id = (select s.id from public.content_sections s join public.pages p on p.id = s.page_id where p.key = 'home' and s.key = 'hero');
  get diagnostics n = row_count;
  perform t.ok(n = 1, 'content manager can edit a draft headline');
  perform public.publish_section((select s.id from public.content_sections s join public.pages p on p.id = s.page_id where p.key = 'home' and s.key = 'hero'));
  perform t.ok(true, 'content manager can publish a section');
end $$;
do $$ begin
  insert into public.services (slug, status) values ('new-service', 'draft');
  insert into public.service_translations (service_id, locale, variant, title) select id, 'en', 'draft', 'New service' from public.services where slug = 'new-service';
  perform public.publish_service((select id from public.services where slug = 'new-service'));
  perform t.ok(true, 'content manager can add and publish a service');
end $$;
do $$ begin
  insert into public.media_assets (path, filename, mime_type, size_bytes, uploaded_by) values ('test/a.webp', 'a.webp', 'image/webp', 100, auth.uid());
  insert into storage.objects (bucket_id, name) values ('media', 'test/a.webp');
  perform t.ok(true, 'content manager can upload media');
end $$;
do $$ begin
  insert into public.media_assets (path, filename, mime_type, size_bytes) values ('test/evil.svg', 'evil.svg', 'image/svg+xml', 100);
  perform t.ok(false, 'svg must be rejected');
exception when check_violation then perform t.ok(true, 'media library rejects non-whitelisted MIME types (e.g. SVG)'); end $$;
select t.ok((select count(*) = 0 from public.private_settings), 'content manager cannot read private settings');
do $$ declare n int; begin
  update public.site_settings set maintenance_mode = true;
  get diagnostics n = row_count;
  perform t.ok(n = 0, 'content manager cannot change site settings (super admin only)');
end $$;
do $$ begin
  insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-00000000000b', 'super_admin');
  perform t.ok(false, 'content manager must not escalate');
exception when insufficient_privilege then perform t.ok(true, 'content manager cannot escalate to Super Administrator'); end $$;
select t.ok((select count(*) > 0 from public.audit_logs), 'content manager can read content audit trail');
select t.ok((select count(*) = 0 from public.audit_logs where entity_type in ('inquiries', 'inquiry_notes', 'user_roles')), 'content manager cannot see inquiry or role audit entries');
reset role;

-- The published headline is now visible to the public
select t.login(null);
set role anon;
select t.ok((select count(*) = 1 from public.content_section_translations where variant = 'published' and heading = 'New headline (draft)'),
            'published headline is visible to anonymous visitors');
select t.ok((select count(*) = 1 from public.services where slug = 'new-service'), 'newly published service is visible to anonymous visitors');
reset role;

-- =====================================================================
-- TRANSLATOR (permitted locale: ar)
-- =====================================================================
select t.login('00000000-0000-0000-0000-00000000000d');
set role authenticated;
do $$ declare n int; begin
  update public.service_translations set summary = 'ملخص محدث' where variant = 'draft' and locale = 'ar';
  get diagnostics n = row_count;
  perform t.ok(n > 0, 'translator can edit Arabic drafts');
end $$;
do $$ declare n int; begin
  update public.service_translations set summary = 'changed' where variant = 'draft' and locale = 'en';
  get diagnostics n = row_count;
  perform t.ok(n = 0, 'translator cannot edit locales outside the permitted list');
end $$;
do $$ declare n int; begin
  update public.service_translations set summary = 'نشر مباشر' where variant = 'published' and locale = 'ar';
  get diagnostics n = row_count;
  perform t.ok(n = 0, 'translator cannot edit published content directly');
end $$;
do $$ begin
  update public.service_translations set locale = 'en' where variant = 'draft' and locale = 'ar';
  perform t.ok(false, 'translator must not move a row to another locale');
exception when insufficient_privilege then perform t.ok(true, 'translator cannot move a translation into a non-permitted locale'); end $$;
do $$ begin
  perform public.publish_service((select id from public.services where slug = 'clear-aligners'));
  perform t.ok(false, 'translator must not publish');
exception when insufficient_privilege then perform t.ok(true, 'translator cannot publish'); end $$;
do $$ declare n int; begin
  update public.services set status = 'archived';
  get diagnostics n = row_count;
  perform t.ok(n = 0, 'translator cannot change services');
end $$;
select t.ok((select count(*) = 0 from public.inquiries), 'translator cannot read inquiries');
do $$ declare n int; begin
  update public.translations set value = 'إرسال' where key = 'form.submit' and locale = 'ar';
  get diagnostics n = row_count;
  perform t.ok(n = 1, 'translator can edit Arabic interface strings');
end $$;
reset role;

-- =====================================================================
-- SUPER ADMINISTRATOR
-- =====================================================================
select t.login('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select t.ok((select count(*) = 1 from public.private_settings), 'super admin can read private settings');
select t.ok((select count(*) >= 2 from public.inquiries), 'super admin can read inquiries');
do $$ declare n int; begin
  update public.site_settings set maintenance_mode = false;
  get diagnostics n = row_count;
  perform t.ok(n = 1, 'super admin can change site settings');
end $$;
do $$ begin
  insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-00000000000e', 'translator');
  perform t.ok(true, 'super admin can grant roles');
end $$;
select t.ok((select count(*) > 0 from public.audit_logs where entity_type = 'inquiries'), 'super admin sees the full audit trail');
reset role;

-- Last super administrator protection (deferred trigger → check immediately)
begin;
select t.login('00000000-0000-0000-0000-00000000000a');
set role authenticated;
set constraints all immediate;
do $$ begin
  delete from public.user_roles where role = 'super_admin';
  perform t.ok(false, 'last super admin must not be removable');
exception when raise_exception then perform t.ok(true, 'the last Super Administrator cannot be removed'); end $$;
rollback;

-- Storage: the media bucket exists and no clinical bucket is created
select t.ok((select public from storage.buckets where id = 'media'), 'media bucket exists and is public-read');
select t.ok((select count(*) = 1 from storage.buckets), 'no other (e.g. clinical-records) bucket is created');

-- Every table in public has RLS enabled
select t.ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind = 'r'), 'Row Level Security is enabled on every public table');

\o
\echo
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from t.results;
