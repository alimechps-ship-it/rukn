-- =====================================================================
-- RUKN — Agents portal & case management
--   * new roles: case_manager (RUKN operations) and agent (field agents)
--   * coded cases (RK-EG-26-00001), timeline, secure clinical files,
--     payments with receipt numbers, records-intake and delivery numbers
--   * Row Level Security: an agent only ever sees his own cases
-- Run once in Supabase → SQL Editor (safe to re-run).
-- =====================================================================

alter type public.app_role add value if not exists 'case_manager';
alter type public.app_role add value if not exists 'agent';

-- NOTE: new enum values cannot be referenced as literals in this same
-- transaction, so role checks below compare role::text.

-- ---------------------------------------------------------------------
-- Agent details on the staff profile
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists phone text check (phone is null or char_length(phone) <= 40),
  add column if not exists country text check (country is null or char_length(country) <= 80),
  add column if not exists region text check (region is null or char_length(region) <= 120),
  add column if not exists organization text check (organization is null or char_length(organization) <= 160);

-- ---------------------------------------------------------------------
-- Role helpers
-- ---------------------------------------------------------------------
create or replace function public.role_names()
returns text[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(r.role::text), '{}')
  from public.user_roles r join public.profiles p on p.id = r.user_id and p.is_active
  where r.user_id = auth.uid();
$$;

-- Back-office staff = any role except "agent" (agents never see drafts, colleagues, logs …)
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from unnest(public.role_names()) r where r <> 'agent');
$$;

create or replace function public.is_case_staff()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.role_names() && array['super_admin', 'case_manager'];
$$;

create or replace function public.is_agent()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select 'agent' = any (public.role_names());
$$;

grant execute on function public.role_names(), public.is_staff(), public.is_case_staff(), public.is_agent() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Document numbering (RK-EG-26-00001, RR-26-00001, RC-26-00001, DN-26-00001)
-- ---------------------------------------------------------------------
create table if not exists public.doc_counters (
  kind text not null,
  yr   int  not null,
  last int  not null default 0,
  primary key (kind, yr)
);
alter table public.doc_counters enable row level security;   -- no policies: only definer functions touch it
revoke all on public.doc_counters from anon, authenticated;

create or replace function public.next_doc_no(p_kind text)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v int; y int := extract(year from now())::int;
begin
  insert into public.doc_counters (kind, yr, last) values (p_kind, y, 1)
  on conflict (kind, yr) do update set last = public.doc_counters.last + 1
  returning last into v;
  return v;
