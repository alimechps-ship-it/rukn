-- =====================================================================
-- RUKN — Partners: treatment-planning doctors/clinics and production labs
--   * partners          : the external planners and labs RUKN works with
--   * roles planner/lab : partner users (linked by profiles.partner_id)
--   * case_assignments  : work orders WO-YY-##### sent to a partner for a case
--                         (planning or production), with agreed cost
--   * assignment_events : messages / status history of a work order
--   * partner files     : files a partner uploads stay internal (RUKN only)
--                         until RUKN sends them to the agent
--   * partner_bills     : bills PB-YY-##### from partners (lines = work orders)
--   * partner_payments  : payments PP-YY-##### to partners, paid from a cash box
-- Partners see ONLY their own work orders, the clinical brief and files of
-- those cases — never prices to clinics, agents, payments or other partners.
-- Safe to re-run.
-- =====================================================================

alter type public.app_role add value if not exists 'planner';
alter type public.app_role add value if not exists 'lab';

-- ---------------------------------------------------------------------
-- Partners
-- ---------------------------------------------------------------------
create table if not exists public.partners (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('planner', 'lab')),
  name          text not null unique check (char_length(name) between 2 and 120),
  contact_name  text check (char_length(contact_name) <= 120),
  phone         text check (char_length(phone) <= 40),
  email         text check (char_length(email) <= 200),
  country       text check (char_length(country) <= 80),
  city          text check (char_length(city) <= 80),
  address       text check (char_length(address) <= 300),
  currency      text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  tax_number    text check (char_length(tax_number) <= 60),
  bank_details  text check (char_length(bank_details) <= 1000),
  notes         text check (char_length(notes) <= 1000),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

alter table public.profiles add column if not exists partner_id uuid references public.partners (id) on delete set null;

-- Back-office staff = any role except agents and partners
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from unnest(public.role_names()) r where r not in ('agent', 'planner', 'lab'));
$$;

create or replace function public.is_partner()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.role_names() && array['planner', 'lab'];
$$;

create or replace function public.my_partner()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select p.partner_id from public.profiles p where p.id = auth.uid() and public.is_partner();
$$;
grant execute on function public.is_staff(), public.is_partner(), public.my_partner() to anon, authenticated;

-- Profiles: a partner user sees his own profile and RUKN case staff (names on messages)
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff()
         or ((public.is_agent() or public.is_partner()) and public.is_case_staff_user(profiles.id)));

