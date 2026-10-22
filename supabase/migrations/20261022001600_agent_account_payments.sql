-- =====================================================================
-- RUKN — Agent payments on account / in advance
--   The agent can send a payment notice whenever he owes RUKN money or as an
--   advance (دفعة مقدمة): for an invoice, for a case, or on his account
--   without a case. The finance manager confirms it (receipt RC-, into a cash
--   box) or rejects it, as before.
--   * case_payments / case_payment_claims get agent_id; case_id becomes optional.
--   * Proof for a notice without a case is stored at case-files/agent/<agent id>/…
-- Safe to run more than once.
-- =====================================================================

-- 1. Payments (receipts) belong to an agent; the case is optional
alter table public.case_payments add column if not exists agent_id uuid references public.profiles (id) on delete restrict;
update public.case_payments p set agent_id = c.agent_id from public.cases c where c.id = p.case_id and p.agent_id is null;
alter table public.case_payments alter column case_id drop not null;
create index if not exists case_payments_agent_idx on public.case_payments (agent_id);

create or replace function public.tg_case_payments_before()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.case_id is not null then select agent_id into new.agent_id from public.cases where id = new.case_id; end if;
    if new.agent_id is null then raise exception 'A payment needs a case or an agent.' using errcode = '22023'; end if;
    if new.invoice_id is not null and new.case_id is null then
      select case_id into new.case_id from public.case_invoices where id = new.invoice_id;
    end if;
    new.receipt_no := 'RC-' || to_char(now(), 'YY') || '-' || lpad(public.next_doc_no('receipt')::text, 5, '0');
    new.received_by := auth.uid();
  else
    new.receipt_no := old.receipt_no; new.case_id := old.case_id; new.agent_id := coalesce(old.agent_id, new.agent_id); new.created_at := old.created_at;
  end if;
  return new;
end $$;

create or replace function public.tg_case_payments_event()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.case_id is null then return null; end if;   -- payments on account have no case timeline
  if tg_op = 'INSERT' then
    insert into public.case_events (case_id, kind, body, author_id)
    values (new.case_id, 'payment', new.receipt_no || ' · ' || new.amount || ' ' || new.currency, auth.uid());
  elsif new.voided and not old.voided then
    insert into public.case_events (case_id, kind, body, author_id)
    values (new.case_id, 'payment', new.receipt_no || ' voided' || coalesce(': ' || new.void_reason, ''), auth.uid());
  end if;
  return null;
end $$;

create or replace function public.tg_case_payments_cash_post()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text; v_agent text;
begin
  if tg_op = 'INSERT' and new.cash_account_id is not null then
    select code into v_code from public.cases where id = new.case_id;
    select coalesce(full_name, email) into v_agent from public.profiles where id = new.agent_id;
    insert into public.cash_entries (account_id, direction, amount, currency, entry_date, category, description, reference, case_id, case_payment_id, party_name)
    values (new.cash_account_id, 'in', new.amount, new.currency, new.paid_at, 'case_payment',
            coalesce('Case ' || v_code, 'Payment on account') || ' · receipt ' || new.receipt_no, new.reference, new.case_id, new.id, v_agent);
  elsif tg_op = 'UPDATE' and new.voided and not old.voided then
    perform set_config('rukn.cash_cascade', 'on', true);
    update public.cash_entries set voided = true, void_reason = coalesce(new.void_reason, 'Payment voided')
      where case_payment_id = new.id and not voided;
    perform set_config('rukn.cash_cascade', 'off', true);
  end if;
  return null;
end $$;

drop policy if exists case_payments_select on public.case_payments;
create policy case_payments_select on public.case_payments for select to authenticated
  using (public.is_finance() or (public.is_agent() and agent_id = auth.uid()));

-- 2. Payment notices: agent_id, optional case, proof without a case
alter table public.case_payment_claims add column if not exists agent_id uuid references public.profiles (id) on delete cascade;
alter table public.case_payment_claims add column if not exists proof_path text check (proof_path is null or proof_path ~ '^agent/[0-9a-f-]{36}/[^/]+$');
select set_config('rukn.claim', 'on', false);
update public.case_payment_claims n set agent_id = c.agent_id from public.cases c where c.id = n.case_id and n.agent_id is null;
select set_config('rukn.claim', 'off', false);
alter table public.case_payment_claims alter column case_id drop not null;
create index if not exists case_payment_claims_agent_idx on public.case_payment_claims (agent_id);

