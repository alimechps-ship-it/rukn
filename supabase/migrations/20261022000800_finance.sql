-- =====================================================================
-- RUKN — Finance
--   1. Issued invoices can be edited by case staff: the number is kept,
--      every change is a numbered revision logged on the case timeline
--      and in the audit log. Voided invoices stay locked.
--   2. Cash boxes (cash / bank / wallet) with receipt vouchers (CR-),
--      payment vouchers (CP-) and transfers (TR-); balances can never go
--      below zero; every voucher can name the person who took / returned
--      money, which gives a per-person account (custody / withdrawals).
--   3. A case payment can be deposited into a cash box in one step.
-- Requires 20261021000600_cases.sql and 20261022000700_case_invoices.sql.
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Invoice revisions
-- ---------------------------------------------------------------------
alter table public.case_invoices add column if not exists revision   int not null default 0;
alter table public.case_invoices add column if not exists revised_at timestamptz;
alter table public.case_invoices add column if not exists revised_by uuid references public.profiles (id) on delete set null;

-- Case price follows the issued invoices (single currency).
create or replace function public.sync_case_quote(p_case uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int; v_cur text; v_sum numeric(12,2);
begin
  select count(distinct currency), min(currency), coalesce(sum(total), 0) into v_n, v_cur, v_sum
    from public.case_invoices where case_id = p_case and status = 'issued';
  if v_n = 1 then
    update public.cases set quote_amount = v_sum, quote_currency = v_cur where id = p_case;
  end if;
end $$;
revoke all on function public.sync_case_quote(uuid) from public, anon, authenticated;

create or replace function public.recalc_case_invoice(p_invoice uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_sub numeric(12,2); v_disc numeric(12,2); v_rate numeric(5,2); v_tax numeric(12,2); v_net numeric(12,2);
        v_status text; v_case uuid;
begin
  select coalesce(sum(line_total), 0) into v_sub from public.case_invoice_items where invoice_id = p_invoice;
  select least(discount_amount, v_sub), tax_rate, status, case_id into v_disc, v_rate, v_status, v_case from public.case_invoices where id = p_invoice;
  v_net := v_sub - coalesce(v_disc, 0);
  v_tax := round(v_net * coalesce(v_rate, 0) / 100, 2);
  perform set_config('rukn.invoice_recalc', 'on', true);
  update public.case_invoices set subtotal = v_sub, tax_amount = v_tax, total = v_net + v_tax where id = p_invoice;
  perform set_config('rukn.invoice_recalc', 'off', true);
  if v_status = 'issued' then perform public.sync_case_quote(v_case); end if;
end $$;
revoke all on function public.recalc_case_invoice(uuid) from public, anon, authenticated;

create or replace function public.tg_case_invoices_before()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'draft'; new.invoice_no := null; new.issued_at := null; new.issued_by := null;
    new.subtotal := 0; new.tax_amount := 0; new.total := 0; new.revision := 0; new.revised_at := null; new.revised_by := null;
    new.created_by := auth.uid();
    return new;
  end if;
  if current_setting('rukn.invoice_recalc', true) = 'on' then
    new.updated_at := now();
    return new;
  end if;
  new.case_id := old.case_id; new.created_by := old.created_by; new.created_at := old.created_at;
  new.subtotal := old.subtotal; new.tax_amount := old.tax_amount; new.total := old.total;
  if old.status = 'void' then
    raise exception 'A voided invoice cannot be changed.' using errcode = '42501';
  elsif old.status = 'issued' then
    if new.status = 'draft' then
      raise exception 'An issued invoice cannot go back to draft. Edit it directly or void it.' using errcode = '42501';
    end if;
    new.invoice_no := old.invoice_no; new.issued_at := old.issued_at; new.issued_by := old.issued_by;
    if new.status = 'void' then
      -- voiding: nothing else changes
      new.issue_date := old.issue_date; new.due_date := old.due_date; new.currency := old.currency; new.bill_to := old.bill_to;
      new.discount_amount := old.discount_amount; new.tax_label := old.tax_label; new.tax_rate := old.tax_rate; new.notes := old.notes;
      new.revision := old.revision; new.revised_at := old.revised_at; new.revised_by := old.revised_by;
    else
      if new.currency <> old.currency and exists (select 1 from public.case_payments where invoice_id = old.id and not voided) then
        raise exception 'The currency cannot change: payments were already received on this invoice.' using errcode = '22023';
      end if;
      if new.revision < old.revision then new.revision := old.revision; end if;
    end if;
  else -- draft
    new.revision := 0; new.revised_at := null; new.revised_by := null;
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

create or replace function public.tg_case_invoices_after()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if current_setting('rukn.invoice_recalc', true) = 'on' then return null; end if;
  if tg_op = 'UPDATE' and new.status in ('draft', 'issued') and (new.discount_amount <> old.discount_amount or new.tax_rate <> old.tax_rate) then
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
    perform public.sync_case_quote(new.case_id);
  end if;
  return null;
end $$;

-- Lines may change on drafts and on issued invoices (revisions); never on voided ones.
create or replace function public.tg_case_invoice_items_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_inv uuid := coalesce(new.invoice_id, old.invoice_id); v_status text;
begin
  select status into v_status from public.case_invoices where id = v_inv;
  if v_status = 'void' then
    raise exception 'Lines of a voided invoice cannot be changed.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.invoice_id <> old.invoice_id then
    raise exception 'A line cannot be moved to another invoice.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

-- Called by the app after saving changes to an issued invoice.
create or replace function public.log_invoice_revision(p_invoice uuid, p_old_total numeric, p_note text default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare inv record; v_rev int;
begin
  if not public.is_case_staff() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  select * into inv from public.case_invoices where id = p_invoice;
  if inv.id is null or inv.status <> 'issued' then raise exception 'Only issued invoices have revisions.' using errcode = '22023'; end if;
  v_rev := inv.revision + 1;
  update public.case_invoices set revision = v_rev, revised_at = now(), revised_by = auth.uid() where id = p_invoice;
  insert into public.case_events (case_id, kind, body, author_id)
  values (inv.case_id, 'payment',
          'Invoice ' || inv.invoice_no || ' revised (rev. ' || v_rev || '): ' || round(p_old_total, 2) || ' → ' || inv.total || ' ' || inv.currency
          || coalesce(' — ' || nullif(trim(p_note), ''), ''), auth.uid());
  return v_rev;
end $$;
revoke all on function public.log_invoice_revision(uuid, numeric, text) from public, anon;
grant execute on function public.log_invoice_revision(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Cash boxes
-- ---------------------------------------------------------------------
create table if not exists public.cash_accounts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique check (char_length(name) between 2 and 80),
  kind            text not null default 'cash' check (kind in ('cash', 'bank', 'wallet')),
  currency        text not null default 'EGP' check (currency ~ '^[A-Z]{3}$'),
  opening_balance numeric(14, 2) not null default 0 check (opening_balance >= 0),
  custodian       uuid references public.profiles (id) on delete set null,
  notes           text check (char_length(notes) <= 500),
  active          boolean not null default true,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);

create table if not exists public.cash_entries (
  id              uuid primary key default gen_random_uuid(),
  entry_no        text unique,
  account_id      uuid not null references public.cash_accounts (id) on delete restrict,
  direction       text not null check (direction in ('in', 'out')),
  amount          numeric(14, 2) not null check (amount > 0),
  currency        text not null check (currency ~ '^[A-Z]{3}$'),
  entry_date      date not null default current_date,
  category        text not null default 'other' check (category in (
                    'case_payment', 'owner_deposit', 'advance_return', 'other_income',
                    'withdrawal', 'advance', 'salary', 'supplies', 'lab', 'shipping', 'rent', 'utilities', 'marketing', 'fees',
                    'transfer', 'other')),
  party_user      uuid references public.profiles (id) on delete set null,
  party_name      text check (char_length(party_name) <= 120),
  description     text check (char_length(description) <= 500),
  reference       text check (char_length(reference) <= 120),
  case_id         uuid references public.cases (id) on delete set null,
  case_payment_id uuid unique references public.case_payments (id) on delete set null,
  transfer_group  uuid,
  voided          boolean not null default false,
  void_reason     text check (char_length(void_reason) <= 300),
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists cash_entries_account_idx on public.cash_entries (account_id, entry_date);
create index if not exists cash_entries_party_idx on public.cash_entries (party_user);
create index if not exists cash_entries_transfer_idx on public.cash_entries (transfer_group);

alter table public.case_payments add column if not exists cash_account_id uuid references public.cash_accounts (id) on delete restrict;

create or replace function public.cash_balance(p_account uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select a.opening_balance
       + coalesce((select sum(case when e.direction = 'in' then e.amount else -e.amount end)
                     from public.cash_entries e where e.account_id = a.id and not e.voided), 0)
  from public.cash_accounts a where a.id = p_account;
$$;
revoke all on function public.cash_balance(uuid) from public, anon;
grant execute on function public.cash_balance(uuid) to authenticated;

create or replace function public.tg_cash_entries_before()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare acc record; v_bal numeric(14,2); v_prefix text;
begin
  if tg_op = 'INSERT' then
    select * into acc from public.cash_accounts where id = new.account_id;
    if acc.id is null then raise exception 'Unknown cash box.' using errcode = '22023'; end if;
    if not acc.active then raise exception 'The cash box "%" is closed.', acc.name using errcode = '22023'; end if;
    new.currency := acc.currency;
    new.voided := false; new.void_reason := null;
    new.created_by := coalesce(auth.uid(), new.created_by);
    v_prefix := case when new.category = 'transfer' then 'TR' when new.direction = 'in' then 'CR' else 'CP' end;
    new.entry_no := v_prefix || '-' || to_char(now(), 'YY') || '-' || lpad(public.next_doc_no('cash_' || lower(v_prefix))::text, 5, '0');
    if new.direction = 'out' then
      v_bal := public.cash_balance(new.account_id);
      if v_bal < new.amount then
        raise exception 'Not enough money in "%": balance % %, requested % %.', acc.name, v_bal, acc.currency, new.amount, acc.currency using errcode = '22023';
      end if;
    end if;
    return new;
  end if;
  -- UPDATE: the box, direction, number, links and creator never change
  new.entry_no := old.entry_no; new.account_id := old.account_id; new.direction := old.direction; new.currency := old.currency;
  new.case_payment_id := old.case_payment_id; new.transfer_group := old.transfer_group; new.created_by := old.created_by; new.created_at := old.created_at;
  if old.voided then
    raise exception 'A voided voucher cannot be changed.' using errcode = '42501';
  end if;
  if (old.case_payment_id is not null or old.transfer_group is not null) and not new.voided
     and (new.amount <> old.amount or new.entry_date <> old.entry_date or new.category <> old.category) then
    raise exception 'This voucher is linked (case payment or transfer); void it instead of editing the amount.' using errcode = '42501';
  end if;
  if not new.voided and new.direction = 'out' and new.amount > old.amount then
    v_bal := public.cash_balance(new.account_id);
    if v_bal < new.amount - old.amount then
      raise exception 'Not enough money in the cash box for this change (balance %).', v_bal using errcode = '22023';
    end if;
  end if;
  if new.voided and not old.voided and new.direction = 'in' then
    v_bal := public.cash_balance(new.account_id);
    if v_bal < old.amount and current_setting('rukn.cash_cascade', true) is distinct from 'on' then
      raise exception 'Voiding this receipt would make the cash box negative (balance %).', v_bal using errcode = '22023';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists cash_entries_before on public.cash_entries;
create trigger cash_entries_before before insert or update on public.cash_entries for each row execute function public.tg_cash_entries_before();

-- Voiding one side of a transfer voids the other side.
create or replace function public.tg_cash_entries_after()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.voided and not old.voided and new.transfer_group is not null and current_setting('rukn.cash_cascade', true) is distinct from 'on' then
    perform set_config('rukn.cash_cascade', 'on', true);
    update public.cash_entries set voided = true, void_reason = coalesce(new.void_reason, 'Transfer voided')
      where transfer_group = new.transfer_group and id <> new.id and not voided;
    perform set_config('rukn.cash_cascade', 'off', true);
  end if;
  return null;
end $$;
drop trigger if exists cash_entries_after on public.cash_entries;
create trigger cash_entries_after after update on public.cash_entries for each row execute function public.tg_cash_entries_after();

create or replace function public.tg_cash_accounts_before()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.currency <> old.currency and exists (select 1 from public.cash_entries where account_id = old.id) then
    raise exception 'The currency of a cash box with vouchers cannot change.' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and new.opening_balance <> old.opening_balance and exists (select 1 from public.cash_entries where account_id = old.id) then
    raise exception 'The opening balance cannot change after vouchers were recorded.' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists cash_accounts_before on public.cash_accounts;
create trigger cash_accounts_before before update on public.cash_accounts for each row execute function public.tg_cash_accounts_before();

-- Transfer between two boxes (optionally with exchange: p_amount_to in the target currency).
create or replace function public.cash_transfer(p_from uuid, p_to uuid, p_amount numeric, p_amount_to numeric default null,
                                                p_date date default current_date, p_description text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare g uuid := gen_random_uuid(); a_from record; a_to record; v_to numeric(14,2);
begin
  if not public.is_case_staff() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if p_from = p_to then raise exception 'Choose two different cash boxes.' using errcode = '22023'; end if;
  select * into a_from from public.cash_accounts where id = p_from;
  select * into a_to from public.cash_accounts where id = p_to;
  if a_from.id is null or a_to.id is null then raise exception 'Unknown cash box.' using errcode = '22023'; end if;
  v_to := case when a_from.currency = a_to.currency then p_amount else p_amount_to end;
  if v_to is null or v_to <= 0 then
    raise exception 'Enter the amount received in % (exchange).', a_to.currency using errcode = '22023';
  end if;
  insert into public.cash_entries (account_id, direction, amount, currency, entry_date, category, description, transfer_group)
  values (p_from, 'out', p_amount, a_from.currency, coalesce(p_date, current_date), 'transfer',
          coalesce(nullif(trim(p_description), ''), 'Transfer to ' || a_to.name), g);
  insert into public.cash_entries (account_id, direction, amount, currency, entry_date, category, description, transfer_group)
  values (p_to, 'in', v_to, a_to.currency, coalesce(p_date, current_date), 'transfer',
          coalesce(nullif(trim(p_description), ''), 'Transfer from ' || a_from.name), g);
  return g;
end $$;
revoke all on function public.cash_transfer(uuid, uuid, numeric, numeric, date, text) from public, anon;
grant execute on function public.cash_transfer(uuid, uuid, numeric, numeric, date, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Case payment → cash box (atomic)
-- ---------------------------------------------------------------------
create or replace function public.tg_case_payments_cash_check()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare acc record;
begin
  if new.cash_account_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.cash_account_id is not distinct from old.cash_account_id then return new; end if;
  if tg_op = 'UPDATE' then raise exception 'The cash box of a payment cannot be changed; void and re-enter it.' using errcode = '42501'; end if;
  select * into acc from public.cash_accounts where id = new.cash_account_id;
  if acc.id is null or not acc.active then raise exception 'Choose an open cash box.' using errcode = '22023'; end if;
  if acc.currency <> new.currency then
    raise exception 'The cash box "%" is in %, the payment is in %.', acc.name, acc.currency, new.currency using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists case_payments_cash_check on public.case_payments;
create trigger case_payments_cash_check before insert or update on public.case_payments for each row execute function public.tg_case_payments_cash_check();

create or replace function public.tg_case_payments_cash_post()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text;
begin
  if tg_op = 'INSERT' and new.cash_account_id is not null then
    select code into v_code from public.cases where id = new.case_id;
    insert into public.cash_entries (account_id, direction, amount, currency, entry_date, category, description, reference, case_id, case_payment_id)
    values (new.cash_account_id, 'in', new.amount, new.currency, new.paid_at, 'case_payment',
            'Case ' || v_code || ' · receipt ' || new.receipt_no, new.reference, new.case_id, new.id);
  elsif tg_op = 'UPDATE' and new.voided and not old.voided then
    perform set_config('rukn.cash_cascade', 'on', true);
    update public.cash_entries set voided = true, void_reason = coalesce(new.void_reason, 'Payment voided')
      where case_payment_id = new.id and not voided;
    perform set_config('rukn.cash_cascade', 'off', true);
  end if;
  return null;
end $$;
drop trigger if exists case_payments_cash_post on public.case_payments;
create trigger case_payments_cash_post after insert or update on public.case_payments for each row execute function public.tg_case_payments_cash_post();

-- audit
drop trigger if exists cash_accounts_audit on public.cash_accounts;
create trigger cash_accounts_audit after insert or update or delete on public.cash_accounts for each row execute function public.tg_audit();
drop trigger if exists cash_entries_audit on public.cash_entries;
create trigger cash_entries_audit after insert or update or delete on public.cash_entries for each row execute function public.tg_audit();

-- ---------------------------------------------------------------------
-- Row level security — finance is for RUKN case staff only
-- ---------------------------------------------------------------------
alter table public.cash_accounts enable row level security;
alter table public.cash_entries enable row level security;
revoke all on public.cash_accounts, public.cash_entries from anon;
grant select, insert, update on public.cash_accounts, public.cash_entries to authenticated;

drop policy if exists cash_accounts_select on public.cash_accounts;
drop policy if exists cash_accounts_insert on public.cash_accounts;
drop policy if exists cash_accounts_update on public.cash_accounts;
create policy cash_accounts_select on public.cash_accounts for select to authenticated using (public.is_case_staff());
create policy cash_accounts_insert on public.cash_accounts for insert to authenticated with check (public.is_case_staff());
create policy cash_accounts_update on public.cash_accounts for update to authenticated using (public.is_case_staff()) with check (public.is_case_staff());

drop policy if exists cash_entries_select on public.cash_entries;
drop policy if exists cash_entries_insert on public.cash_entries;
drop policy if exists cash_entries_update on public.cash_entries;
create policy cash_entries_select on public.cash_entries for select to authenticated using (public.is_case_staff());
create policy cash_entries_insert on public.cash_entries for insert to authenticated with check (public.is_case_staff() and category <> 'case_payment' and category <> 'transfer');
create policy cash_entries_update on public.cash_entries for update to authenticated using (public.is_case_staff()) with check (public.is_case_staff());

drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated using (
  public.is_super_admin()
  or (public.can_manage_content() and entity_type not in ('inquiries', 'inquiry_notes', 'profiles', 'user_roles', 'private_settings', 'cases', 'case_payments', 'case_files', 'case_invoices', 'case_price_items', 'cash_accounts', 'cash_entries'))
  or (public.has_role('sales_manager') and entity_type in ('inquiries', 'inquiry_notes'))
  or (public.has_role('translator') and entity_type like '%translations')
  or (public.is_case_staff() and entity_type in ('cases', 'case_payments', 'case_files', 'case_invoices', 'case_price_items', 'cash_accounts', 'cash_entries')));

-- Starter cash boxes (rename / add more in the admin → Cash boxes)
insert into public.cash_accounts (name, kind, currency, sort_order) values
  ('Main cash box (EGP)', 'cash', 'EGP', 10),
  ('USD cash box', 'cash', 'USD', 20),
  ('Bank account', 'bank', 'EGP', 30)
on conflict (name) do nothing;

notify pgrst, 'reload schema';
