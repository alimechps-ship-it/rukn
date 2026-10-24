-- =====================================================================
-- RUKN — Agent money is never custody (عهدة)
--   * Case payments deposited into a box are linked to the agent (agent_id),
--     not to a "person" — they no longer appear in Person accounts.
--   * Vouchers that were typed with an agent's exact name are linked to him.
--   * Vouchers with an agent get the agent types (paid to / received from an agent).
--   * The agent sees only his own direct vouchers (not the box deposits of his receipts).
-- Safe to run more than once.
-- =====================================================================

create or replace function public.tg_case_payments_cash_post()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text;
begin
  if tg_op = 'INSERT' and new.cash_account_id is not null then
    select code into v_code from public.cases where id = new.case_id;
    insert into public.cash_entries (account_id, direction, amount, currency, entry_date, category, description, reference, case_id, case_payment_id, agent_id)
    values (new.cash_account_id, 'in', new.amount, new.currency, new.paid_at, 'case_payment',
            coalesce('Case ' || v_code, 'Payment on account') || ' · receipt ' || new.receipt_no, new.reference, new.case_id, new.id,
            (select r.user_id from public.user_roles r where r.user_id = new.agent_id and r.role::text = 'agent' limit 1));
  elsif tg_op = 'UPDATE' and new.voided and not old.voided then
    perform set_config('rukn.cash_cascade', 'on', true);
    update public.cash_entries set voided = true, void_reason = coalesce(new.void_reason, 'Payment voided')
      where case_payment_id = new.id and not voided;
    perform set_config('rukn.cash_cascade', 'off', true);
  end if;
  return null;
end $$;

alter table public.cash_entries disable trigger cash_entries_before;
alter table public.cash_entries disable trigger cash_entries_journal_guard;

-- receipts of agents already in the boxes
update public.cash_entries e set agent_id = p.agent_id, party_user = null,
       party_name = (select coalesce(full_name, email) from public.profiles where id = p.agent_id)
  from public.case_payments p
  where e.case_payment_id = p.id and e.agent_id is null and p.agent_id is not null
    and exists (select 1 from public.user_roles r where r.user_id = p.agent_id and r.role::text = 'agent');

-- vouchers typed with an agent's exact name (only when the name belongs to one agent)
update public.cash_entries e set agent_id = a.id, party_user = null
  from (select pr.id, lower(trim(pr.full_name)) as n from public.profiles pr
        join public.user_roles r on r.user_id = pr.id and r.role::text = 'agent'
        where pr.full_name is not null) a
  where e.agent_id is null and e.partner_id is null and e.case_payment_id is null and e.transfer_group is null and e.journal_id is null
    and e.party_user is null and lower(trim(e.party_name)) = a.n
    and (select count(*) from public.profiles p2 join public.user_roles r2 on r2.user_id = p2.id and r2.role::text = 'agent'
         where lower(trim(p2.full_name)) = a.n) = 1;

-- agent vouchers carry the agent types (never custody / withdrawal)
update public.cash_entries set category = case when direction = 'out' then 'agent_payment' else 'agent_receipt' end
  where agent_id is not null and case_payment_id is null and journal_id is null and transfer_group is null
    and category not in ('agent_payment', 'agent_receipt');

alter table public.cash_entries enable trigger cash_entries_journal_guard;
alter table public.cash_entries enable trigger cash_entries_before;

drop policy if exists cash_entries_agent_select on public.cash_entries;
create policy cash_entries_agent_select on public.cash_entries for select to authenticated
  using (agent_id is not null and agent_id = auth.uid() and case_payment_id is null and public.is_agent());

notify pgrst, 'reload schema';