create or replace function public.tg_payment_claims_before()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare inv record;
begin
  if tg_op = 'UPDATE' then
    if current_setting('rukn.claim', true) is distinct from 'on' then
      raise exception 'Payment notices are reviewed with the Accept / Reject buttons.' using errcode = '42501';
    end if;
    new.notice_no := old.notice_no; new.case_id := old.case_id; new.agent_id := coalesce(old.agent_id, new.agent_id); new.submitted_by := old.submitted_by; new.created_at := old.created_at;
    return new;
  end if;
  new.status := 'pending'; new.reviewed_by := null; new.reviewed_at := null; new.review_note := null; new.payment_id := null;
  new.submitted_by := auth.uid();
  if new.invoice_id is not null then
    select case_id, status, currency into inv from public.case_invoices where id = new.invoice_id;
    if inv.status is distinct from 'issued' or (new.case_id is not null and inv.case_id <> new.case_id) then
      raise exception 'Choose an issued invoice.' using errcode = '22023';
    end if;
    new.case_id := inv.case_id;
    new.currency := inv.currency;
  end if;
  if new.case_id is not null then
    select agent_id into new.agent_id from public.cases where id = new.case_id;
  elsif public.is_agent() and not public.is_finance() then
    new.agent_id := auth.uid();
  end if;
  if new.agent_id is null then raise exception 'Choose the case or the agent.' using errcode = '22023'; end if;
  if public.is_agent() and not public.is_finance() and new.agent_id <> auth.uid() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if new.proof_file_id is not null and (new.case_id is null or not exists (select 1 from public.case_files where id = new.proof_file_id and case_id = new.case_id)) then
    raise exception 'The proof file does not belong to this case.' using errcode = '22023';
  end if;
  if new.proof_path is not null and split_part(new.proof_path, '/', 2) <> new.agent_id::text then
    raise exception 'The proof file does not belong to this agent.' using errcode = '22023';
  end if;
  new.notice_no := 'PN-' || to_char(now(), 'YY') || '-' || lpad(public.next_doc_no('payment_notice')::text, 5, '0');
  return new;
end $$;

create or replace function public.tg_payment_claims_after()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.case_id is null then return null; end if;
  insert into public.case_events (case_id, kind, body, author_id)
  values (new.case_id, 'payment', 'Payment notice ' || new.notice_no || ' sent: ' || new.amount || ' ' || new.currency
          || ' (' || replace(new.method, '_', ' ') || coalesce(', ref. ' || new.reference, '') || ') — awaiting confirmation', auth.uid());
  return null;
end $$;

drop policy if exists payment_claims_select on public.case_payment_claims;
drop policy if exists payment_claims_insert on public.case_payment_claims;
create policy payment_claims_select on public.case_payment_claims for select to authenticated
  using (public.is_finance() or (public.is_agent() and agent_id = auth.uid()));
create policy payment_claims_insert on public.case_payment_claims for insert to authenticated
  with check (public.is_finance() or (public.is_agent() and (case_id is null or public.is_case_agent(case_id))));

