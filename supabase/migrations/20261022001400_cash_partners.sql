-- =====================================================================
-- RUKN — Cash vouchers linked to partners (production labs, planning clinics)
--   * cash_entries.partner_id: the lab / clinic a voucher was paid to or received from.
--   * Payment vouchers to a partner are made as partner payments (PP-), so they
--     appear in the partner's balance and statement (the voucher is linked).
--   * Receipt vouchers from a partner (refund / returned advance) use the new
--     category 'partner_refund' and count in the partner's statement.
--   * The partner sees his own refund vouchers (his statement), nothing else.
-- Safe to run more than once.
-- =====================================================================

alter table public.cash_entries add column if not exists partner_id uuid references public.partners (id) on delete restrict;
create index if not exists cash_entries_partner_idx on public.cash_entries (partner_id);

alter table public.cash_entries drop constraint if exists cash_entries_category_check;
alter table public.cash_entries add constraint cash_entries_category_check check (category in (
  'case_payment', 'owner_deposit', 'advance_return', 'other_income', 'partner_refund',
  'withdrawal', 'advance', 'salary', 'supplies', 'lab', 'planning', 'shipping', 'rent', 'utilities', 'marketing', 'fees',
  'transfer', 'other'));

-- A refund voucher must name its partner; partner-linked vouchers keep a clear party name.
create or replace function public.tg_cash_entries_partner_link()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare p record;
begin
  if new.category = 'partner_refund' and new.partner_id is null then
    raise exception 'Choose the lab or clinic the money came from.' using errcode = '22023';
  end if;
  if new.partner_id is not null then
    select name into p from public.partners where id = new.partner_id;
    if p.name is null then raise exception 'Unknown partner.' using errcode = '22023'; end if;
    new.party_user := null;
    new.party_name := p.name;
  end if;
  if tg_op = 'UPDATE' and old.partner_payment_id is not null and old.partner_id is not null then
    new.partner_id := old.partner_id; -- follows its partner payment
  end if;
  return new;
end $$;
drop trigger if exists cash_entries_partner_link on public.cash_entries;
create trigger cash_entries_partner_link before insert or update on public.cash_entries for each row execute function public.tg_cash_entries_partner_link();

-- Payments to partners: the generated voucher carries the partner
create or replace function public.tg_partner_payments_after()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare p record; b text;
begin
  select name, kind into p from public.partners where id = new.partner_id;
  if tg_op = 'INSERT' and new.cash_account_id is not null then
    select bill_no into b from public.partner_bills where id = new.bill_id;
    insert into public.cash_entries (account_id, direction, amount, currency, entry_date, category, party_name, description, reference, partner_payment_id, partner_id)
    values (new.cash_account_id, 'out', new.amount, new.currency, new.paid_at, case when p.kind = 'lab' then 'lab' else 'planning' end,
            p.name, coalesce(nullif(trim(new.notes), ''), 'Payment ' || new.payment_no || ' to ' || p.name || coalesce(' · bill ' || b, '')), new.reference, new.id, new.partner_id);
  elsif tg_op = 'UPDATE' and new.voided and not old.voided then
    perform set_config('rukn.cash_cascade', 'on', true);
    update public.cash_entries set voided = true, void_reason = coalesce(new.void_reason, 'Partner payment voided') where partner_payment_id = new.id and not voided;
    perform set_config('rukn.cash_cascade', 'off', true);
  end if;
  return null;
end $$;

-- Back-fill vouchers made before this migration
alter table public.cash_entries disable trigger cash_entries_before;
update public.cash_entries e set partner_id = pp.partner_id
  from public.partner_payments pp where e.partner_payment_id = pp.id and e.partner_id is null;
alter table public.cash_entries enable trigger cash_entries_before;

-- A partner reads his own refund vouchers (for his statement)
drop policy if exists cash_entries_partner_select on public.cash_entries;
create policy cash_entries_partner_select on public.cash_entries for select to authenticated
  using (partner_id is not null and partner_id = public.my_partner() and category = 'partner_refund');

notify pgrst, 'reload schema';
