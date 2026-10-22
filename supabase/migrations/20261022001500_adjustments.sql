-- =====================================================================
-- RUKN — Account adjustments (no cash movement)
--   AJ-YY-#####  on the account of an agent (what he owes RUKN) or of a
--   partner lab / clinic (what RUKN owes it):
--     discount_allowed  خصم مسموح به   agent    → decrease
--     discount_earned   خصم مكتسب      partner  → decrease
--     extra_charge      إضافة مقابل خدمات أخرى → increase
--     fx_difference     فروق عملة              → increase / decrease
--     offset            تقاص بين حسابين (two linked rows, same offset_group)
--     other             تسوية أخرى             → increase / decrease
--   Optionally linked to an issued invoice (agent) or an approved bill (partner):
--   then it changes that document's balance too.
--   Finance only; never deleted — voided (an offset is voided as a pair).
-- Safe to run more than once.
-- =====================================================================

create table if not exists public.account_adjustments (
  id           uuid primary key default gen_random_uuid(),
  adj_no       text unique,
  party_type   text not null check (party_type in ('agent', 'partner')),
  agent_id     uuid references public.profiles (id) on delete restrict,
  partner_id   uuid references public.partners (id) on delete restrict,
  kind         text not null check (kind in ('discount_allowed', 'discount_earned', 'extra_charge', 'fx_difference', 'offset', 'other')),
  effect       text not null check (effect in ('increase', 'decrease')),
  amount       numeric(12, 2) not null check (amount > 0),
  currency     text not null check (currency ~ '^[A-Z]{3}$'),
  adj_date     date not null default current_date,
  case_id      uuid references public.cases (id) on delete set null,
  invoice_id   uuid references public.case_invoices (id) on delete restrict,
  bill_id      uuid references public.partner_bills (id) on delete restrict,
  offset_group uuid,
  fx_rate      numeric(20, 8) check (fx_rate is null or fx_rate > 0),
  description  text check (char_length(description) <= 500),
  reference    text check (char_length(reference) <= 120),
  voided       boolean not null default false,
  void_reason  text check (char_length(void_reason) <= 300),
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  check ((party_type = 'agent' and agent_id is not null and partner_id is null and bill_id is null)
      or (party_type = 'partner' and partner_id is not null and agent_id is null and invoice_id is null and case_id is null))
);
create index if not exists account_adjustments_agent_idx on public.account_adjustments (agent_id);
create index if not exists account_adjustments_partner_idx on public.account_adjustments (partner_id);
create index if not exists account_adjustments_invoice_idx on public.account_adjustments (invoice_id);
create index if not exists account_adjustments_bill_idx on public.account_adjustments (bill_id);
create index if not exists account_adjustments_group_idx on public.account_adjustments (offset_group);

create or replace function public.tg_account_adjustments_before()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare inv record; bl record;
begin
  if tg_op = 'UPDATE' then
    -- Only voiding (with a reason) is allowed; everything else is fixed.
    if old.voided then raise exception 'A voided adjustment cannot be changed.' using errcode = '42501'; end if;
    if (to_jsonb(new) - 'voided' - 'void_reason') is distinct from (to_jsonb(old) - 'voided' - 'void_reason') then
      raise exception 'Adjustments cannot be edited — void it and make a new one.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.party_type = 'agent' then
    if not exists (select 1 from public.user_roles where user_id = new.agent_id and role::text = 'agent') then
      raise exception 'Choose an agent.' using errcode = '22023';
    end if;
  end if;
  if new.kind = 'discount_allowed' and (new.party_type <> 'agent' or new.effect <> 'decrease') then
    raise exception 'A discount allowed (خصم مسموح به) reduces what an agent owes.' using errcode = '22023';
  end if;
  if new.kind = 'discount_earned' and (new.party_type <> 'partner' or new.effect <> 'decrease') then
    raise exception 'A discount earned (خصم مكتسب) reduces what RUKN owes a lab / clinic.' using errcode = '22023';
  end if;
  if new.kind = 'extra_charge' and new.effect <> 'increase' then
    raise exception 'An extra charge increases the balance.' using errcode = '22023';
  end if;
  if new.kind = 'offset' and new.offset_group is null and current_setting('rukn.offset', true) is distinct from 'on' then
    raise exception 'Make offsets with the offset form (two accounts).' using errcode = '22023';
  end if;

  if new.invoice_id is not null then
    select i.status, i.currency, i.case_id, c.agent_id into inv from public.case_invoices i join public.cases c on c.id = i.case_id where i.id = new.invoice_id;
    if inv.status is distinct from 'issued' then raise exception 'Link only to an issued invoice.' using errcode = '22023'; end if;
    if inv.agent_id <> new.agent_id then raise exception 'The invoice is not on a case of this agent.' using errcode = '22023'; end if;
    if inv.currency <> new.currency then raise exception 'The invoice is in %; the adjustment must be in the same currency.', inv.currency using errcode = '22023'; end if;
    new.case_id := inv.case_id;
  end if;
  if new.case_id is not null and not exists (select 1 from public.cases where id = new.case_id and agent_id = new.agent_id) then
    raise exception 'The case does not belong to this agent.' using errcode = '22023';
  end if;
  if new.bill_id is not null then
    select status, currency, partner_id into bl from public.partner_bills where id = new.bill_id;
    if bl.status is distinct from 'approved' then raise exception 'Link only to an approved bill.' using errcode = '22023'; end if;
    if bl.partner_id <> new.partner_id then raise exception 'The bill belongs to another partner.' using errcode = '22023'; end if;
    if bl.currency <> new.currency then raise exception 'The bill is in %; the adjustment must be in the same currency.', bl.currency using errcode = '22023'; end if;
  end if;

  new.voided := false; new.void_reason := null;
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.adj_no := 'AJ-' || to_char(now(), 'YY') || '-' || lpad(public.next_doc_no('adjustment')::text, 5, '0');
  return new;
