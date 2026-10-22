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


-- =====================================================================
-- CASES / AGENTS
-- =====================================================================
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'agent1@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'agent2@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', 'casemgr@test.local');
insert into public.user_roles (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'agent'),
  ('00000000-0000-0000-0000-0000000000a2', 'agent'),
  ('00000000-0000-0000-0000-0000000000c1', 'case_manager');

-- Agent 1 creates a case
select t.login('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
do $$ declare v_code text; v_agent uuid; begin
  insert into public.cases (agent_id, clinic_name, doctor_name, country_code, patient_ref, status, quote_amount, quote_currency)
  values ('00000000-0000-0000-0000-0000000000a2', 'Smile Clinic', 'Dr. Test', 'EG', 'P-001', 'delivered', 999, 'USD')
  returning code, agent_id into v_code, v_agent;
  perform t.ok(v_code ~ '^RK-EG-[0-9]{2}-[0-9]{5}$', 'agent can create a case; code generated (' || v_code || ')');
  perform t.ok(v_agent = '00000000-0000-0000-0000-0000000000a1', 'agent cannot create a case on behalf of another agent');
end $$;
select t.ok((select status = 'submitted' and quote_amount is null from public.cases where patient_ref = 'P-001'), 'agent cannot set status or price on creation');
select t.ok((select count(*) = 1 from public.case_events e join public.cases c on c.id = e.case_id where c.patient_ref = 'P-001'), 'case submission is logged on the timeline');
do $$ begin
  update public.cases set status = 'delivered', clinic_name = 'Smile Clinic 2' where patient_ref = 'P-001';
  perform t.ok((select status = 'submitted' and clinic_name = 'Smile Clinic 2' from public.cases where patient_ref = 'P-001'),
               'agent can correct details while submitted, but cannot change status');
end $$;
do $$ begin
  insert into public.case_events (case_id, kind, body, author_id) select id, 'internal', 'x', auth.uid() from public.cases where patient_ref = 'P-001';
  perform t.ok(false, 'agent must not write internal notes');
exception when insufficient_privilege then perform t.ok(true, 'agent cannot write internal notes'); end $$;
do $$ begin
  insert into public.case_events (case_id, kind, body, author_id) select id, 'comment', 'Patient prefers morning appointments', auth.uid() from public.cases where patient_ref = 'P-001';
  perform t.ok(true, 'agent can comment on his own case');
end $$;
do $$ begin
  insert into public.case_payments (case_id, amount, currency, method) select id, 10, 'USD', 'cash' from public.cases where patient_ref = 'P-001';
  perform t.ok(false, 'agent must not record payments');
exception when insufficient_privilege then perform t.ok(true, 'agent cannot record payments'); end $$;
do $$ begin
  insert into storage.objects (bucket_id, name) select 'case-files', id || '/scan.stl' from public.cases where patient_ref = 'P-001';
  perform t.ok(true, 'agent can upload clinical files to his own case folder');
end $$;
do $$ begin
  insert into storage.objects (bucket_id, name) select 'case-files', id || '/evil.exe' from public.cases where patient_ref = 'P-001';
  perform t.ok(false, 'exe must be rejected');
exception when insufficient_privilege then perform t.ok(true, 'clinical upload rejects disallowed file types'); end $$;
select t.ok((select count(*) = 0 from public.inquiries), 'agent cannot read inquiries');
select t.ok((select count(*) = 0 from public.content_section_translations where variant = 'draft'), 'agent cannot read draft website content');
select t.ok((select count(*) = 0 from public.audit_logs), 'agent cannot read the audit log');
reset role;

-- Agent 2 sees nothing of agent 1
select t.login('00000000-0000-0000-0000-0000000000a2');
set role authenticated;
select t.ok((select count(*) = 0 from public.cases), 'agent 2 cannot see agent 1 cases');
select t.ok((select count(*) = 0 from public.case_events), 'agent 2 cannot see agent 1 timeline');
do $$ declare n int; begin
  update public.cases set clinic_name = 'hijack';
  get diagnostics n = row_count;
  perform t.ok(n = 0, 'agent 2 cannot modify agent 1 cases');
end $$;
do $$ begin
  insert into storage.objects (bucket_id, name) select 'case-files', id || '/x.stl' from public.cases;  -- sees no ids
  insert into storage.objects (bucket_id, name) values ('case-files', (select id::text from public.cases limit 1) || '/x.stl');
  perform t.ok(false, 'agent 2 must not upload into others cases');
exception when insufficient_privilege or not_null_violation then perform t.ok(true, 'agent 2 cannot upload into another agent''s case');
end $$;
reset role;
do $$ begin
  set local role authenticated;
  perform t.login('00000000-0000-0000-0000-0000000000a2');
end $$;
reset role;
-- direct path attack with a known case id
do $$ declare cid uuid; begin
  select id into cid from public.cases where patient_ref = 'P-001';
  perform t.login('00000000-0000-0000-0000-0000000000a2');
  execute 'set role authenticated';
  begin
    insert into storage.objects (bucket_id, name) values ('case-files', cid || '/x.stl');
    perform t.ok(false, 'cross-agent path upload must fail');
  exception when insufficient_privilege then perform t.ok(true, 'agent 2 cannot upload using agent 1 case id in the path');
  end;
  execute 'reset role';
end $$;

-- Case manager processes the case
select t.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select t.ok((select count(*) >= 1 from public.cases), 'case manager sees all cases');
select t.ok((select count(*) = 0 from public.inquiries), 'case manager cannot read sales inquiries');
do $$ begin
  update public.cases set intake_received_at = now(), intake_items = '[{"title":"Upper/lower STL","text":"1"}]', status = 'records_received' where patient_ref = 'P-001';
  perform t.ok((select intake_no ~ '^RR-[0-9]{2}-[0-9]{5}$' from public.cases where patient_ref = 'P-001'), 'records intake gets a receipt number');
  update public.cases set status = 'awaiting_approval', quote_amount = 450, quote_currency = 'USD' where patient_ref = 'P-001';
  insert into public.case_payments (case_id, amount, currency, method) select id, 200, 'USD', 'bank_transfer' from public.cases where patient_ref = 'P-001';
  perform t.ok((select receipt_no ~ '^RC-[0-9]{2}-[0-9]{5}$' from public.case_payments limit 1), 'payment gets a receipt number');
  insert into public.case_events (case_id, kind, body, author_id) select id, 'internal', 'Check bite registration', auth.uid() from public.cases where patient_ref = 'P-001';
  perform t.ok(true, 'case manager can write internal notes');
end $$;
reset role;

-- Agent approves plan; cannot see internal note; sees payments
select t.login('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
select t.ok((select count(*) = 0 from public.case_events where kind = 'internal'), 'agent cannot see internal notes');
select t.ok((select count(*) = 1 from public.case_payments), 'agent can see payments on his case (to print receipts)');
do $$ begin
  update public.cases set clinic_name = 'late edit' where patient_ref = 'P-001';
  perform t.ok(false, 'agent must not edit after submission');
exception when insufficient_privilege then perform t.ok(true, 'agent cannot edit the case once it is being processed'); end $$;
do $$ begin
  perform public.decide_case_plan((select id from public.cases where patient_ref = 'P-001'), 'approve', 'Dr. Test', 'Looks good');
  perform t.ok((select status = 'approved' and plan_approved_by = 'Dr. Test' from public.cases where patient_ref = 'P-001'), 'agent records the treating doctor''s plan approval');
end $$;
reset role;

select t.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
do $$ begin
  update public.cases set status = 'shipped', carrier = 'DHL', tracking_no = '123' where patient_ref = 'P-001';
  update public.cases set status = 'delivered', received_by_name = 'Clinic reception' where patient_ref = 'P-001';
  perform t.ok((select delivery_no ~ '^DN-[0-9]{2}-[0-9]{5}$' and shipped_at is not null and delivered_at is not null and closed_at is not null from public.cases where patient_ref = 'P-001'),
               'delivery gets a delivery-note number and dates are stamped');
  perform t.ok((select count(*) >= 6 from public.case_events e join public.cases c on c.id = e.case_id where c.patient_ref = 'P-001'), 'every step is recorded on the case timeline');
end $$;
do $$ begin
  update public.cases set code = 'HACKED' where patient_ref = 'P-001';
  perform t.ok((select code like 'RK-EG-%' from public.cases where patient_ref = 'P-001'), 'case code can never be changed');
end $$;
reset role;

select t.login(null);
set role anon;
do $$ begin
  perform count(*) from public.cases;
  perform t.ok(false, 'anon must not read cases');
exception when insufficient_privilege then perform t.ok(true, 'anonymous visitors cannot read cases'); end $$;
reset role;

-- =====================================================================
-- CASE INVOICES
-- =====================================================================
select t.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select t.ok((select count(*) >= 12 from public.case_price_items), 'case manager reads the price list');
do $$ declare v_inv uuid; v_empty uuid; r record; begin
  insert into public.case_invoices (case_id, currency, status, invoice_no, total)
    select id, 'USD', 'issued', 'FAKE-1', 999 from public.cases where patient_ref = 'P-001' returning id into v_inv;
  select * into r from public.case_invoices where id = v_inv;
  perform t.ok(r.status = 'draft' and r.invoice_no is null and r.total = 0, 'a new invoice is always a draft without number or totals');
  insert into public.case_invoice_items (invoice_id, sort_order, code, description, qty, unit_price) values
    (v_inv, 1, 'ALN-FULL', 'Clear aligners — comprehensive treatment', 1, 900),
    (v_inv, 2, 'RET-SET', 'Clear retainer set', 1, 120);
  update public.case_invoices set discount_amount = 20, tax_rate = 14 where id = v_inv;
  select * into r from public.case_invoices where id = v_inv;
  perform t.ok(r.subtotal = 1020 and r.tax_amount = 140 and r.total = 1140, 'invoice totals: subtotal − discount + tax (' || r.total || ')');
  update public.case_invoice_items set qty = 2 where invoice_id = v_inv and code = 'RET-SET';
  perform t.ok((select subtotal = 1140 and total = 1276.80 from public.case_invoices where id = v_inv), 'totals follow line changes on a draft');
  -- issuing an empty draft is refused
  insert into public.case_invoices (case_id) select id from public.cases where patient_ref = 'P-001' returning id into v_empty;
  begin
    update public.case_invoices set status = 'issued' where id = v_empty;
    perform t.ok(false, 'empty invoice must not be issued');
  exception when invalid_parameter_value then perform t.ok(true, 'an invoice without lines cannot be issued'); end;
  -- issue
  update public.case_invoices set status = 'issued' where id = v_inv;
  select * into r from public.case_invoices where id = v_inv;
  perform t.ok(r.invoice_no ~ '^INV-[0-9]{2}-[0-9]{5}$' and r.issued_at is not null, 'issuing assigns the invoice number (' || r.invoice_no || ')');
  perform t.ok((select quote_amount = 1276.80 and quote_currency = 'USD' from public.cases where patient_ref = 'P-001'), 'the case price follows the issued invoice');
  perform t.ok((select count(*) = 1 from public.case_events e join public.cases c on c.id = e.case_id where c.patient_ref = 'P-001' and e.body like 'Invoice INV-%issued%'), 'issuing is logged on the case timeline');
  -- issued invoices can be revised by case staff (number kept, revision logged)
  update public.case_invoice_items set unit_price = 100 where invoice_id = v_inv and code = 'RET-SET';
  perform t.ok((select invoice_no = r.invoice_no and total = 1231.20 from public.case_invoices where id = v_inv), 'case staff can edit an issued invoice; number kept, totals recalculated');
  perform t.ok((select quote_amount = 1231.20 from public.cases where patient_ref = 'P-001'), 'the case price follows the revised invoice');
  perform t.ok(public.log_invoice_revision(v_inv, 1276.80, 'retainer price corrected') = 1, 'the revision is numbered');
  perform t.ok((select count(*) = 1 from public.case_events where body like 'Invoice % revised (rev. 1): 1276.80 → 1231.20 USD%'), 'the revision is logged on the case timeline with old and new totals');
  begin
    update public.case_invoices set status = 'draft' where id = v_inv;
    perform t.ok(false, 'issued invoice must not go back to draft');
  exception when insufficient_privilege then perform t.ok(true, 'an issued invoice cannot go back to draft'); end;
  begin
    delete from public.case_invoices where id = v_inv;
    perform t.ok(false, 'issued invoice must not be deletable');
  exception when insufficient_privilege then perform t.ok(true, 'an issued invoice cannot be deleted'); end;
  begin
    insert into public.case_payments (case_id, amount, currency, method, invoice_id) select id, 100, 'EUR', 'cash', v_inv from public.cases where patient_ref = 'P-001';
    perform t.ok(false, 'currency mismatch must be refused');
  exception when invalid_parameter_value then perform t.ok(true, 'a payment must use the invoice currency'); end;
  begin
    insert into public.case_payments (case_id, amount, currency, method, invoice_id) select id, 100, 'USD', 'cash', v_empty from public.cases where patient_ref = 'P-001';
    perform t.ok(false, 'payment on a draft must be refused');
  exception when invalid_parameter_value then perform t.ok(true, 'payments cannot be applied to a draft invoice'); end;
  insert into public.case_payments (case_id, amount, currency, method, invoice_id) select id, 600, 'USD', 'bank_transfer', v_inv from public.cases where patient_ref = 'P-001';
  perform t.ok((select count(*) = 1 from public.case_payments where invoice_id = v_inv), 'a receipt can be applied to an issued invoice');
  begin
    update public.case_invoices set currency = 'EUR' where id = v_inv;
    perform t.ok(false, 'currency change after payment must be refused');
  exception when invalid_parameter_value then perform t.ok(true, 'the currency of a paid invoice cannot change'); end;
  delete from public.case_invoices where id = v_empty;
  perform t.ok((select count(*) = 0 from public.case_invoices where id = v_empty), 'a draft invoice can be deleted');
  insert into public.case_invoices (case_id, notes) select id, 'draft for agent visibility test' from public.cases where patient_ref = 'P-001';
end $$;
reset role;

select t.login('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
select t.ok((select count(*) = 1 from public.case_invoices), 'agent sees the issued invoice of his case, not drafts');
select t.ok((select count(*) = 2 from public.case_invoice_items), 'agent sees the lines of the issued invoice');
select t.ok((select count(*) = 0 from public.case_price_items), 'agent cannot read the internal price list');
do $$ begin
  perform public.log_invoice_revision((select id from public.case_invoices limit 1), 0, 'x');
  perform t.ok(false, 'agent must not log revisions');
exception when insufficient_privilege then perform t.ok(true, 'agent cannot revise invoices'); end $$;
select t.ok((select count(*) = 1 from public.case_billing_settings), 'agent can read the billing details printed on invoices');
do $$ begin
  update public.case_billing_settings set bank_details = 'hacked';
  perform t.ok((select coalesce(bank_details, '') <> 'hacked' from public.case_billing_settings), 'agent cannot change billing details');
end $$;
do $$ begin
  insert into public.case_invoices (case_id) select id from public.cases where patient_ref = 'P-001';
  perform t.ok(false, 'agent must not create invoices');
exception when insufficient_privilege then perform t.ok(true, 'agent cannot create invoices'); end $$;
do $$ begin
  update public.case_invoices set discount_amount = 999;
  perform t.ok((select discount_amount = 20 from public.case_invoices), 'agent cannot change an invoice');
end $$;
reset role;

select t.login('00000000-0000-0000-0000-0000000000a2');
set role authenticated;
select t.ok((select count(*) = 0 from public.case_invoices) and (select count(*) = 0 from public.case_invoice_items), 'agent 2 cannot see agent 1 invoices');
reset role;

select t.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
do $$ begin
  update public.case_invoices set status = 'void', void_reason = 'Wrong retainer quantity' where status = 'issued';
  perform t.ok((select status = 'void' and invoice_no is not null from public.case_invoices where void_reason is not null), 'an issued invoice can be voided and keeps its number');
  begin
    update public.case_invoices set status = 'issued' where status = 'void';
    perform t.ok(false, 'voided invoice must stay void');
  exception when insufficient_privilege then perform t.ok(true, 'a voided invoice cannot be re-opened'); end;
end $$;
reset role;

-- =====================================================================
-- CASH BOXES
-- =====================================================================
select t.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select t.ok((select count(*) >= 3 from public.cash_accounts), 'case manager sees the cash boxes');
do $$ declare usd uuid; egp uuid; v_pay uuid; v_no text; v_tr uuid; begin
  select id into usd from public.cash_accounts where name = 'USD cash box';
  select id into egp from public.cash_accounts where name = 'Main cash box (EGP)';
  -- case payment deposited into the USD box
  insert into public.case_payments (case_id, amount, currency, method, cash_account_id)
    select id, 50, 'USD', 'cash', usd from public.cases where patient_ref = 'P-001' returning id into v_pay;
  select entry_no into v_no from public.cash_entries where case_payment_id = v_pay;
  perform t.ok(v_no ~ '^CR-[0-9]{2}-[0-9]{5}$', 'a case payment deposited in a box creates a receipt voucher (' || v_no || ')');
  perform t.ok(public.cash_balance(usd) = 50, 'box balance includes the payment');
  begin
    insert into public.case_payments (case_id, amount, currency, method, cash_account_id) select id, 5, 'EUR', 'cash', usd from public.cases where patient_ref = 'P-001';
    perform t.ok(false, 'currency mismatch box/payment');
  exception when invalid_parameter_value then perform t.ok(true, 'a payment can only go to a box of the same currency'); end;
  begin
    insert into public.cash_entries (account_id, direction, amount, currency, category, party_name) values (usd, 'out', 80, 'USD', 'withdrawal', 'Ali');
    perform t.ok(false, 'overdraft must be refused');
  exception when invalid_parameter_value then perform t.ok(true, 'a box cannot pay out more than its balance'); end;
  insert into public.cash_entries (account_id, direction, amount, currency, category, party_user, description)
    values (usd, 'out', 30, 'USD', 'advance', '00000000-0000-0000-0000-0000000000c1', 'Courier advance') returning entry_no into v_no;
  perform t.ok(v_no ~ '^CP-[0-9]{2}-[0-9]{5}$', 'a withdrawal gets a payment voucher number (' || v_no || ')');
  insert into public.cash_entries (account_id, direction, amount, currency, category, party_user)
    values (usd, 'in', 10, 'USD', 'advance_return', '00000000-0000-0000-0000-0000000000c1');
  perform t.ok(public.cash_balance(usd) = 30, 'returned custody goes back into the box');
  perform t.ok((select sum(case when direction = 'out' then amount else -amount end) = 20 from public.cash_entries
                where party_user = '00000000-0000-0000-0000-0000000000c1' and not voided), 'person account: taken minus returned');
  v_tr := public.cash_transfer(usd, egp, 20, 1000, current_date, 'Exchange');
  perform t.ok(public.cash_balance(usd) = 10 and public.cash_balance(egp) = 1000, 'transfer with exchange moves money between boxes');
  update public.cash_entries set voided = true, void_reason = 'wrong rate' where transfer_group = v_tr and direction = 'out';
  perform t.ok((select bool_and(voided) from public.cash_entries where transfer_group = v_tr), 'voiding one side voids the whole transfer');
  perform t.ok(public.cash_balance(usd) = 30 and public.cash_balance(egp) = 0, 'balances restored after voiding the transfer');
  begin
    insert into public.cash_entries (account_id, direction, amount, currency, category) values (usd, 'in', 999, 'USD', 'case_payment');
    perform t.ok(false, 'direct case_payment voucher must be refused');
  exception when insufficient_privilege then perform t.ok(true, 'case-payment vouchers can only come from a real case payment'); end;
  begin
    update public.cash_accounts set opening_balance = 500 where id = usd;
    perform t.ok(false, 'opening balance change must be refused');
  exception when invalid_parameter_value then perform t.ok(true, 'the opening balance is locked once vouchers exist'); end;
  update public.case_payments set voided = true, void_reason = 'refund' where id = v_pay;
  perform t.ok((select voided from public.cash_entries where case_payment_id = v_pay), 'voiding a case payment voids its cash receipt');
end $$;
reset role;

select t.login('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
select t.ok((select count(*) = 0 from public.cash_accounts) and (select count(*) = 0 from public.cash_entries), 'agents cannot see cash boxes or vouchers');
do $$ begin
  insert into public.cash_accounts (name) values ('Agent box');
  perform t.ok(false, 'agent must not create boxes');
exception when insufficient_privilege then perform t.ok(true, 'agents cannot create cash boxes'); end $$;
reset role;

select t.login('00000000-0000-0000-0000-00000000000c');
set role authenticated;
select t.ok((select count(*) = 0 from public.cash_entries), 'sales manager cannot see the cash book');
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
select t.ok((select not public from storage.buckets where id = 'case-files'), 'clinical case-files bucket exists and is PRIVATE');
select t.ok((select count(*) = 2 from storage.buckets), 'no other buckets are created');

-- Every table in public has RLS enabled
select t.ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind = 'r'), 'Row Level Security is enabled on every public table');

\o
\echo
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from t.results;
