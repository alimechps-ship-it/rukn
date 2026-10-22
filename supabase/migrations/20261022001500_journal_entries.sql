-- =====================================================================
-- RUKN — Simple journal entries (قيد بسيط: حساب مدين / حساب دائن)
--   Replaces the earlier "adjustments" (removed here if it was installed).
--
--   JV-YY-#####  one debit account and one credit account, no cash movement.
--   An account is an agent, a partner (lab / clinic) or a general ledger
--   account (discount allowed, discount earned, currency differences…).
--   Each side has its own amount and currency; when they differ the credit
--   amount follows the exchange rate (automatic or edited) and the rate is kept.
--
--   Effects:  agent   — debit increases what he owes RUKN, credit reduces it
--             partner — credit increases what RUKN owes it, debit reduces it
--   A side may point at an agent's issued invoice / a partner's approved bill
--   (same currency): that document's balance changes too.
--   Finance only; never edited or deleted — voided with a reason.
-- Safe to run more than once.
-- =====================================================================

-- 0. Remove the earlier adjustments (if that version was installed)
drop function if exists public.make_offset(text, uuid, text, uuid, text, numeric, text, text, numeric, numeric, date, text, text, uuid, uuid, uuid, uuid);
drop table if exists public.account_adjustments cascade;
drop function if exists public.tg_account_adjustments_before();
drop function if exists public.tg_account_adjustments_after();
delete from public.doc_counters where kind = 'adjustment';

