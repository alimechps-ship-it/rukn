-- =====================================================================
-- RUKN — Case invoices
--   * case_price_items   : price list (aligners, Snap-On, retainers, …)
--   * case_invoices      : one or more invoices per case, numbered INV-YY-#####
--   * case_invoice_items : invoice lines (qty × unit price), totals kept by triggers
--   * case_payments.invoice_id : a receipt can be applied to an invoice
-- Drafts are visible to RUKN case staff only; issued invoices are locked
-- (they can only be voided) and become visible to the agent of the case.
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Price list
-- ---------------------------------------------------------------------
create table if not exists public.case_price_items (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z0-9][A-Z0-9-]{1,23}$'),
  category    text not null default 'other' check (category in ('aligner', 'snap_on', 'retainer', 'planning', 'accessory', 'service', 'other')),
  name_en     text not null check (char_length(name_en) between 2 and 160),
  name_ar     text check (char_length(name_ar) <= 160),
  unit_en     text not null default 'piece' check (char_length(unit_en) <= 40),
  unit_ar     text check (char_length(unit_ar) <= 40),
  unit_price  numeric(12, 2) not null default 0 check (unit_price >= 0),
  currency    text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Billing defaults printed on invoices (one row)
create table if not exists public.case_billing_settings (
  id               int primary key default 1 check (id = 1),
  default_currency text not null default 'USD' check (default_currency ~ '^[A-Z]{3}$'),
  tax_label        text not null default 'VAT' check (char_length(tax_label) <= 30),
  tax_rate         numeric(5, 2) not null default 0 check (tax_rate between 0 and 100),
  due_days         int not null default 14 check (due_days between 0 and 365),
  tax_number       text check (char_length(tax_number) <= 60),
  bank_details     text check (char_length(bank_details) <= 1000),
  terms            text check (char_length(terms) <= 1000),
  updated_at       timestamptz not null default now()
);
insert into public.case_billing_settings (id, terms) values
  (1, 'Payment is due by the date shown. Please quote the invoice number with your transfer. · يُرجى السداد قبل تاريخ الاستحقاق مع ذكر رقم الفاتورة عند التحويل.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------
create table if not exists public.case_invoices (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references public.cases (id) on delete restrict,
  invoice_no      text unique,
  status          text not null default 'draft' check (status in ('draft', 'issued', 'void')),
  issue_date      date not null default current_date,
  due_date        date,
  currency        text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  bill_to         text check (char_length(bill_to) <= 600),
  discount_amount numeric(12, 2) not null default 0 check (discount_amount >= 0),
  tax_label       text not null default 'VAT' check (char_length(tax_label) <= 30),
  tax_rate        numeric(5, 2) not null default 0 check (tax_rate between 0 and 100),
  subtotal        numeric(12, 2) not null default 0,
  tax_amount      numeric(12, 2) not null default 0,
  total           numeric(12, 2) not null default 0,
  notes           text check (char_length(notes) <= 1500),
  void_reason     text check (char_length(void_reason) <= 300),
  created_by      uuid references public.profiles (id) on delete set null,
  issued_by       uuid references public.profiles (id) on delete set null,
  issued_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists case_invoices_case_idx on public.case_invoices (case_id);

create table if not exists public.case_invoice_items (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references public.case_invoices (id) on delete cascade,
  sort_order    int not null default 0,
  price_item_id uuid references public.case_price_items (id) on delete set null,
  code          text check (char_length(code) <= 24),
  description   text not null check (char_length(description) between 1 and 300),
  description_ar text check (char_length(description_ar) <= 300),
  arch          text check (arch in ('upper', 'lower', 'both')),
  unit          text check (char_length(unit) <= 40),
  qty           numeric(10, 2) not null default 1 check (qty > 0),
  unit_price    numeric(12, 2) not null default 0 check (unit_price >= 0),
  line_total    numeric(12, 2) generated always as (round(qty * unit_price, 2)) stored
);
alter table public.case_invoice_items add column if not exists description_ar text check (char_length(description_ar) <= 300);
create index if not exists case_invoice_items_invoice_idx on public.case_invoice_items (invoice_id);

alter table public.case_payments add column if not exists invoice_id uuid references public.case_invoices (id) on delete restrict;
create index if not exists case_payments_invoice_idx on public.case_payments (invoice_id);

-- ---------------------------------------------------------------------
-- Totals & locking
-- ---------------------------------------------------------------------
create or replace function public.recalc_case_invoice(p_invoice uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_sub numeric(12,2); v_disc numeric(12,2); v_rate numeric(5,2); v_tax numeric(12,2); v_net numeric(12,2);
begin
  select coalesce(sum(line_total), 0) into v_sub from public.case_invoice_items where invoice_id = p_invoice;
  select least(discount_amount, v_sub), tax_rate into v_disc, v_rate from public.case_invoices where id = p_invoice;
  v_net := v_sub - coalesce(v_disc, 0);
  v_tax := round(v_net * coalesce(v_rate, 0) / 100, 2);
  perform set_config('rukn.invoice_recalc', 'on', true);
  update public.case_invoices set subtotal = v_sub, tax_amount = v_tax, total = v_net + v_tax where id = p_invoice;
  perform set_config('rukn.invoice_recalc', 'off', true);
end $$;
revoke all on function public.recalc_case_invoice(uuid) from public, anon, authenticated;

create or replace function public.tg_case_invoices_before()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'draft'; new.invoice_no := null; new.issued_at := null; new.issued_by := null;
    new.subtotal := 0; new.tax_amount := 0; new.total := 0;
    new.created_by := auth.uid();
    return new;
  end if;
  -- internal total recalculation
  if current_setting('rukn.invoice_recalc', true) = 'on' then
    new.updated_at := now();
    return new;
  end if;
  new.case_id := old.case_id; new.created_by := old.created_by; new.created_at := old.created_at;
  new.subtotal := old.subtotal; new.tax_amount := old.tax_amount; new.total := old.total;
  if old.status = 'void' then
    raise exception 'A voided invoice cannot be changed.' using errcode = '42501';
  elsif old.status = 'issued' then
    if new.status <> 'void' then
      raise exception 'An issued invoice is locked. Void it and create a new one to make changes.' using errcode = '42501';
    end if;
    -- only the void reason may change
    new.invoice_no := old.invoice_no; new.issue_date := old.issue_date; new.due_date := old.due_date; new.currency := old.currency;
    new.bill_to := old.bill_to; new.discount_amount := old.discount_amount; new.tax_label := old.tax_label; new.tax_rate := old.tax_rate;
    new.notes := old.notes; new.issued_at := old.issued_at; new.issued_by := old.issued_by;
  else -- draft
    if new.status = 'void' then
      raise exception 'Delete a draft instead of voiding it.' using errcode = '22023';
    elsif new.status = 'issued' then
      if not exists (select 1 from public.case_invoice_items where invoice_id = new.id) then
        raise exception 'Add at least one line before issuing the invoice.' using errcode = '22023';
      end if;
      new.invoice_no := 'INV-' || to_char(now(), 'YY') || '-' || lpad(public.next_doc_no('invoice')::text, 5, '0');
      new.issued_at := now(); new.issued_by := auth.uid();
    else
      new.invoice_no := null; new.issued_at := null; new.issued_by := null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists case_invoices_before on public.case_invoices;
create trigger case_invoices_before before insert or update on public.case_invoices for each row execute function public.tg_case_invoices_before();

-- After an invoice changes: refresh totals (discount / tax changes), log events, sync the case quotation.
create or replace function public.tg_case_invoices_after()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cur text; v_n int; v_sum numeric(12,2);
begin
  if current_setting('rukn.invoice_recalc', true) = 'on' then return null; end if;
  if tg_op = 'UPDATE' and (new.discount_amount <> old.discount_amount or new.tax_rate <> old.tax_rate) and new.status = 'draft' then
    perform public.recalc_case_invoice(new.id);
  end if;
  if tg_op = 'UPDATE' and new.status <> old.status then
    if new.status = 'issued' then
      insert into public.case_events (case_id, kind, body, author_id)
      values (new.case_id, 'payment', 'Invoice ' || new.invoice_no || ' issued · ' || new.total || ' ' || new.currency, auth.uid());
    elsif new.status = 'void' then
      insert into public.case_events (case_id, kind, body, author_id)
      values (new.case_id, 'payment', 'Invoice ' || new.invoice_no || ' voided' || coalesce(': ' || new.void_reason, ''), auth.uid());
    end if;
    -- The case quotation follows the issued invoices (when they share one currency).
    select count(distinct currency), min(currency), coalesce(sum(total), 0) into v_n, v_cur, v_sum
      from public.case_invoices where case_id = new.case_id and status = 'issued';
    if v_n = 1 then
      update public.cases set quote_amount = v_sum, quote_currency = v_cur where id = new.case_id;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists case_invoices_after on public.case_invoices;
create trigger case_invoices_after after update on public.case_invoices for each row execute function public.tg_case_invoices_after();

-- Lines can only change while the invoice is a draft; totals follow automatically.
create or replace function public.tg_case_invoice_items_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_inv uuid := coalesce(new.invoice_id, old.invoice_id); v_status text;
begin
  select status into v_status from public.case_invoices where id = v_inv;
  if v_status is not null and v_status <> 'draft' then
    raise exception 'Lines of an issued or voided invoice cannot be changed.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.invoice_id <> old.invoice_id then
    raise exception 'A line cannot be moved to another invoice.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists case_invoice_items_guard on public.case_invoice_items;
create trigger case_invoice_items_guard before insert or update or delete on public.case_invoice_items for each row execute function public.tg_case_invoice_items_guard();

create or replace function public.tg_case_invoice_items_total()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.case_invoices where id = coalesce(new.invoice_id, old.invoice_id)) then
    perform public.recalc_case_invoice(coalesce(new.invoice_id, old.invoice_id));
  end if;
  return null;
end $$;
drop trigger if exists case_invoice_items_total on public.case_invoice_items;
create trigger case_invoice_items_total after insert or update or delete on public.case_invoice_items for each row execute function public.tg_case_invoice_items_total();

-- Only drafts can be deleted.
create or replace function public.tg_case_invoices_delete()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.status <> 'draft' then
    raise exception 'Only draft invoices can be deleted; void an issued invoice instead.' using errcode = '42501';
  end if;
  return old;
end $$;
drop trigger if exists case_invoices_delete on public.case_invoices;
create trigger case_invoices_delete before delete on public.case_invoices for each row execute function public.tg_case_invoices_delete();

-- A receipt applied to an invoice must match its case, be issued and use its currency.
create or replace function public.tg_case_payments_invoice()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare inv record;
begin
  if new.invoice_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.invoice_id is not distinct from old.invoice_id then return new; end if;
  select case_id, status, currency into inv from public.case_invoices where id = new.invoice_id;
  if inv.case_id is distinct from new.case_id then raise exception 'The invoice belongs to another case.' using errcode = '22023'; end if;
  if inv.status <> 'issued' then raise exception 'Payments can only be applied to an issued invoice.' using errcode = '22023'; end if;
  if inv.currency <> new.currency then raise exception 'Payment currency must match the invoice currency (%).', inv.currency using errcode = '22023'; end if;
  return new;
end $$;
drop trigger if exists case_payments_invoice on public.case_payments;
create trigger case_payments_invoice before insert or update on public.case_payments for each row execute function public.tg_case_payments_invoice();

drop trigger if exists case_invoices_audit on public.case_invoices;
create trigger case_invoices_audit after insert or update or delete on public.case_invoices for each row execute function public.tg_audit();
drop trigger if exists case_price_items_audit on public.case_price_items;
create trigger case_price_items_audit after insert or update or delete on public.case_price_items for each row execute function public.tg_audit();

-- ---------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------
alter table public.case_billing_settings enable row level security;
revoke all on public.case_billing_settings from anon;
grant select, update on public.case_billing_settings to authenticated;
drop policy if exists case_billing_select on public.case_billing_settings;
drop policy if exists case_billing_update on public.case_billing_settings;
create policy case_billing_select on public.case_billing_settings for select to authenticated using (public.is_case_staff() or public.is_agent());
create policy case_billing_update on public.case_billing_settings for update to authenticated using (public.is_case_staff()) with check (public.is_case_staff());

alter table public.case_price_items enable row level security;
alter table public.case_invoices enable row level security;
alter table public.case_invoice_items enable row level security;
revoke all on public.case_price_items, public.case_invoices, public.case_invoice_items from anon;
grant select, insert, update, delete on public.case_price_items, public.case_invoices, public.case_invoice_items to authenticated;

drop policy if exists case_price_items_select on public.case_price_items;
drop policy if exists case_price_items_write on public.case_price_items;
create policy case_price_items_select on public.case_price_items for select to authenticated using (public.is_case_staff());
create policy case_price_items_write on public.case_price_items for all to authenticated using (public.is_case_staff()) with check (public.is_case_staff());

drop policy if exists case_invoices_select on public.case_invoices;
drop policy if exists case_invoices_insert on public.case_invoices;
drop policy if exists case_invoices_update on public.case_invoices;
drop policy if exists case_invoices_delete on public.case_invoices;
create policy case_invoices_select on public.case_invoices for select to authenticated
  using (public.is_case_staff() or (status <> 'draft' and public.can_access_case(case_id)));
create policy case_invoices_insert on public.case_invoices for insert to authenticated with check (public.is_case_staff());
create policy case_invoices_update on public.case_invoices for update to authenticated using (public.is_case_staff()) with check (public.is_case_staff());
create policy case_invoices_delete on public.case_invoices for delete to authenticated using (public.is_case_staff());

drop policy if exists case_invoice_items_select on public.case_invoice_items;
drop policy if exists case_invoice_items_write on public.case_invoice_items;
create policy case_invoice_items_select on public.case_invoice_items for select to authenticated
  using (exists (select 1 from public.case_invoices i where i.id = invoice_id));
create policy case_invoice_items_write on public.case_invoice_items for all to authenticated
  using (public.is_case_staff()) with check (public.is_case_staff());

-- Case staff see invoice activity in the audit log
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated using (
  public.is_super_admin()
  or (public.can_manage_content() and entity_type not in ('inquiries', 'inquiry_notes', 'profiles', 'user_roles', 'private_settings', 'cases', 'case_payments', 'case_files', 'case_invoices', 'case_price_items'))
  or (public.has_role('sales_manager') and entity_type in ('inquiries', 'inquiry_notes'))
  or (public.has_role('translator') and entity_type like '%translations')
  or (public.is_case_staff() and entity_type in ('cases', 'case_payments', 'case_files', 'case_invoices', 'case_price_items')));

-- ---------------------------------------------------------------------
-- Starter price list (edit prices in the admin → Price list)
-- ---------------------------------------------------------------------
insert into public.case_price_items (code, category, name_en, name_ar, unit_en, unit_ar, unit_price, currency, sort_order) values
  ('PLN-DIG',  'planning',  'Digital treatment plan (setup & 3D simulation)', 'خطة علاج رقمية (إعداد ومحاكاة ثلاثية الأبعاد)', 'case',     'حالة',   0, 'USD', 10),
  ('ALN-FULL', 'aligner',   'Clear aligners — comprehensive treatment',      'تقويم شفاف — علاج شامل',                         'case',     'حالة',   0, 'USD', 20),
  ('ALN-LITE', 'aligner',   'Clear aligners — lite treatment',               'تقويم شفاف — علاج خفيف',                         'case',     'حالة',   0, 'USD', 30),
  ('ALN-STEP', 'aligner',   'Clear aligner — single step',                   'أليانر شفاف — مرحلة واحدة',                       'aligner',  'أليانر', 0, 'USD', 40),
  ('ALN-REF',  'aligner',   'Refinement aligners',                           'أليانرات تصحيحية',                               'aligner',  'أليانر', 0, 'USD', 50),
  ('ATT-TPL',  'accessory', 'Attachment template',                           'قالب الأتاشمنت',                                  'piece',    'قطعة',   0, 'USD', 60),
  ('SNAP-U',   'snap_on',   'Snap-On smile — upper arch',                    'سناب أون — الفك العلوي',                          'arch',     'فك',     0, 'USD', 70),
  ('SNAP-L',   'snap_on',   'Snap-On smile — lower arch',                    'سناب أون — الفك السفلي',                          'arch',     'فك',     0, 'USD', 80),
  ('RET-CLR',  'retainer',  'Clear retainer',                                'ريتينر شفاف (مثبّت)',                              'arch',     'فك',     0, 'USD', 90),
  ('RET-SET',  'retainer',  'Clear retainer set — upper & lower',            'طقم ريتينر شفاف — علوي وسفلي',                    'set',      'طقم',    0, 'USD', 100),
  ('ACC-CASE', 'accessory', 'Aligner case & chewies',                        'علبة أليانر وأدوات التثبيت',                       'piece',    'قطعة',   0, 'USD', 110),
  ('SHIP',     'service',   'Shipping & handling',                           'الشحن والتوصيل',                                  'shipment', 'شحنة',   0, 'USD', 120)
on conflict (code) do nothing;

-- Refresh the API schema cache so the new tables are usable immediately
notify pgrst, 'reload schema';