-- ---------------------------------------------------------------------
-- Work orders
-- ---------------------------------------------------------------------
create table if not exists public.case_assignments (
  id            uuid primary key default gen_random_uuid(),
  order_no      text unique,
  case_id       uuid not null references public.cases (id) on delete cascade,
  partner_id    uuid not null references public.partners (id) on delete restrict,
  kind          text not null check (kind in ('planning', 'production')),
  title         text not null check (char_length(title) between 2 and 200),
  instructions  text check (char_length(instructions) <= 4000),
  items         jsonb not null default '[]'::jsonb,
  due_date      date,
  cost_amount   numeric(12, 2) check (cost_amount >= 0),
  currency      text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  status        text not null default 'assigned' check (status in ('assigned', 'accepted', 'in_progress', 'completed', 'shipped', 'received', 'cancelled', 'rejected')),
  carrier       text check (char_length(carrier) <= 80),
  tracking_no   text check (char_length(tracking_no) <= 120),
  accepted_at   timestamptz,
  completed_at  timestamptz,
  shipped_at    timestamptz,
  received_at   timestamptz,
  partner_note  text check (char_length(partner_note) <= 1000),
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists case_assignments_case_idx on public.case_assignments (case_id);
create index if not exists case_assignments_partner_idx on public.case_assignments (partner_id, status);

create table if not exists public.assignment_events (
  id            bigint generated always as identity primary key,
  assignment_id uuid not null references public.case_assignments (id) on delete cascade,
  kind          text not null default 'comment' check (kind in ('status', 'comment')),
  body          text not null check (char_length(body) between 1 and 4000),
  author_id     uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists assignment_events_idx on public.assignment_events (assignment_id, created_at);

create or replace function public.partner_can_access_case(p_case uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_partner() and exists (
    select 1 from public.case_assignments a
     where a.case_id = p_case and a.partner_id = public.my_partner() and a.status not in ('cancelled', 'rejected'));
$$;
grant execute on function public.partner_can_access_case(uuid) to authenticated;

create or replace function public.tg_assignments_before()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare p record;
begin
  if tg_op = 'INSERT' then
    select * into p from public.partners where id = new.partner_id;
    if p.id is null or not p.active then raise exception 'Choose an active partner.' using errcode = '22023'; end if;
    if (p.kind = 'planner' and new.kind <> 'planning') or (p.kind = 'lab' and new.kind <> 'production') then
      raise exception 'Planning orders go to planners, production orders go to labs.' using errcode = '22023';
    end if;
    new.order_no := 'WO-' || to_char(now(), 'YY') || '-' || lpad(public.next_doc_no('work_order')::text, 5, '0');
    new.status := 'assigned'; new.created_by := auth.uid();
    new.accepted_at := null; new.completed_at := null; new.shipped_at := null; new.received_at := null;
    if new.currency is null then new.currency := p.currency; end if;
    return new;
  end if;
  new.order_no := old.order_no; new.case_id := old.case_id; new.created_by := old.created_by; new.created_at := old.created_at;
  if new.partner_id <> old.partner_id and old.status <> 'assigned' then
    raise exception 'The partner can only be changed before the order is accepted.' using errcode = '22023';
  end if;
  if new.status <> old.status then
    if new.status = 'accepted' and new.accepted_at is null then new.accepted_at := now(); end if;
    if new.status = 'completed' and new.completed_at is null then new.completed_at := now(); end if;
    if new.status = 'shipped' and new.shipped_at is null then new.shipped_at := now(); end if;
    if new.status = 'received' and new.received_at is null then new.received_at := now(); end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists assignments_before on public.case_assignments;
create trigger assignments_before before insert or update on public.case_assignments for each row execute function public.tg_assignments_before();

create or replace function public.tg_assignments_after()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_partner text;
begin
  select name into v_partner from public.partners where id = new.partner_id;
  if tg_op = 'INSERT' then
    insert into public.assignment_events (assignment_id, kind, body, author_id) values (new.id, 'status', 'Work order created — assigned', auth.uid());
    insert into public.case_events (case_id, kind, body, author_id)
    values (new.case_id, 'internal', 'Work order ' || new.order_no || ' (' || new.kind || ') sent to ' || v_partner, auth.uid());
  elsif new.status <> old.status then
    insert into public.assignment_events (assignment_id, kind, body, author_id)
    values (new.id, 'status', old.status || ' → ' || new.status || coalesce(' — ' || nullif(btrim(current_setting('rukn.wo_note', true)), ''), ''), auth.uid());
    insert into public.case_events (case_id, kind, body, author_id)
    values (new.case_id, 'internal', 'Work order ' || new.order_no || ' (' || v_partner || '): ' || old.status || ' → ' || new.status, auth.uid());
  end if;
  return null;
end $$;
drop trigger if exists assignments_after on public.case_assignments;
create trigger assignments_after after insert or update on public.case_assignments for each row execute function public.tg_assignments_after();

-- Partner actions on his own work order
create or replace function public.partner_work_action(p_id uuid, p_action text, p_note text default null, p_carrier text default null, p_tracking text default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.case_assignments%rowtype; v_to text;
begin
  select * into a from public.case_assignments where id = p_id for update;
  if not found or a.partner_id is distinct from public.my_partner() then raise exception 'Work order not found.' using errcode = '42501'; end if;
  v_to := case
    when p_action = 'accept'   and a.status = 'assigned' then 'accepted'
    when p_action = 'reject'   and a.status = 'assigned' then 'rejected'
    when p_action = 'start'    and a.status = 'accepted' then 'in_progress'
    when p_action = 'complete' and a.status in ('accepted', 'in_progress') then 'completed'
    when p_action = 'ship'     and a.kind = 'production' and a.status in ('completed', 'in_progress', 'accepted') then 'shipped'
    else null end;
  if v_to is null then raise exception 'This step is not possible now (order is %).', a.status using errcode = '22023'; end if;
  if v_to = 'rejected' and char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Write the reason for declining.' using errcode = '22023'; end if;
  perform set_config('rukn.wo_note', coalesce(left(p_note, 500), ''), true);
  update public.case_assignments
     set status = v_to,
         partner_note = coalesce(nullif(btrim(p_note), ''), partner_note),
         carrier = case when v_to = 'shipped' then coalesce(nullif(btrim(p_carrier), ''), carrier) else carrier end,
         tracking_no = case when v_to = 'shipped' then coalesce(nullif(btrim(p_tracking), ''), tracking_no) else tracking_no end
   where id = p_id;
  perform set_config('rukn.wo_note', '', true);
  return v_to;
end $$;
revoke all on function public.partner_work_action(uuid, text, text, text, text) from public, anon;
grant execute on function public.partner_work_action(uuid, text, text, text, text) to authenticated;

-- Clinical brief of the case for the partner (no clinic prices, agent, payments)
create or replace function public.work_order_brief(p_id uuid)
returns json language plpgsql stable security definer set search_path = public, pg_temp as $$
declare a public.case_assignments%rowtype; c public.cases%rowtype; p record;
begin
  select * into a from public.case_assignments where id = p_id;
  if not found then return null; end if;
  if not (public.is_case_staff() or a.partner_id = public.my_partner()) then return null; end if;
  select * into c from public.cases where id = a.case_id;
  select kind into p from public.partners where id = a.partner_id;
  return json_build_object(
    'case_code', c.code, 'service', c.service_label, 'patient_ref', c.patient_ref, 'patient_age', c.patient_age,
    'patient_sex', c.patient_sex, 'arches', c.arches, 'description', c.description, 'priority', c.priority,
    'case_status', c.status, 'country', c.country_code, 'records', c.intake_items,
    'treating_doctor', case when p.kind = 'planner' then c.doctor_name else null end,
    'plan_approved_at', c.plan_approved_at);
end $$;
grant execute on function public.work_order_brief(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Partner files: internal until RUKN sends them to the agent
-- ---------------------------------------------------------------------
alter table public.case_files add column if not exists internal boolean not null default false;

create or replace function public.tg_case_files_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_case_staff() then new.is_deliverable := false; end if;
  if public.is_partner() and not public.is_case_staff() then
    new.internal := true;
    if new.category not in ('treatment_plan', 'photos', 'other') then new.category := 'other'; end if;
  elsif not public.is_case_staff() then
    new.internal := false;
  end if;
  new.uploaded_by := auth.uid();
  return new;
end $$;

create or replace function public.tg_case_files_event()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.case_events (case_id, kind, body, author_id)
  values (new.case_id, case when new.internal then 'internal' else 'file' end,
          case when new.internal then 'Partner file: ' || new.filename else new.filename end, auth.uid());
  return null;
end $$;

-- Sending a file to the agent makes it visible (and deliverable)
create or replace function public.tg_case_files_update_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.is_deliverable and not old.is_deliverable then new.internal := false; end if;
  new.case_id := old.case_id; new.storage_path := old.storage_path; new.uploaded_by := old.uploaded_by;
  return new;
end $$;
drop trigger if exists case_files_update_guard on public.case_files;
create trigger case_files_update_guard before update on public.case_files for each row execute function public.tg_case_files_update_guard();

drop policy if exists case_files_select on public.case_files;
drop policy if exists case_files_insert on public.case_files;
drop policy if exists case_files_delete on public.case_files;
create policy case_files_select on public.case_files for select to authenticated using (
  public.is_case_staff()
  or (public.can_access_case(case_id) and not internal)
  or (public.partner_can_access_case(case_id) and category not in ('payment_proof', 'delivery_proof')));
create policy case_files_insert on public.case_files for insert to authenticated
  with check ((public.can_access_case(case_id) or public.partner_can_access_case(case_id)) and public.case_id_from_path(storage_path) = case_id);
create policy case_files_delete on public.case_files for delete to authenticated using (
  public.is_case_staff()
  or (uploaded_by = auth.uid() and (internal or exists (select 1 from public.cases c where c.id = case_id and c.status = 'submitted'))));

drop policy if exists "case_files_read" on storage.objects;
drop policy if exists "case_files_upload" on storage.objects;
drop policy if exists "case_files_remove" on storage.objects;
create policy "case_files_read" on storage.objects for select to authenticated
  using (bucket_id = 'case-files' and (public.can_access_case(public.case_id_from_path(name)) or public.partner_can_access_case(public.case_id_from_path(name))));
create policy "case_files_upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'case-files'
              and (public.can_access_case(public.case_id_from_path(name)) or public.partner_can_access_case(public.case_id_from_path(name)))
              and lower(split_part(name, '.', -1)) in ('stl', 'ply', 'obj', '3mf', 'zip', 'pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'dcm', 'mp4', 'mov'));
create policy "case_files_remove" on storage.objects for delete to authenticated
  using (bucket_id = 'case-files' and (public.can_access_case(public.case_id_from_path(name)) or public.partner_can_access_case(public.case_id_from_path(name))));

-- ---------------------------------------------------------------------
-- Partner bills and payments
-- ---------------------------------------------------------------------
create table if not exists public.partner_bills (
  id           uuid primary key default gen_random_uuid(),
  bill_no      text unique,
  partner_id   uuid not null references public.partners (id) on delete restrict,
  partner_ref  text check (char_length(partner_ref) <= 60),
  bill_date    date not null default current_date,
  due_date     date,
  currency     text not null check (currency ~ '^[A-Z]{3}$'),
  total        numeric(12, 2) not null default 0,
  status       text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected', 'void')),
  notes        text check (char_length(notes) <= 1000),
  review_note  text check (char_length(review_note) <= 300),
  created_by   uuid references public.profiles (id) on delete set null,
  reviewed_by  uuid references public.profiles (id) on delete set null,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists partner_bills_partner_idx on public.partner_bills (partner_id, status);

create table if not exists public.partner_bill_lines (
  id            uuid primary key default gen_random_uuid(),
  bill_id       uuid not null references public.partner_bills (id) on delete cascade,
  assignment_id uuid references public.case_assignments (id) on delete restrict,
  description   text not null check (char_length(description) between 1 and 300),
  qty           numeric(10, 2) not null default 1 check (qty > 0),
  unit_price    numeric(12, 2) not null default 0 check (unit_price >= 0),
  line_total    numeric(12, 2) generated always as (round(qty * unit_price, 2)) stored
);
create index if not exists partner_bill_lines_bill_idx on public.partner_bill_lines (bill_id);

create or replace function public.tg_partner_bills_before()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_case_staff() then new.partner_id := public.my_partner(); end if;
    if new.partner_id is null then raise exception 'Unknown partner.' using errcode = '42501'; end if;
    new.bill_no := 'PB-' || to_char(now(), 'YY') || '-' || lpad(public.next_doc_no('partner_bill')::text, 5, '0');
    new.status := 'submitted'; new.total := 0; new.created_by := auth.uid(); new.reviewed_by := null; new.reviewed_at := null; new.review_note := null;
    return new;
  end if;
  if current_setting('rukn.bill_total', true) = 'on' then return new; end if;
  new.bill_no := old.bill_no; new.partner_id := old.partner_id; new.created_by := old.created_by; new.created_at := old.created_at; new.total := old.total;
  if old.status in ('rejected', 'void') then raise exception 'This bill is closed.' using errcode = '42501'; end if;
  if old.status = 'approved' and new.status not in ('approved', 'void') then raise exception 'An approved bill can only be voided.' using errcode = '42501'; end if;
  if old.status = 'approved' and new.status = 'void'
     and exists (select 1 from public.partner_payments where bill_id = old.id and not voided) then
    raise exception 'Void the payments of this bill first.' using errcode = '22023';
  end if;
  if new.status <> old.status then new.reviewed_by := auth.uid(); new.reviewed_at := now(); end if;
  return new;
end $$;
drop trigger if exists partner_bills_before on public.partner_bills;
create trigger partner_bills_before before insert or update on public.partner_bills for each row execute function public.tg_partner_bills_before();

create or replace function public.tg_partner_bill_lines_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare b record; a record;
begin
  select * into b from public.partner_bills where id = coalesce(new.bill_id, old.bill_id);
  if b.status is not null and b.status <> 'submitted' then
    raise exception 'Lines can only change while the bill is awaiting review.' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' and new.assignment_id is not null then
    select * into a from public.case_assignments where id = new.assignment_id;
    if a.partner_id is distinct from b.partner_id then raise exception 'The work order belongs to another partner.' using errcode = '22023'; end if;
    if a.status not in ('completed', 'shipped', 'received') then raise exception 'Work order % is not completed yet.', a.order_no using errcode = '22023'; end if;
    if exists (select 1 from public.partner_bill_lines l join public.partner_bills x on x.id = l.bill_id
                where l.assignment_id = new.assignment_id and l.id <> new.id and x.status in ('submitted', 'approved')) then
      raise exception 'Work order % is already on another bill.', a.order_no using errcode = '22023';
    end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists partner_bill_lines_guard on public.partner_bill_lines;
create trigger partner_bill_lines_guard before insert or update or delete on public.partner_bill_lines for each row execute function public.tg_partner_bill_lines_guard();

create or replace function public.tg_partner_bill_lines_total()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_bill uuid := coalesce(new.bill_id, old.bill_id);
begin
  perform set_config('rukn.bill_total', 'on', true);
  update public.partner_bills set total = (select coalesce(sum(line_total), 0) from public.partner_bill_lines where bill_id = v_bill) where id = v_bill;
  perform set_config('rukn.bill_total', 'off', true);
  return null;
end $$;
drop trigger if exists partner_bill_lines_total on public.partner_bill_lines;
create trigger partner_bill_lines_total after insert or update or delete on public.partner_bill_lines for each row execute function public.tg_partner_bill_lines_total();

-- Cash categories for partner payments
alter table public.cash_entries drop constraint if exists cash_entries_category_check;
alter table public.cash_entries add constraint cash_entries_category_check check (category in (
  'case_payment', 'owner_deposit', 'advance_return', 'other_income',
  'withdrawal', 'advance', 'salary', 'supplies', 'lab', 'planning', 'shipping', 'rent', 'utilities', 'marketing', 'fees',
  'transfer', 'other'));

create table if not exists public.partner_payments (
  id              uuid primary key default gen_random_uuid(),
  payment_no      text unique,
  partner_id      uuid not null references public.partners (id) on delete restrict,
  bill_id         uuid references public.partner_bills (id) on delete restrict,
  amount          numeric(12, 2) not null check (amount > 0),
  currency        text not null check (currency ~ '^[A-Z]{3}$'),
  paid_at         date not null default current_date,
  method          text not null default 'bank_transfer' check (method in ('cash', 'bank_transfer', 'card', 'online', 'other')),
  reference       text check (char_length(reference) <= 120),
  notes           text check (char_length(notes) <= 500),
  cash_account_id uuid references public.cash_accounts (id) on delete restrict,
  voided          boolean not null default false,
  void_reason     text check (char_length(void_reason) <= 300),
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists partner_payments_partner_idx on public.partner_payments (partner_id);
alter table public.cash_entries add column if not exists partner_payment_id uuid unique references public.partner_payments (id) on delete set null;

create or replace function public.tg_partner_payments_before()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare b record; acc record;
begin
  if tg_op = 'UPDATE' then
    new.payment_no := old.payment_no; new.partner_id := old.partner_id; new.bill_id := old.bill_id; new.amount := old.amount;
    new.currency := old.currency; new.cash_account_id := old.cash_account_id; new.created_by := old.created_by; new.created_at := old.created_at;
    if old.voided then raise exception 'A voided payment cannot be changed.' using errcode = '42501'; end if;
    return new;
  end if;
  if new.bill_id is not null then
    select * into b from public.partner_bills where id = new.bill_id;
    if b.partner_id is distinct from new.partner_id or b.status <> 'approved' then
      raise exception 'Choose an approved bill of this partner.' using errcode = '22023';
    end if;
    new.currency := b.currency;
  end if;
  if new.cash_account_id is not null then
    select * into acc from public.cash_accounts where id = new.cash_account_id;
    if acc.id is null or not acc.active then raise exception 'Choose an open cash box.' using errcode = '22023'; end if;
    if acc.currency <> new.currency then
      raise exception 'The cash box "%" is in %, the payment is in %.', acc.name, acc.currency, new.currency using errcode = '22023';
    end if;
  end if;
  new.payment_no := 'PP-' || to_char(now(), 'YY') || '-' || lpad(public.next_doc_no('partner_payment')::text, 5, '0');
  new.created_by := auth.uid(); new.voided := false; new.void_reason := null;
  return new;
end $$;
drop trigger if exists partner_payments_before on public.partner_payments;
create trigger partner_payments_before before insert or update on public.partner_payments for each row execute function public.tg_partner_payments_before();

create or replace function public.tg_partner_payments_after()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare p record; b text;
begin
  select name, kind into p from public.partners where id = new.partner_id;
  if tg_op = 'INSERT' and new.cash_account_id is not null then
    select bill_no into b from public.partner_bills where id = new.bill_id;
    insert into public.cash_entries (account_id, direction, amount, currency, entry_date, category, party_name, description, reference, partner_payment_id)
    values (new.cash_account_id, 'out', new.amount, new.currency, new.paid_at, case when p.kind = 'lab' then 'lab' else 'planning' end,
            p.name, 'Payment ' || new.payment_no || ' to ' || p.name || coalesce(' · bill ' || b, ''), new.reference, new.id);
  elsif tg_op = 'UPDATE' and new.voided and not old.voided then
    perform set_config('rukn.cash_cascade', 'on', true);
    update public.cash_entries set voided = true, void_reason = coalesce(new.void_reason, 'Partner payment voided') where partner_payment_id = new.id and not voided;
    perform set_config('rukn.cash_cascade', 'off', true);
  end if;
  return null;
end $$;
drop trigger if exists partner_payments_after on public.partner_payments;
create trigger partner_payments_after after insert or update on public.partner_payments for each row execute function public.tg_partner_payments_after();

-- Payment vouchers linked to a partner payment are voided from the payment, not directly
create or replace function public.tg_cash_entries_partner_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    new.partner_payment_id := old.partner_payment_id;
    if old.partner_payment_id is not null and not old.voided and new.voided and current_setting('rukn.cash_cascade', true) is distinct from 'on' then
      raise exception 'This voucher comes from a partner payment — void the payment instead.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists cash_entries_partner_guard on public.cash_entries;
create trigger cash_entries_partner_guard before update on public.cash_entries for each row execute function public.tg_cash_entries_partner_guard();

-- Review of a bill by RUKN
create or replace function public.review_partner_bill(p_bill uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare b record;
begin
  if not public.is_case_staff() then raise exception 'Only RUKN case staff can review bills.' using errcode = '42501'; end if;
  select * into b from public.partner_bills where id = p_bill;
  if b.id is null or b.status <> 'submitted' then raise exception 'Only bills awaiting review can be approved or rejected.' using errcode = '22023'; end if;
  if p_decision = 'approve' then
    if b.total <= 0 then raise exception 'The bill has no amount.' using errcode = '22023'; end if;
    update public.partner_bills set status = 'approved', review_note = left(nullif(btrim(p_note), ''), 300) where id = p_bill;
  elsif p_decision = 'reject' then
    if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Write the reason so the partner can correct the bill.' using errcode = '22023'; end if;
    update public.partner_bills set status = 'rejected', review_note = left(btrim(p_note), 300) where id = p_bill;
  else
    raise exception 'Unknown decision.' using errcode = '22023';
  end if;
end $$;
revoke all on function public.review_partner_bill(uuid, text, text) from public, anon;
grant execute on function public.review_partner_bill(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------
alter table public.partners enable row level security;
alter table public.case_assignments enable row level security;
alter table public.assignment_events enable row level security;
alter table public.partner_bills enable row level security;
alter table public.partner_bill_lines enable row level security;
alter table public.partner_payments enable row level security;
revoke all on public.partners, public.case_assignments, public.assignment_events, public.partner_bills, public.partner_bill_lines, public.partner_payments from anon;
grant select, insert, update, delete on public.partners, public.case_assignments, public.assignment_events, public.partner_bills, public.partner_bill_lines, public.partner_payments to authenticated;

drop policy if exists partners_select on public.partners;
drop policy if exists partners_write on public.partners;
create policy partners_select on public.partners for select to authenticated using (public.is_case_staff() or id = public.my_partner());
create policy partners_write on public.partners for all to authenticated using (public.is_case_staff()) with check (public.is_case_staff());

drop policy if exists assignments_select on public.case_assignments;
drop policy if exists assignments_write on public.case_assignments;
create policy assignments_select on public.case_assignments for select to authenticated using (public.is_case_staff() or partner_id = public.my_partner());
create policy assignments_write on public.case_assignments for all to authenticated using (public.is_case_staff()) with check (public.is_case_staff());

drop policy if exists assignment_events_select on public.assignment_events;
drop policy if exists assignment_events_insert on public.assignment_events;
create policy assignment_events_select on public.assignment_events for select to authenticated
  using (public.is_case_staff() or exists (select 1 from public.case_assignments a where a.id = assignment_id and a.partner_id = public.my_partner()));
create policy assignment_events_insert on public.assignment_events for insert to authenticated
  with check (author_id = auth.uid() and kind = 'comment'
              and (public.is_case_staff() or exists (select 1 from public.case_assignments a where a.id = assignment_id and a.partner_id = public.my_partner())));

drop policy if exists partner_bills_select on public.partner_bills;
drop policy if exists partner_bills_insert on public.partner_bills;
drop policy if exists partner_bills_update on public.partner_bills;
drop policy if exists partner_bills_delete on public.partner_bills;
create policy partner_bills_select on public.partner_bills for select to authenticated using (public.is_case_staff() or partner_id = public.my_partner());
create policy partner_bills_insert on public.partner_bills for insert to authenticated with check (public.is_case_staff() or public.is_partner());
create policy partner_bills_update on public.partner_bills for update to authenticated using (public.is_case_staff()) with check (public.is_case_staff());
create policy partner_bills_delete on public.partner_bills for delete to authenticated
  using (status = 'submitted' and (public.is_case_staff() or (partner_id = public.my_partner() and created_by = auth.uid())));

drop policy if exists partner_bill_lines_select on public.partner_bill_lines;
drop policy if exists partner_bill_lines_write on public.partner_bill_lines;
create policy partner_bill_lines_select on public.partner_bill_lines for select to authenticated
  using (exists (select 1 from public.partner_bills b where b.id = bill_id));
create policy partner_bill_lines_write on public.partner_bill_lines for all to authenticated
  using (public.is_case_staff() or exists (select 1 from public.partner_bills b where b.id = bill_id and b.partner_id = public.my_partner() and b.created_by = auth.uid()))
  with check (public.is_case_staff() or exists (select 1 from public.partner_bills b where b.id = bill_id and b.partner_id = public.my_partner() and b.created_by = auth.uid()));

drop policy if exists partner_payments_select on public.partner_payments;
drop policy if exists partner_payments_write on public.partner_payments;
create policy partner_payments_select on public.partner_payments for select to authenticated using (public.is_case_staff() or partner_id = public.my_partner());
create policy partner_payments_write on public.partner_payments for all to authenticated using (public.is_case_staff()) with check (public.is_case_staff());
revoke delete on public.partner_payments from authenticated;

-- audit
drop trigger if exists partners_audit on public.partners;
create trigger partners_audit after insert or update or delete on public.partners for each row execute function public.tg_audit();
drop trigger if exists case_assignments_audit on public.case_assignments;
create trigger case_assignments_audit after insert or update or delete on public.case_assignments for each row execute function public.tg_audit();
drop trigger if exists partner_bills_audit on public.partner_bills;
create trigger partner_bills_audit after insert or update or delete on public.partner_bills for each row execute function public.tg_audit();
drop trigger if exists partner_payments_audit on public.partner_payments;
create trigger partner_payments_audit after insert or update or delete on public.partner_payments for each row execute function public.tg_audit();

drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated using (
  public.is_super_admin()
  or (public.can_manage_content() and entity_type not in ('inquiries', 'inquiry_notes', 'profiles', 'user_roles', 'private_settings', 'cases', 'case_payments', 'case_files', 'case_invoices', 'case_price_items', 'cash_accounts', 'cash_entries', 'case_payment_claims', 'partners', 'case_assignments', 'partner_bills', 'partner_payments'))
  or (public.has_role('sales_manager') and entity_type in ('inquiries', 'inquiry_notes'))
  or (public.has_role('translator') and entity_type like '%translations')
  or (public.is_case_staff() and entity_type in ('cases', 'case_payments', 'case_files', 'case_invoices', 'case_price_items', 'cash_accounts', 'cash_entries', 'case_payment_claims', 'partners', 'case_assignments', 'partner_bills', 'partner_payments')));

notify pgrst, 'reload schema';