end $$;
revoke all on function public.next_doc_no(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Cases
-- ---------------------------------------------------------------------
do $$ begin
  create type public.case_status as enum ('submitted', 'records_received', 'diagnosis', 'planning', 'awaiting_approval',
    'revision', 'approved', 'production', 'quality_check', 'shipped', 'delivered', 'on_hold', 'cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.cases (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,
  agent_id            uuid not null references public.profiles (id) on delete restrict,
  assigned_to         uuid references public.profiles (id) on delete set null,
  service_id          uuid references public.services (id) on delete set null,
  service_label       text check (char_length(service_label) <= 160),
  status              public.case_status not null default 'submitted',
  priority            text not null default 'normal' check (priority in ('normal', 'urgent')),
  -- clinic / treating doctor
  clinic_name         text not null check (char_length(clinic_name) between 2 and 160),
  doctor_name         text not null check (char_length(doctor_name) between 2 and 120),
  doctor_phone        text check (char_length(doctor_phone) <= 40),
  doctor_email        text check (doctor_email is null or doctor_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  country_code        text not null check (country_code ~ '^[A-Z]{2}$'),
  city                text check (char_length(city) <= 80),
  -- patient (minimum necessary: reference, not full name)
  patient_ref         text not null check (char_length(patient_ref) between 1 and 60),
  patient_age         int check (patient_age is null or patient_age between 0 and 120),
  patient_sex         text check (patient_sex in ('female', 'male', 'unspecified')),
  arches              text check (arches in ('upper', 'lower', 'both', 'na')),
  description         text check (char_length(description) <= 4000),
  due_date            date,
  -- records intake (receipt)
  intake_no           text unique,
  intake_items        jsonb not null default '[]'::jsonb check (jsonb_typeof(intake_items) = 'array'),
  intake_received_at  timestamptz,
  intake_received_by  uuid references public.profiles (id) on delete set null,
  intake_notes        text check (char_length(intake_notes) <= 1000),
  -- plan approval
  plan_approved_at    timestamptz,
  plan_approved_by    text check (char_length(plan_approved_by) <= 120),
  -- commercial
  quote_amount        numeric(12, 2) check (quote_amount is null or quote_amount >= 0),
  quote_currency      text check (quote_currency is null or quote_currency ~ '^[A-Z]{3}$'),
  -- shipping / delivery
  carrier             text check (char_length(carrier) <= 80),
  tracking_no         text check (char_length(tracking_no) <= 120),
  shipped_at          timestamptz,
  delivery_no         text unique,
  delivered_at        timestamptz,
  received_by_name    text check (char_length(received_by_name) <= 120),
  delivery_notes      text check (char_length(delivery_notes) <= 1000),
  closed_at           timestamptz,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists cases_agent_idx on public.cases (agent_id, created_at desc);
create index if not exists cases_status_idx on public.cases (status);
create index if not exists cases_created_idx on public.cases (created_at desc);

create table if not exists public.case_events (
  id          bigint generated always as identity primary key,
  case_id     uuid not null references public.cases (id) on delete cascade,
  kind        text not null check (kind in ('status', 'comment', 'internal', 'file', 'payment', 'approval', 'system')),
  from_status public.case_status,
  to_status   public.case_status,
  body        text check (char_length(body) <= 4000),
  author_id   uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists case_events_case_idx on public.case_events (case_id, created_at);

create table if not exists public.case_files (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references public.cases (id) on delete cascade,
  storage_path   text not null unique,
  filename       text not null check (char_length(filename) between 1 and 200),
  mime_type      text check (char_length(mime_type) <= 120),
  size_bytes     bigint check (size_bytes > 0),
  category       text not null default 'other' check (category in ('scan_upper', 'scan_lower', 'bite', 'photos', 'xray', 'prescription', 'treatment_plan', 'other')),
  is_deliverable boolean not null default false,   -- files RUKN sends to the agent (plans, reports)
  uploaded_by    uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists case_files_case_idx on public.case_files (case_id);

create table if not exists public.case_payments (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.cases (id) on delete restrict,
  receipt_no  text not null unique,
  amount      numeric(12, 2) not null check (amount > 0),
  currency    text not null check (currency ~ '^[A-Z]{3}$'),
  method      text not null check (method in ('cash', 'bank_transfer', 'card', 'online', 'other')),
  reference   text check (char_length(reference) <= 120),
  paid_at     date not null default current_date,
  notes       text check (char_length(notes) <= 500),
  received_by uuid references public.profiles (id) on delete set null,
  voided      boolean not null default false,
  void_reason text check (char_length(void_reason) <= 300),
  created_at  timestamptz not null default now()
);
create index if not exists case_payments_case_idx on public.case_payments (case_id);

-- ---------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------
create or replace function public.can_access_case(p_case uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_case_staff()
      or exists (select 1 from public.cases c where c.id = p_case and c.agent_id = auth.uid() and public.is_agent());
$$;

create or replace function public.case_id_from_path(p_name text)
returns uuid language plpgsql immutable as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then return null;
end $$;

grant execute on function public.can_access_case(uuid), public.case_id_from_path(text) to authenticated;

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
create or replace function public.tg_cases_before_insert()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_case_staff() then
    new.agent_id := auth.uid();            -- agents always create cases for themselves
    new.assigned_to := null;
    new.quote_amount := null; new.quote_currency := null;
  end if;
  new.status := 'submitted';
  new.code := 'RK-' || new.country_code || '-' || to_char(now(), 'YY') || '-' || lpad(public.next_doc_no('case')::text, 5, '0');
  new.created_by := auth.uid();
  new.intake_no := null; new.delivery_no := null; new.intake_received_at := null;
  new.plan_approved_at := null; new.shipped_at := null; new.delivered_at := null; new.closed_at := null;
  return new;
end $$;

create or replace function public.tg_cases_before_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.code := old.code;                               -- the case code never changes
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();
  if not public.is_case_staff() then
    -- agents may only correct case details while the case is still "submitted"
    if old.status <> 'submitted' and current_setting('rukn.rpc', true) is distinct from 'on' then
      raise exception 'This case can no longer be edited. Add a comment instead.' using errcode = '42501';
    end if;
    if current_setting('rukn.rpc', true) is distinct from 'on' then
      new.status := old.status;
    end if;
    new.agent_id := old.agent_id; new.assigned_to := old.assigned_to;
    new.intake_no := old.intake_no; new.intake_items := old.intake_items; new.intake_received_at := old.intake_received_at;
    new.intake_received_by := old.intake_received_by; new.intake_notes := old.intake_notes;
    new.quote_amount := old.quote_amount; new.quote_currency := old.quote_currency;
    new.carrier := old.carrier; new.tracking_no := old.tracking_no; new.shipped_at := old.shipped_at;
    new.delivery_no := old.delivery_no; new.delivered_at := old.delivered_at; new.received_by_name := old.received_by_name;
    new.delivery_notes := old.delivery_notes; new.closed_at := old.closed_at;
    if current_setting('rukn.rpc', true) is distinct from 'on' then
      new.plan_approved_at := old.plan_approved_at; new.plan_approved_by := old.plan_approved_by;
    end if;
  end if;
  -- automatic document numbers and dates
  if new.intake_received_at is not null and old.intake_no is null then
    new.intake_no := 'RR-' || to_char(now(), 'YY') || '-' || lpad(public.next_doc_no('intake')::text, 5, '0');
    new.intake_received_by := coalesce(new.intake_received_by, auth.uid());
  end if;
  if new.status = 'shipped' and new.shipped_at is null then new.shipped_at := now(); end if;
  if new.status = 'delivered' then
    new.delivered_at := coalesce(new.delivered_at, now());
    if old.delivery_no is null then
      new.delivery_no := 'DN-' || to_char(now(), 'YY') || '-' || lpad(public.next_doc_no('delivery')::text, 5, '0');
    end if;
  end if;
  if new.status in ('delivered', 'cancelled') and old.status not in ('delivered', 'cancelled') then new.closed_at := now(); end if;
  if new.status not in ('delivered', 'cancelled') then new.closed_at := null; end if;
  return new;
end $$;

create or replace function public.tg_cases_after()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into public.case_events (case_id, kind, to_status, body, author_id)
    values (new.id, 'system', new.status, 'Case submitted', auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.case_events (case_id, kind, from_status, to_status, author_id)
    values (new.id, 'status', old.status, new.status, auth.uid());
  end if;
  return null;
end $$;

drop trigger if exists cases_before_insert on public.cases;
create trigger cases_before_insert before insert on public.cases for each row execute function public.tg_cases_before_insert();
drop trigger if exists cases_before_update on public.cases;
create trigger cases_before_update before update on public.cases for each row execute function public.tg_cases_before_update();
drop trigger if exists cases_after on public.cases;
create trigger cases_after after insert or update on public.cases for each row execute function public.tg_cases_after();

create or replace function public.tg_case_files_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_case_staff() then new.is_deliverable := false; end if;
  new.uploaded_by := auth.uid();
  return new;
end $$;
drop trigger if exists case_files_guard on public.case_files;
create trigger case_files_guard before insert on public.case_files for each row execute function public.tg_case_files_guard();

create or replace function public.tg_case_files_event()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.case_events (case_id, kind, body, author_id)
  values (new.case_id, 'file', new.filename, auth.uid());
  return null;
end $$;
drop trigger if exists case_files_event on public.case_files;
create trigger case_files_event after insert on public.case_files for each row execute function public.tg_case_files_event();

create or replace function public.tg_case_payments_before()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.receipt_no := 'RC-' || to_char(now(), 'YY') || '-' || lpad(public.next_doc_no('receipt')::text, 5, '0');
    new.received_by := auth.uid();
  else
    new.receipt_no := old.receipt_no; new.case_id := old.case_id; new.created_at := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists case_payments_before on public.case_payments;
create trigger case_payments_before before insert or update on public.case_payments for each row execute function public.tg_case_payments_before();

create or replace function public.tg_case_payments_event()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into public.case_events (case_id, kind, body, author_id)
    values (new.case_id, 'payment', new.receipt_no || ' · ' || new.amount || ' ' || new.currency, auth.uid());
  elsif new.voided and not old.voided then
    insert into public.case_events (case_id, kind, body, author_id)
    values (new.case_id, 'payment', new.receipt_no || ' voided' || coalesce(': ' || new.void_reason, ''), auth.uid());
  end if;
  return null;
end $$;
drop trigger if exists case_payments_event on public.case_payments;
create trigger case_payments_event after insert or update on public.case_payments for each row execute function public.tg_case_payments_event();

-- audit trail
drop trigger if exists cases_audit on public.cases;
create trigger cases_audit after update or delete on public.cases for each row execute function public.tg_audit();
drop trigger if exists case_payments_audit on public.case_payments;
create trigger case_payments_audit after insert or update or delete on public.case_payments for each row execute function public.tg_audit();
drop trigger if exists case_files_audit on public.case_files;
create trigger case_files_audit after delete on public.case_files for each row execute function public.tg_audit();

-- ---------------------------------------------------------------------
-- Treating-doctor decision on the plan (agent or case staff)
-- ---------------------------------------------------------------------
create or replace function public.decide_case_plan(p_case uuid, p_decision text, p_doctor text, p_comment text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.cases%rowtype;
begin
  select * into c from public.cases where id = p_case;
  if not found or not public.can_access_case(p_case) then raise exception 'Case not found' using errcode = '42501'; end if;
  if c.status <> 'awaiting_approval' then raise exception 'The plan is not awaiting approval.' using errcode = '22023'; end if;
  if p_decision not in ('approve', 'revision') then raise exception 'Invalid decision' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_doctor, ''))) < 2 then raise exception 'Enter the name of the approving doctor.' using errcode = '22023'; end if;
  perform set_config('rukn.rpc', 'on', true);
  update public.cases
     set status = case when p_decision = 'approve' then 'approved'::public.case_status else 'revision'::public.case_status end,
         plan_approved_at = case when p_decision = 'approve' then now() else null end,
         plan_approved_by = case when p_decision = 'approve' then left(btrim(p_doctor), 120) else null end
   where id = p_case;
  perform set_config('rukn.rpc', 'off', true);
  insert into public.case_events (case_id, kind, body, author_id)
  values (p_case, 'approval',
          (case when p_decision = 'approve' then 'Plan approved by ' else 'Revision requested by ' end) || left(btrim(p_doctor), 120)
          || coalesce(' — ' || nullif(btrim(p_comment), ''), ''), auth.uid());
end $$;
revoke all on function public.decide_case_plan(uuid, text, text, text) from public, anon;
grant execute on function public.decide_case_plan(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.cases enable row level security;
alter table public.case_events enable row level security;
alter table public.case_files enable row level security;
alter table public.case_payments enable row level security;
revoke all on public.cases, public.case_events, public.case_files, public.case_payments from anon;
grant select, insert, update, delete on public.cases, public.case_events, public.case_files, public.case_payments to authenticated;

drop policy if exists cases_select on public.cases;
drop policy if exists cases_insert on public.cases;
drop policy if exists cases_update on public.cases;
drop policy if exists cases_delete on public.cases;
create policy cases_select on public.cases for select to authenticated
  using (public.is_case_staff() or (agent_id = auth.uid() and public.is_agent()));
create policy cases_insert on public.cases for insert to authenticated
  with check (public.is_case_staff() or (agent_id = auth.uid() and public.is_agent()));
create policy cases_update on public.cases for update to authenticated
  using (public.is_case_staff() or (agent_id = auth.uid() and public.is_agent()))
  with check (public.is_case_staff() or (agent_id = auth.uid() and public.is_agent()));
create policy cases_delete on public.cases for delete to authenticated using (public.is_super_admin());

drop policy if exists case_events_select on public.case_events;
drop policy if exists case_events_insert on public.case_events;
drop policy if exists case_events_update on public.case_events;
drop policy if exists case_events_delete on public.case_events;
create policy case_events_select on public.case_events for select to authenticated
  using (public.is_case_staff() or (kind <> 'internal' and public.can_access_case(case_id)));
create policy case_events_insert on public.case_events for insert to authenticated
  with check (author_id = auth.uid() and (
    (public.is_case_staff() and kind in ('comment', 'internal'))
    or (kind = 'comment' and public.can_access_case(case_id))));
create policy case_events_update on public.case_events for update to authenticated using (false);
create policy case_events_delete on public.case_events for delete to authenticated using (public.is_super_admin());

drop policy if exists case_files_select on public.case_files;
drop policy if exists case_files_insert on public.case_files;
drop policy if exists case_files_update on public.case_files;
drop policy if exists case_files_delete on public.case_files;
create policy case_files_select on public.case_files for select to authenticated using (public.can_access_case(case_id));
create policy case_files_insert on public.case_files for insert to authenticated
  with check (public.can_access_case(case_id) and public.case_id_from_path(storage_path) = case_id);
create policy case_files_update on public.case_files for update to authenticated using (public.is_case_staff()) with check (public.is_case_staff());
create policy case_files_delete on public.case_files for delete to authenticated
  using (public.is_case_staff() or (uploaded_by = auth.uid() and exists (select 1 from public.cases c where c.id = case_id and c.status = 'submitted')));

drop policy if exists case_payments_select on public.case_payments;
drop policy if exists case_payments_insert on public.case_payments;
drop policy if exists case_payments_update on public.case_payments;
drop policy if exists case_payments_delete on public.case_payments;
create policy case_payments_select on public.case_payments for select to authenticated using (public.can_access_case(case_id));
create policy case_payments_insert on public.case_payments for insert to authenticated with check (public.is_case_staff());
create policy case_payments_update on public.case_payments for update to authenticated using (public.is_case_staff()) with check (public.is_case_staff());
create policy case_payments_delete on public.case_payments for delete to authenticated using (false);

-- Agents and case staff need to see the names of the people on their cases
drop policy if exists profiles_select on public.profiles;
-- Agents may see the names/contacts of RUKN case staff (who handle their cases).
create or replace function public.is_case_staff_user(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles r where r.user_id = p_user and r.role::text in ('super_admin', 'case_manager'));
$$;
revoke all on function public.is_case_staff_user(uuid) from public;
grant execute on function public.is_case_staff_user(uuid) to authenticated;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff()
         or (public.is_agent() and public.is_case_staff_user(profiles.id)));

-- Case staff can list agents and case managers (to assign cases)
drop policy if exists user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin()
         or (public.is_case_staff() and role::text in ('agent', 'case_manager', 'super_admin')));

-- Audit log: case managers see case activity
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated using (
  public.is_super_admin()
  or (public.can_manage_content() and entity_type not in ('inquiries', 'inquiry_notes', 'profiles', 'user_roles', 'private_settings', 'cases', 'case_payments', 'case_files'))
  or (public.has_role('sales_manager') and entity_type in ('inquiries', 'inquiry_notes'))
  or (public.has_role('translator') and entity_type like '%translations')
  or (public.is_case_staff() and entity_type in ('cases', 'case_payments', 'case_files')));

-- ---------------------------------------------------------------------
-- Private storage bucket for clinical files (never public)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('case-files', 'case-files', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "case_files_read" on storage.objects;
drop policy if exists "case_files_upload" on storage.objects;
drop policy if exists "case_files_remove" on storage.objects;
create policy "case_files_read" on storage.objects for select to authenticated
  using (bucket_id = 'case-files' and public.can_access_case(public.case_id_from_path(name)));
create policy "case_files_upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'case-files' and public.can_access_case(public.case_id_from_path(name))
              and lower(split_part(name, '.', -1)) in ('stl', 'ply', 'obj', '3mf', 'zip', 'pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'dcm', 'mp4', 'mov'));
create policy "case_files_remove" on storage.objects for delete to authenticated
  using (bucket_id = 'case-files' and public.can_access_case(public.case_id_from_path(name)));