-- 1. General ledger accounts (chart of accounts — non-personal accounts)
create table if not exists public.ledger_accounts (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code ~ '^[0-9A-Za-z.-]{1,12}$'),
  name_en    text not null check (char_length(name_en) between 1 and 120),
  name_ar    text check (char_length(name_ar) <= 120),
  kind       text not null default 'other' check (kind in ('income', 'expense', 'equity', 'asset', 'liability', 'other')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.ledger_accounts (code, name_en, name_ar, kind) values
  ('4100', 'Revenue — other services', 'إيرادات خدمات أخرى', 'income'),
  ('4200', 'Discount earned', 'خصم مكتسب', 'income'),
  ('4900', 'Other income', 'إيرادات أخرى', 'income'),
  ('5100', 'Discount allowed', 'خصم مسموح به', 'expense'),
  ('5200', 'Other expenses', 'مصروفات أخرى', 'expense'),
  ('5300', 'Bad debts written off', 'ديون معدومة', 'expense'),
  ('6100', 'Currency differences', 'فروق عملة', 'other'),
  ('3100', 'Opening balances', 'أرصدة افتتاحية', 'equity')
on conflict (code) do nothing;

-- 2. Journal entries
create table if not exists public.journal_entries (
  id            uuid primary key default gen_random_uuid(),
  entry_no      text unique,
  entry_date    date not null default current_date,
  description   text check (char_length(description) <= 500),
  reference     text check (char_length(reference) <= 120),
  dr_type       text not null check (dr_type in ('agent', 'partner', 'ledger')),
  dr_agent_id   uuid references public.profiles (id) on delete restrict,
  dr_partner_id uuid references public.partners (id) on delete restrict,
  dr_ledger_id  uuid references public.ledger_accounts (id) on delete restrict,
  dr_amount     numeric(12, 2) not null check (dr_amount > 0),
  dr_currency   text not null check (dr_currency ~ '^[A-Z]{3}$'),
  dr_invoice_id uuid references public.case_invoices (id) on delete restrict,
  dr_bill_id    uuid references public.partner_bills (id) on delete restrict,
  cr_type       text not null check (cr_type in ('agent', 'partner', 'ledger')),
  cr_agent_id   uuid references public.profiles (id) on delete restrict,
  cr_partner_id uuid references public.partners (id) on delete restrict,
  cr_ledger_id  uuid references public.ledger_accounts (id) on delete restrict,
  cr_amount     numeric(12, 2) check (cr_amount is null or cr_amount > 0),
  cr_currency   text not null check (cr_currency ~ '^[A-Z]{3}$'),
  cr_invoice_id uuid references public.case_invoices (id) on delete restrict,
  cr_bill_id    uuid references public.partner_bills (id) on delete restrict,
  fx_rate       numeric(20, 8) check (fx_rate is null or fx_rate > 0),   -- 1 unit of dr_currency = fx_rate units of cr_currency
  fx_source     text check (fx_source is null or fx_source in ('auto', 'manual')),
  voided        boolean not null default false,
  void_reason   text check (char_length(void_reason) <= 300),
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  check ((dr_type = 'agent') = (dr_agent_id is not null) and (dr_type = 'partner') = (dr_partner_id is not null) and (dr_type = 'ledger') = (dr_ledger_id is not null)),
  check ((cr_type = 'agent') = (cr_agent_id is not null) and (cr_type = 'partner') = (cr_partner_id is not null) and (cr_type = 'ledger') = (cr_ledger_id is not null)),
  check ((dr_invoice_id is null or dr_type = 'agent') and (cr_invoice_id is null or cr_type = 'agent')
     and (dr_bill_id is null or dr_type = 'partner') and (cr_bill_id is null or cr_type = 'partner'))
);
create index if not exists journal_dr_agent_idx on public.journal_entries (dr_agent_id);
create index if not exists journal_cr_agent_idx on public.journal_entries (cr_agent_id);
create index if not exists journal_dr_partner_idx on public.journal_entries (dr_partner_id);
create index if not exists journal_cr_partner_idx on public.journal_entries (cr_partner_id);
create index if not exists journal_dr_ledger_idx on public.journal_entries (dr_ledger_id);
create index if not exists journal_cr_ledger_idx on public.journal_entries (cr_ledger_id);
create index if not exists journal_invoice_idx on public.journal_entries (dr_invoice_id, cr_invoice_id);
create index if not exists journal_bill_idx on public.journal_entries (dr_bill_id, cr_bill_id);

create or replace function public.tg_journal_entries_before()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare inv record; bl record; v_auto numeric; side text; v_agent uuid; v_partner uuid; v_inv uuid; v_bill uuid; v_cur text;
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

  if (new.dr_type = new.cr_type) and coalesce(new.dr_agent_id, new.dr_partner_id, new.dr_ledger_id) = coalesce(new.cr_agent_id, new.cr_partner_id, new.cr_ledger_id) then
    raise exception 'The debit and the credit account must be different.' using errcode = '22023';
  end if;

  foreach side in array array['dr', 'cr'] loop
    if side = 'dr' then v_agent := new.dr_agent_id; v_partner := new.dr_partner_id; v_inv := new.dr_invoice_id; v_bill := new.dr_bill_id; v_cur := new.dr_currency;
    else v_agent := new.cr_agent_id; v_partner := new.cr_partner_id; v_inv := new.cr_invoice_id; v_bill := new.cr_bill_id; v_cur := new.cr_currency; end if;
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
drop trigger if exists journal_entries_before on public.journal_entries;
create trigger journal_entries_before before insert or update on public.journal_entries for each row execute function public.tg_journal_entries_before();
drop trigger if exists journal_entries_audit on public.journal_entries;
create trigger journal_entries_audit after insert or update on public.journal_entries for each row execute function public.tg_audit();

-- 3. Access
alter table public.ledger_accounts enable row level security;
alter table public.journal_entries enable row level security;
revoke all on public.ledger_accounts, public.journal_entries from anon;
grant select, insert, update on public.ledger_accounts, public.journal_entries to authenticated;
revoke delete on public.ledger_accounts, public.journal_entries from authenticated;

drop policy if exists ledger_accounts_select on public.ledger_accounts;
drop policy if exists ledger_accounts_write on public.ledger_accounts;
drop policy if exists ledger_accounts_update on public.ledger_accounts;
-- names are shown on agents' / partners' statements (e.g. "Discount allowed")
create policy ledger_accounts_select on public.ledger_accounts for select to authenticated using (true);
create policy ledger_accounts_write on public.ledger_accounts for insert to authenticated with check (public.is_finance());
create policy ledger_accounts_update on public.ledger_accounts for update to authenticated using (public.is_finance()) with check (public.is_finance());

drop policy if exists journal_entries_select on public.journal_entries;
drop policy if exists journal_entries_insert on public.journal_entries;
drop policy if exists journal_entries_update on public.journal_entries;
create policy journal_entries_select on public.journal_entries for select to authenticated using (
  public.is_finance()
  or (public.is_agent() and auth.uid() in (dr_agent_id, cr_agent_id))
  or (public.my_partner() is not null and public.my_partner() in (dr_partner_id, cr_partner_id)));
create policy journal_entries_insert on public.journal_entries for insert to authenticated with check (public.is_finance());
create policy journal_entries_update on public.journal_entries for update to authenticated using (public.is_finance()) with check (public.is_finance());

notify pgrst, 'reload schema';
