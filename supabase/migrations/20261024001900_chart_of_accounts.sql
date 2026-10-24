-- =====================================================================
-- RUKN — Chart of accounts (tree) + cash boxes in journal entries
--
-- 1. ledger_accounts becomes a tree: parent_id, is_group (main accounts that
--    only total their children), and "sub-ledger" main accounts whose children
--    are live: cash boxes, agents, labs, clinics / planners.
--      1 Assets → 11 Current assets → 111 Cash & banks (boxes) · 112 Agents (receivable) · 113 Other receivables
--      2 Liabilities → 21 Current liabilities → 211 Labs · 212 Clinics / planners · 213 Other payables
--      3 Equity · 4 Revenue · 5 Expenses · 6 Currency differences
-- 2. Journal entries may use a cash box on either side, in the box currency:
--      debit a box  → money into the box (receipt voucher CR-)
--      credit a box → money out of the box (payment voucher CP-), never below zero
--    The vouchers are linked to the entry and voided with it.
-- Safe to run more than once.
-- =====================================================================

-- 1. Tree
alter table public.ledger_accounts add column if not exists parent_id uuid references public.ledger_accounts (id) on delete restrict;
alter table public.ledger_accounts add column if not exists is_group boolean not null default false;
alter table public.ledger_accounts add column if not exists subledger text check (subledger is null or subledger in ('cash', 'agents', 'labs', 'clinics'));
alter table public.ledger_accounts add column if not exists sort_order int not null default 0;
create index if not exists ledger_accounts_parent_idx on public.ledger_accounts (parent_id);

insert into public.ledger_accounts (code, name_en, name_ar, kind, is_group) values
  ('1', 'Assets', 'الأصول', 'asset', true),
  ('11', 'Current assets', 'الأصول المتداولة', 'asset', true),
  ('2', 'Liabilities', 'الخصوم', 'liability', true),
  ('21', 'Current liabilities', 'الخصوم المتداولة', 'liability', true),
  ('3', 'Equity', 'حقوق الملكية', 'equity', true),
  ('4', 'Revenue', 'الإيرادات', 'income', true),
  ('5', 'Expenses', 'المصروفات', 'expense', true),
  ('6', 'Other accounts', 'حسابات أخرى', 'other', true)
on conflict (code) do update set is_group = true;
insert into public.ledger_accounts (code, name_en, name_ar, kind, is_group, subledger) values
  ('111', 'Cash & banks', 'النقدية والبنوك (الصناديق)', 'asset', true, 'cash'),
  ('112', 'Agents (receivable)', 'المناديب (مدينون)', 'asset', true, 'agents'),
  ('211', 'Production labs (payable)', 'المعامل (دائنون)', 'liability', true, 'labs'),
  ('212', 'Planning clinics / doctors (payable)', 'العيادات والمخططون (دائنون)', 'liability', true, 'clinics')
on conflict (code) do update set is_group = true, subledger = excluded.subledger;
insert into public.ledger_accounts (code, name_en, name_ar, kind) values
  ('113', 'Other receivables', 'مدينون آخرون', 'asset'),
  ('213', 'Other payables', 'دائنون آخرون', 'liability'),
  ('3200', 'Owners'' current account', 'جاري الشركاء', 'equity')
on conflict (code) do nothing;

-- parents: the longest code that prefixes this code (1 → 11 → 111 …; 4100 → 4)
update public.ledger_accounts a set parent_id = (
  select p.id from public.ledger_accounts p
  where p.id <> a.id and p.is_group and a.code like p.code || '%' and length(p.code) < length(a.code)
    and (p.subledger is null)
  order by length(p.code) desc limit 1)
where a.parent_id is null and a.code not in ('1', '2', '3', '4', '5', '6');
-- sub-ledger and "other" accounts under their main account
update public.ledger_accounts set parent_id = (select id from public.ledger_accounts where code = '11') where code in ('111', '112', '113') ;
update public.ledger_accounts set parent_id = (select id from public.ledger_accounts where code = '21') where code in ('211', '212', '213');

