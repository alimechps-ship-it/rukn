-- =====================================================================
-- RUKN — AI tools
--   * Payment-notice receipts are read by AI: extracted amount / date /
--     reference are stored with the notice and compared with what the
--     agent typed (ai_status: match / mismatch / unreadable / error).
--     Only the server (service role) or RUKN case staff can write them.
--   * ai_usage: one row per AI request (tokens) — for cost control and
--     a per-user daily limit. Visible to the super administrator.
-- Safe to run more than once.
-- =====================================================================

alter table public.case_payment_claims add column if not exists ai_status text check (ai_status in ('match', 'mismatch', 'unreadable', 'error'));
alter table public.case_payment_claims add column if not exists ai_extracted jsonb;
alter table public.case_payment_claims add column if not exists ai_summary text check (char_length(ai_summary) <= 1000);
alter table public.case_payment_claims add column if not exists ai_checked_at timestamptz;

create or replace function public.is_service_role()
returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') = 'service_role';
$$;

create or replace function public.set_claim_ai(p_claim uuid, p_status text, p_extracted jsonb, p_summary text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not (public.is_case_staff() or public.is_service_role()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_status not in ('match', 'mismatch', 'unreadable', 'error') then
    raise exception 'Invalid AI status.' using errcode = '22023';
  end if;
  perform set_config('rukn.claim', 'on', true);
  update public.case_payment_claims
     set ai_status = p_status, ai_extracted = p_extracted, ai_summary = left(p_summary, 1000), ai_checked_at = now()
   where id = p_claim;
  perform set_config('rukn.claim', 'off', true);
end $$;
revoke all on function public.set_claim_ai(uuid, text, jsonb, text) from public, anon;
grant execute on function public.set_claim_ai(uuid, text, jsonb, text) to authenticated, service_role;

-- AI fields are never set by the agent when sending a notice
create or replace function public.tg_payment_claims_ai_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.ai_status := null; new.ai_extracted := null; new.ai_summary := null; new.ai_checked_at := null;
  end if;
  return new;
end $$;
drop trigger if exists payment_claims_ai_guard on public.case_payment_claims;
create trigger payment_claims_ai_guard before insert on public.case_payment_claims for each row execute function public.tg_payment_claims_ai_guard();

create table if not exists public.ai_usage (
  id            bigint generated always as identity primary key,
  user_id       uuid references public.profiles (id) on delete set null,
  feature       text not null check (feature in ('assistant', 'receipt')),
  model         text,
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists ai_usage_user_day_idx on public.ai_usage (user_id, created_at);

alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon;
grant select, insert on public.ai_usage to authenticated;
drop policy if exists ai_usage_select on public.ai_usage;
drop policy if exists ai_usage_insert on public.ai_usage;
create policy ai_usage_select on public.ai_usage for select to authenticated using (user_id = auth.uid() or public.is_super_admin());
create policy ai_usage_insert on public.ai_usage for insert to authenticated with check (user_id = auth.uid());

notify pgrst, 'reload schema';