create or replace function public.accept_payment_claim(p_claim uuid, p_cash_account uuid default null, p_amount numeric default null, p_note text default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare cl public.case_payment_claims%rowtype; v_pay uuid; v_rc text; v_amount numeric(12,2); v_box text;
begin
  if not public.is_finance() then raise exception 'Only the finance team can confirm payments.' using errcode = '42501'; end if;
  select * into cl from public.case_payment_claims where id = p_claim for update;
  if not found then raise exception 'Payment notice not found.' using errcode = '22023'; end if;
  if cl.status <> 'pending' then raise exception 'This payment notice was already %.', cl.status using errcode = '22023'; end if;
  v_amount := coalesce(nullif(p_amount, 0), cl.amount);
  if v_amount <= 0 then raise exception 'Enter the amount received.' using errcode = '22023'; end if;
  if cl.invoice_id is not null and not exists (select 1 from public.case_invoices where id = cl.invoice_id and status = 'issued') then cl.invoice_id := null; end if;
  insert into public.case_payments (case_id, agent_id, amount, currency, method, reference, paid_at, notes, invoice_id, cash_account_id)
  values (cl.case_id, cl.agent_id, v_amount, cl.currency, cl.method, cl.reference, cl.paid_at,
          left('Payment notice ' || cl.notice_no || case when cl.case_id is null then ' (on account / advance)' else '' end || coalesce(' — ' || nullif(btrim(p_note), ''), ''), 500),
          cl.invoice_id, p_cash_account)
  returning id, receipt_no into v_pay, v_rc;
  perform set_config('rukn.claim', 'on', true);
  update public.case_payment_claims set status = 'accepted', payment_id = v_pay, reviewed_by = auth.uid(), reviewed_at = now(), review_note = left(nullif(btrim(p_note), ''), 300) where id = p_claim;
  perform set_config('rukn.claim', 'off', true);
  select name into v_box from public.cash_accounts where id = p_cash_account;
  if cl.case_id is not null then
    insert into public.case_events (case_id, kind, body, author_id)
    values (cl.case_id, 'payment', 'Payment notice ' || cl.notice_no || ' confirmed — receipt ' || v_rc || ' · ' || v_amount || ' ' || cl.currency || coalesce(' · deposited in ' || v_box, ''), auth.uid());
  end if;
  return v_rc;
end $$;

create or replace function public.reject_payment_claim(p_claim uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare cl public.case_payment_claims%rowtype;
begin
  if not public.is_finance() then raise exception 'Only the finance team can review payments.' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Write the reason so the agent knows what to fix.' using errcode = '22023'; end if;
  select * into cl from public.case_payment_claims where id = p_claim for update;
  if not found or cl.status <> 'pending' then raise exception 'Only pending notices can be rejected.' using errcode = '22023'; end if;
  perform set_config('rukn.claim', 'on', true);
  update public.case_payment_claims set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = left(btrim(p_reason), 300) where id = p_claim;
  perform set_config('rukn.claim', 'off', true);
  if cl.case_id is not null then
    insert into public.case_events (case_id, kind, body, author_id) values (cl.case_id, 'payment', 'Payment notice ' || cl.notice_no || ' not accepted: ' || left(btrim(p_reason), 300), auth.uid());
  end if;
end $$;

create or replace function public.cancel_payment_claim(p_claim uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare cl public.case_payment_claims%rowtype;
begin
  select * into cl from public.case_payment_claims where id = p_claim for update;
  if not found or not (public.is_finance() or (public.is_agent() and cl.agent_id = auth.uid())) then raise exception 'Payment notice not found.' using errcode = '42501'; end if;
  if cl.status <> 'pending' then raise exception 'Only pending notices can be withdrawn.' using errcode = '22023'; end if;
  if cl.submitted_by is distinct from auth.uid() and not public.is_finance() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  perform set_config('rukn.claim', 'on', true);
  update public.case_payment_claims set status = 'cancelled', reviewed_at = now() where id = p_claim;
  perform set_config('rukn.claim', 'off', true);
  if cl.case_id is not null then
    insert into public.case_events (case_id, kind, body, author_id) values (cl.case_id, 'payment', 'Payment notice ' || cl.notice_no || ' withdrawn', auth.uid());
  end if;
end $$;

-- 3. Proof files of notices without a case: case-files/agent/<agent id>/<file>
drop policy if exists "agent_proofs_read" on storage.objects;
drop policy if exists "agent_proofs_upload" on storage.objects;
create policy "agent_proofs_read" on storage.objects for select to authenticated
  using (bucket_id = 'case-files' and split_part(name, '/', 1) = 'agent'
         and (public.is_finance() or (public.is_agent() and split_part(name, '/', 2) = auth.uid()::text)));
create policy "agent_proofs_upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'case-files' and split_part(name, '/', 1) = 'agent' and public.is_agent()
              and split_part(name, '/', 2) = auth.uid()::text
              and lower(split_part(name, '.', -1)) in ('pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic'));

notify pgrst, 'reload schema';
