-- =====================================================================
-- RUKN — Cash vouchers with agents
--   A payment voucher to an agent (money paid out to him) or a receipt
--   voucher from an agent (money received directly in a box) now counts in
--   the agent's account statement:
--     payment voucher (out) → debit  (adds to what the agent owes / reduces what RUKN owes him)
--     receipt voucher (in)  → credit (reduces what he owes)
--   * cash_entries.agent_id + categories agent_payment / agent_receipt
--   * vouchers already made to a person who is an agent are linked to him
--   * the agent sees (and prints) his own vouchers
-- Safe to run more than once.
-- =====================================================================

alter table public.cash_entries add column if not exists agent_id uuid references public.profiles (id) on delete restrict;
create index if not exists cash_entries_agent_idx on public.cash_entries (agent_id);

alter table public.cash_entries drop constraint if exists cash_entries_category_check;
alter table public.cash_entries add constraint cash_entries_category_check check (category in (
  'case_payment', 'owner_deposit', 'advance_return', 'other_income', 'partner_refund', 'agent_receipt',
  'withdrawal', 'advance', 'salary', 'supplies', 'lab', 'planning', 'shipping', 'rent', 'utilities', 'marketing', 'fees', 'agent_payment',
  'transfer', 'other'));

create or replace function public.tg_cash_entries_agent_link()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_name text;
begin
  if new.agent_id is not null then
    if not exists (select 1 from public.user_roles where user_id = new.agent_id and role::text = 'agent') then
      raise exception 'Choose an agent.' using errcode = '22023';
    end if;
    if new.partner_id is not null then raise exception 'A voucher is for an agent or a partner, not both.' using errcode = '22023'; end if;
    select coalesce(full_name, email) into v_name from public.profiles where id = new.agent_id;
    new.party_user := null;
    new.party_name := v_name;
  elsif new.category in ('agent_payment', 'agent_receipt') then
    raise exception 'Choose the agent.' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists cash_entries_agent_link on public.cash_entries;
create trigger cash_entries_agent_link before insert or update on public.cash_entries for each row execute function public.tg_cash_entries_agent_link();

-- Vouchers already made to a person who is an agent → his account (case payments are counted through their receipts)
alter table public.cash_entries disable trigger cash_entries_before;
update public.cash_entries e set agent_id = e.party_user, party_user = null
  where e.party_user is not null and e.agent_id is null and e.case_payment_id is null and e.transfer_group is null
    and exists (select 1 from public.user_roles r where r.user_id = e.party_user and r.role::text = 'agent');
alter table public.cash_entries enable trigger cash_entries_before;

drop policy if exists cash_entries_agent_select on public.cash_entries;
create policy cash_entries_agent_select on public.cash_entries for select to authenticated
  using (agent_id is not null and agent_id = auth.uid() and public.is_agent());

notify pgrst, 'reload schema';