create or replace function public.tg_ledger_accounts_before()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare p record; n int := 0; cur uuid;
begin
  if new.parent_id is not null then
    select is_group, subledger, kind into p from public.ledger_accounts where id = new.parent_id;
    if not p.is_group then raise exception 'The parent must be a main (group) account.' using errcode = '22023'; end if;
    if p.subledger is not null then raise exception 'Accounts under "%" are created automatically (boxes, agents, partners).', (select name_en from public.ledger_accounts where id = new.parent_id) using errcode = '22023'; end if;
    -- no loops
    cur := new.parent_id;
    while cur is not null and n < 20 loop
      if cur = new.id then raise exception 'An account cannot be placed under itself.' using errcode = '22023'; end if;
      select parent_id into cur from public.ledger_accounts where id = cur; n := n + 1;
    end loop;
  end if;
  if tg_op = 'UPDATE' then
    new.subledger := old.subledger;
    if old.subledger is not null then new.is_group := true; end if;
    if old.is_group and not new.is_group and exists (select 1 from public.ledger_accounts where parent_id = old.id) then
      raise exception 'This main account has sub-accounts.' using errcode = '22023';
    end if;
    if not old.is_group and new.is_group and exists (select 1 from public.journal_entries where old.id in (dr_ledger_id, cr_ledger_id)) then
      raise exception 'This account already has entries; it cannot become a main account.' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists ledger_accounts_before on public.ledger_accounts;
create trigger ledger_accounts_before before insert or update on public.ledger_accounts for each row execute function public.tg_ledger_accounts_before();

-- 2. Cash boxes in journal entries
alter table public.journal_entries add column if not exists dr_cash_id uuid references public.cash_accounts (id) on delete restrict;
alter table public.journal_entries add column if not exists cr_cash_id uuid references public.cash_accounts (id) on delete restrict;
alter table public.journal_entries drop constraint if exists journal_entries_dr_type_check;
alter table public.journal_entries drop constraint if exists journal_entries_cr_type_check;
alter table public.journal_entries add constraint journal_entries_dr_type_check check (dr_type in ('agent', 'partner', 'ledger', 'cash'));
alter table public.journal_entries add constraint journal_entries_cr_type_check check (cr_type in ('agent', 'partner', 'ledger', 'cash'));
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid = 'public.journal_entries'::regclass and contype = 'c'
           and conname ~ '^journal_entries_check[0-9]*$' loop
    execute format('alter table public.journal_entries drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.journal_entries add constraint journal_entries_check check (
  (dr_type = 'agent') = (dr_agent_id is not null) and (dr_type = 'partner') = (dr_partner_id is not null)
  and (dr_type = 'ledger') = (dr_ledger_id is not null) and (dr_type = 'cash') = (dr_cash_id is not null));
alter table public.journal_entries add constraint journal_entries_check1 check (
  (cr_type = 'agent') = (cr_agent_id is not null) and (cr_type = 'partner') = (cr_partner_id is not null)
  and (cr_type = 'ledger') = (cr_ledger_id is not null) and (cr_type = 'cash') = (cr_cash_id is not null));
alter table public.journal_entries add constraint journal_entries_check2 check (
  (dr_invoice_id is null or dr_type = 'agent') and (cr_invoice_id is null or cr_type = 'agent')
  and (dr_bill_id is null or dr_type = 'partner') and (cr_bill_id is null or cr_type = 'partner'));

alter table public.cash_entries add column if not exists journal_id uuid references public.journal_entries (id) on delete restrict;
create index if not exists cash_entries_journal_idx on public.cash_entries (journal_id);
alter table public.cash_entries drop constraint if exists cash_entries_category_check;
alter table public.cash_entries add constraint cash_entries_category_check check (category in (
  'case_payment', 'owner_deposit', 'advance_return', 'other_income', 'partner_refund', 'agent_receipt',
  'withdrawal', 'advance', 'salary', 'supplies', 'lab', 'planning', 'shipping', 'rent', 'utilities', 'marketing', 'fees', 'agent_payment',
  'transfer', 'journal', 'other'));

