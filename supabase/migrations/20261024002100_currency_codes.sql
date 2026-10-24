-- =====================================================================
-- RUKN — currency drop-downs: every signed-in user can read the list of
-- currency CODES in use (the rates themselves stay finance-only).
-- Safe to run more than once.
-- =====================================================================
create or replace function public.currency_codes()
returns setof text language sql stable security definer set search_path = public, pg_temp as $$
  select currency from public.exchange_rates where auth.uid() is not null order by currency
$$;
revoke all on function public.currency_codes() from public, anon;
grant execute on function public.currency_codes() to authenticated;

notify pgrst, 'reload schema';
