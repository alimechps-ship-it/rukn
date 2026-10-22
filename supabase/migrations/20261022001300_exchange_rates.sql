-- =====================================================================
-- RUKN — Exchange rates between currencies
--   * exchange_rates: one row per currency, "units of this currency per 1 USD".
--     Rates are refreshed automatically from the internet (source = 'auto')
--     or entered by finance (source = 'manual'); a locked rate is never
--     overwritten by the automatic update.
--   * exchange_rate_history: every change (who, when, old → new).
--   * cash_transfer: converts automatically with the current rate, or with
--     a rate / received amount the user edits; the rate used is stored on
--     both vouchers (fx_rate, fx_source).
-- Safe to run more than once.
-- =====================================================================

create table if not exists public.exchange_rates (
  currency    text primary key check (currency ~ '^[A-Z]{3}$'),
  per_usd     numeric(20, 8) not null check (per_usd > 0),
  source      text not null default 'manual' check (source in ('auto', 'manual')),
  locked      boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

create table if not exists public.exchange_rate_history (
  id          bigint generated always as identity primary key,
  currency    text not null,
  old_per_usd numeric(20, 8),
  new_per_usd numeric(20, 8) not null,
  source      text not null,
  changed_by  uuid references public.profiles (id) on delete set null,
  changed_at  timestamptz not null default now()
);
create index if not exists exchange_rate_history_idx on public.exchange_rate_history (currency, changed_at desc);

-- USD is the anchor (always 1); seed the currencies already used by cash boxes / invoices.
insert into public.exchange_rates (currency, per_usd, source, locked) values ('USD', 1, 'manual', true)
on conflict (currency) do update set per_usd = 1, locked = true;
insert into public.exchange_rates (currency, per_usd, source)
select c, v, 'manual' from (values ('EGP', 48.5), ('EUR', 0.92), ('SAR', 3.75), ('AED', 3.6725), ('JOD', 0.709), ('KWD', 0.307), ('GBP', 0.79)) as t(c, v)
on conflict (currency) do nothing;

create or replace function public.tg_exchange_rates()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.currency = 'USD' then new.per_usd := 1; new.locked := true; end if;
  if tg_op = 'UPDATE' and new.per_usd = old.per_usd and new.locked = old.locked and new.source = old.source then return new; end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if tg_op = 'INSERT' or new.per_usd <> old.per_usd then
    insert into public.exchange_rate_history (currency, old_per_usd, new_per_usd, source, changed_by)
    values (new.currency, case when tg_op = 'UPDATE' then old.per_usd end, new.per_usd, new.source, auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists exchange_rates_trg on public.exchange_rates;
create trigger exchange_rates_trg before insert or update on public.exchange_rates for each row execute function public.tg_exchange_rates();

alter table public.exchange_rates enable row level security;
alter table public.exchange_rate_history enable row level security;
revoke all on public.exchange_rates, public.exchange_rate_history from anon;
grant select, insert, update, delete on public.exchange_rates to authenticated;
grant select on public.exchange_rate_history to authenticated;

drop policy if exists exchange_rates_select on public.exchange_rates;
drop policy if exists exchange_rates_write on public.exchange_rates;
drop policy if exists exchange_rate_history_select on public.exchange_rate_history;
create policy exchange_rates_select on public.exchange_rates for select to authenticated using (public.is_finance());
create policy exchange_rates_write on public.exchange_rates for all to authenticated
  using (public.is_finance() and currency <> 'USD') with check (public.is_finance() and currency <> 'USD');
create policy exchange_rate_history_select on public.exchange_rate_history for select to authenticated using (public.is_finance());

-- Rate between two currencies: 1 unit of p_from = ? units of p_to (null when unknown).
create or replace function public.fx_rate(p_from text, p_to text)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select case when upper(p_from) = upper(p_to) then 1::numeric
              else (select t.per_usd / f.per_usd from public.exchange_rates f, public.exchange_rates t
                    where f.currency = upper(p_from) and t.currency = upper(p_to)) end
$$;
revoke all on function public.fx_rate(text, text) from public, anon;
grant execute on function public.fx_rate(text, text) to authenticated;

-- Vouchers keep the rate they were made with.
alter table public.cash_entries add column if not exists fx_rate numeric(20, 8) check (fx_rate is null or fx_rate > 0);
alter table public.cash_entries add column if not exists fx_source text check (fx_source is null or fx_source in ('auto', 'manual'));

-- ---------------------------------------------------------------------
-- Transfer between boxes with exchange
--   p_rate        : 1 unit of the sending currency = p_rate units of the receiving one
--   p_amount_to   : received amount (wins over p_rate when both are given)
--   neither given : automatic rate from exchange_rates
-- ---------------------------------------------------------------------
drop function if exists public.cash_transfer(uuid, uuid, numeric, numeric, date, text);
create or replace function public.cash_transfer(p_from uuid, p_to uuid, p_amount numeric, p_amount_to numeric default null,
                                                p_date date default current_date, p_description text default null,
                                                p_rate numeric default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare g uuid := gen_random_uuid(); a_from record; a_to record; v_to numeric(14,2); v_rate numeric; v_auto numeric; v_src text; v_note text := '';
begin
  if not public.is_finance() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if p_from = p_to then raise exception 'Choose two different cash boxes.' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount.' using errcode = '22023'; end if;
  select * into a_from from public.cash_accounts where id = p_from;
  select * into a_to from public.cash_accounts where id = p_to;
  if a_from.id is null or a_to.id is null then raise exception 'Unknown cash box.' using errcode = '22023'; end if;

  if a_from.currency = a_to.currency then
    v_to := p_amount;
  else
    v_auto := public.fx_rate(a_from.currency, a_to.currency);
    if p_amount_to is not null and p_amount_to > 0 then
      v_to := round(p_amount_to, 2);
      v_rate := v_to / p_amount;
    elsif p_rate is not null and p_rate > 0 then
      v_rate := p_rate;
      v_to := round(p_amount * p_rate, 2);
    elsif v_auto is not null then
      v_rate := v_auto;
      v_to := round(p_amount * v_auto, 2);
    else
      raise exception 'No exchange rate between % and %: add it in Finance → Exchange rates, or enter the rate.', a_from.currency, a_to.currency using errcode = '22023';
    end if;
    -- 'auto' only when the automatic rate was used unchanged (to 6 significant decimals).
    v_src := case when v_auto is not null and round(v_rate, 6) = round(v_auto, 6) then 'auto' else 'manual' end;
    if v_to <= 0 then raise exception 'The received amount must be more than 0.' using errcode = '22023'; end if;
    v_note := ' · 1 ' || a_from.currency || ' = ' || trim(to_char(v_rate, 'FM999999990.000000')) || ' ' || a_to.currency
              || case when v_src = 'auto' then ' (auto rate)' else ' (manual rate)' end;
  end if;

  insert into public.cash_entries (account_id, direction, amount, currency, entry_date, category, description, transfer_group, fx_rate, fx_source)
  values (p_from, 'out', p_amount, a_from.currency, coalesce(p_date, current_date), 'transfer',
          left(coalesce(nullif(trim(p_description), ''), 'Transfer to ' || a_to.name) || v_note, 500), g, v_rate, v_src);
  insert into public.cash_entries (account_id, direction, amount, currency, entry_date, category, description, transfer_group, fx_rate, fx_source)
  values (p_to, 'in', v_to, a_to.currency, coalesce(p_date, current_date), 'transfer',
          left(coalesce(nullif(trim(p_description), ''), 'Transfer from ' || a_from.name) || v_note, 500), g, v_rate, v_src);
  return g;
end $$;
revoke all on function public.cash_transfer(uuid, uuid, numeric, numeric, date, text, numeric) from public, anon;
grant execute on function public.cash_transfer(uuid, uuid, numeric, numeric, date, text, numeric) to authenticated;

notify pgrst, 'reload schema';