create or replace function public.tg_journal_entries_before()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare inv record; bl record; v_auto numeric; side text; v_agent uuid; v_partner uuid; v_inv uuid; v_bill uuid; v_cur text; v_cash uuid; v_box record;
begin
  if tg_op = 'UPDATE' then
    if old.voided then raise exception 'A voided entry cannot be changed.' using errcode = '42501'; end if;
    if (to_jsonb(new) - 'voided' - 'void_reason') is distinct from (to_jsonb(old) - 'voided' - 'void_reason') then
      raise exception 'Journal entries cannot be edited — void it and make a new one.' using errcode = '42501';
    end if;
    if new.voided and nullif(trim(coalesce(new.void_reason, '')), '') is null then
      raise exception 'Write the reason for voiding.' using errcode = '22023';
    end if;
    return new;
  end if;

  if new.dr_ledger_id is not null and exists (select 1 from public.ledger_accounts where id = new.dr_ledger_id and is_group)
     or new.cr_ledger_id is not null and exists (select 1 from public.ledger_accounts where id = new.cr_ledger_id and is_group) then
    raise exception 'A main (group) account cannot be used in an entry — choose one of its sub-accounts.' using errcode = '22023';
  end if;

  -- The same account on both sides is allowed only to convert its balance between two currencies.
  if (new.dr_type = new.cr_type) and coalesce(new.dr_agent_id, new.dr_partner_id, new.dr_ledger_id, new.dr_cash_id) = coalesce(new.cr_agent_id, new.cr_partner_id, new.cr_ledger_id, new.cr_cash_id)
     and new.dr_currency = new.cr_currency then
    raise exception 'The same account on both sides is only allowed with two different currencies.' using errcode = '22023';
  end if;

  foreach side in array array['dr', 'cr'] loop
    if side = 'dr' then v_agent := new.dr_agent_id; v_partner := new.dr_partner_id; v_inv := new.dr_invoice_id; v_bill := new.dr_bill_id; v_cur := new.dr_currency; v_cash := new.dr_cash_id;
    else v_agent := new.cr_agent_id; v_partner := new.cr_partner_id; v_inv := new.cr_invoice_id; v_bill := new.cr_bill_id; v_cur := new.cr_currency; v_cash := new.cr_cash_id; end if;
    if v_cash is not null then
      select name, currency, active into v_box from public.cash_accounts where id = v_cash;
      if v_box.name is null or not v_box.active then raise exception 'Choose an open cash box.' using errcode = '22023'; end if;
      if v_box.currency <> v_cur then raise exception 'The cash box "%" is in %; that side must be in %.', v_box.name, v_box.currency, v_box.currency using errcode = '22023'; end if;
    end if;
    if v_agent is not null and not exists (select 1 from public.user_roles where user_id = v_agent and role::text = 'agent') then
      raise exception 'Choose an agent.' using errcode = '22023';
    end if;
    if v_inv is not null then
      select i.status, i.currency, c.agent_id into inv from public.case_invoices i join public.cases c on c.id = i.case_id where i.id = v_inv;
      if inv.status is distinct from 'issued' then raise exception 'Link only to an issued invoice.' using errcode = '22023'; end if;
      if inv.agent_id <> v_agent then raise exception 'The invoice is not on a case of this agent.' using errcode = '22023'; end if;
      if inv.currency <> v_cur then raise exception 'Invoice is in %; that side must be in %.', inv.currency, inv.currency using errcode = '22023'; end if;
    end if;
    if v_bill is not null then
      select status, currency, partner_id into bl from public.partner_bills where id = v_bill;
      if bl.status is distinct from 'approved' then raise exception 'Link only to an approved bill.' using errcode = '22023'; end if;
      if bl.partner_id <> v_partner then raise exception 'The bill belongs to another partner.' using errcode = '22023'; end if;
      if bl.currency <> v_cur then raise exception 'Bill is in %; that side must be in %.', bl.currency, bl.currency using errcode = '22023'; end if;
    end if;
  end loop;

  -- Currencies: same → same amount; different → amount from the given amount, the given rate or the automatic rate
  if new.dr_currency = new.cr_currency then
    new.cr_amount := new.dr_amount; new.fx_rate := null; new.fx_source := null;
  else
    v_auto := public.fx_rate(new.dr_currency, new.cr_currency);
    if new.cr_amount is not null then new.fx_rate := new.cr_amount / new.dr_amount;
    elsif new.fx_rate is not null then new.cr_amount := round(new.dr_amount * new.fx_rate, 2);
    elsif v_auto is not null then new.fx_rate := v_auto; new.cr_amount := round(new.dr_amount * v_auto, 2);
    else raise exception 'No exchange rate between % and %: enter the rate or the credit amount.', new.dr_currency, new.cr_currency using errcode = '22023';
    end if;
    new.fx_source := case when v_auto is not null and round(new.fx_rate, 6) = round(v_auto, 6) then 'auto' else 'manual' end;
  end if;

  new.voided := false; new.void_reason := null;
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.entry_no := 'JV-' || to_char(now(), 'YY') || '-' || lpad(public.next_doc_no('journal')::text, 5, '0');
  return new;