end $$;
drop trigger if exists account_adjustments_before on public.account_adjustments;
create trigger account_adjustments_before before insert or update on public.account_adjustments for each row execute function public.tg_account_adjustments_before();

-- Voiding one side of an offset voids the other side too
create or replace function public.tg_account_adjustments_after()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.voided and not old.voided and new.offset_group is not null and current_setting('rukn.offset_void', true) is distinct from 'on' then
    perform set_config('rukn.offset_void', 'on', true);
    update public.account_adjustments set voided = true, void_reason = new.void_reason
      where offset_group = new.offset_group and id <> new.id and not voided;
    perform set_config('rukn.offset_void', 'off', true);
  end if;
  return null;
end $$;
drop trigger if exists account_adjustments_after on public.account_adjustments;
create trigger account_adjustments_after after update on public.account_adjustments for each row execute function public.tg_account_adjustments_after();

drop trigger if exists account_adjustments_audit on public.account_adjustments;
create trigger account_adjustments_audit after insert or update on public.account_adjustments for each row execute function public.tg_audit();

alter table public.account_adjustments enable row level security;
revoke all on public.account_adjustments from anon;
grant select, insert, update on public.account_adjustments to authenticated;
revoke delete on public.account_adjustments from authenticated;
drop policy if exists account_adjustments_select on public.account_adjustments;
drop policy if exists account_adjustments_insert on public.account_adjustments;
drop policy if exists account_adjustments_update on public.account_adjustments;
create policy account_adjustments_select on public.account_adjustments for select to authenticated using (
  public.is_finance()
  or (party_type = 'agent' and agent_id = auth.uid() and public.is_agent())
  or (party_type = 'partner' and partner_id is not null and partner_id = public.my_partner()));
create policy account_adjustments_insert on public.account_adjustments for insert to authenticated with check (public.is_finance());
create policy account_adjustments_update on public.account_adjustments for update to authenticated using (public.is_finance()) with check (public.is_finance());

-- ---------------------------------------------------------------------
-- Offset between two accounts (atomic)
--   p_mode 'net'  : what A owes / is owed is set off against B → both balances decrease
--   p_mode 'move' : a balance is moved from A to B → A decreases, B increases
--   Side B may be in another currency: p_amount_b, else p_rate, else the automatic rate.
-- ---------------------------------------------------------------------
create or replace function public.make_offset(
  p_a_type text, p_a_id uuid, p_b_type text, p_b_id uuid, p_mode text, p_amount numeric, p_currency text,
  p_currency_b text default null, p_amount_b numeric default null, p_rate numeric default null,
  p_date date default current_date, p_description text default null, p_reference text default null,
  p_invoice_a uuid default null, p_bill_a uuid default null, p_invoice_b uuid default null, p_bill_b uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare g uuid := gen_random_uuid(); v_cb text; v_b numeric(12,2); v_rate numeric; v_auto numeric;
begin
  if not public.is_finance() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if p_mode not in ('net', 'move') then raise exception 'Choose the type of offset.' using errcode = '22023'; end if;
  if p_a_type = p_b_type and p_a_id = p_b_id then raise exception 'Choose two different accounts.' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount.' using errcode = '22023'; end if;
  v_cb := upper(coalesce(nullif(p_currency_b, ''), p_currency));
  if v_cb = upper(p_currency) then v_b := p_amount; v_rate := null;
  elsif p_amount_b is not null and p_amount_b > 0 then v_b := round(p_amount_b, 2); v_rate := v_b / p_amount;
  elsif p_rate is not null and p_rate > 0 then v_rate := p_rate; v_b := round(p_amount * p_rate, 2);
  else
    v_auto := public.fx_rate(p_currency, v_cb);
    if v_auto is null then raise exception 'No exchange rate between % and %.', p_currency, v_cb using errcode = '22023'; end if;
    v_rate := v_auto; v_b := round(p_amount * v_auto, 2);
  end if;
  perform set_config('rukn.offset', 'on', true);
  insert into public.account_adjustments (party_type, agent_id, partner_id, kind, effect, amount, currency, adj_date, invoice_id, bill_id, offset_group, fx_rate, description, reference)
  values (p_a_type, case when p_a_type = 'agent' then p_a_id end, case when p_a_type = 'partner' then p_a_id end, 'offset', 'decrease',
          p_amount, upper(p_currency), coalesce(p_date, current_date), p_invoice_a, p_bill_a, g, v_rate, p_description, p_reference);
  insert into public.account_adjustments (party_type, agent_id, partner_id, kind, effect, amount, currency, adj_date, invoice_id, bill_id, offset_group, fx_rate, description, reference)
  values (p_b_type, case when p_b_type = 'agent' then p_b_id end, case when p_b_type = 'partner' then p_b_id end, 'offset',
          case when p_mode = 'net' then 'decrease' else 'increase' end, v_b, v_cb, coalesce(p_date, current_date), p_invoice_b, p_bill_b, g, v_rate, p_description, p_reference);
  perform set_config('rukn.offset', 'off', true);
  return g;
end $$;
revoke all on function public.make_offset(text, uuid, text, uuid, text, numeric, text, text, numeric, numeric, date, text, text, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.make_offset(text, uuid, text, uuid, text, numeric, text, text, numeric, numeric, date, text, text, uuid, uuid, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