end $$;

-- Post the cash side(s) of an entry as vouchers; void them with the entry
create or replace function public.tg_journal_entries_after()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_text text;
begin
  if tg_op = 'INSERT' then
    v_text := left('Journal ' || new.entry_no || coalesce(' — ' || nullif(trim(new.description), ''), ''), 500);
    if new.dr_cash_id is not null then
      insert into public.cash_entries (account_id, direction, amount, currency, entry_date, category, description, reference, journal_id)
      values (new.dr_cash_id, 'in', new.dr_amount, new.dr_currency, new.entry_date, 'journal', v_text, new.reference, new.id);
    end if;
    if new.cr_cash_id is not null then
      insert into public.cash_entries (account_id, direction, amount, currency, entry_date, category, description, reference, journal_id)
      values (new.cr_cash_id, 'out', new.cr_amount, new.cr_currency, new.entry_date, 'journal', v_text, new.reference, new.id);
    end if;
  elsif new.voided and not old.voided then
    perform set_config('rukn.cash_cascade', 'on', true);
    update public.cash_entries set voided = true, void_reason = coalesce(new.void_reason, 'Journal entry voided') where journal_id = new.id and not voided;
    perform set_config('rukn.cash_cascade', 'off', true);
  end if;
  return null;
end $$;
drop trigger if exists journal_entries_after on public.journal_entries;
create trigger journal_entries_after after insert or update on public.journal_entries for each row execute function public.tg_journal_entries_after();

-- Vouchers of a journal entry are changed only through the entry
create or replace function public.tg_cash_entries_journal_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.category = 'journal' and new.journal_id is null then raise exception 'Use a journal entry for this type.' using errcode = '22023'; end if;
    return new;
  end if;
  new.journal_id := old.journal_id;
  if old.journal_id is not null and current_setting('rukn.cash_cascade', true) is distinct from 'on'
     and (new.voided <> old.voided or new.amount <> old.amount or new.entry_date <> old.entry_date or new.category <> old.category) then
    raise exception 'This voucher comes from journal entry — void the entry instead.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists cash_entries_journal_guard on public.cash_entries;
create trigger cash_entries_journal_guard before insert or update on public.cash_entries for each row execute function public.tg_cash_entries_journal_guard();

notify pgrst, 'reload schema';
