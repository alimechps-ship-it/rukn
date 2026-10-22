-- =====================================================================
-- RUKN — Agent confirmations and payment notices
--   * The agent confirms he received the shipment (case → Delivered,
--     delivery note DN- issued automatically) or the treatment plan.
--   * The agent sends a payment notice (إشعار دفع, PN-YY-#####) with the
--     transfer details and a photo/PDF of the receipt.
--   * The case manager accepts it — a payment receipt (RC-) is issued and,
--     if a cash box is chosen, the money is deposited into it (CR-) — or
--     rejects it with a reason the agent can see.
-- Requires the cases, invoices and finance migrations. Safe to re-run.
-- =====================================================================

-- Proof files are stored with the case's other files (private bucket)
alter table public.case_files drop constraint if exists case_files_category_check;
alter table public.case_files add constraint case_files_category_check check (category in
  ('scan_upper', 'scan_lower', 'bite', 'photos', 'xray', 'prescription', 'treatment_plan', 'payment_proof', 'delivery_proof', 'other'));

alter table public.cases add column if not exists plan_received_at timestamptz;
alter table public.cases add column if not exists plan_received_by text check (char_length(plan_received_by) <= 120);

-- ---------------------------------------------------------------------
-- Receipt confirmations (agent or case staff)
-- ---------------------------------------------------------------------
create or replace function public.confirm_case_receipt(p_case uuid, p_what text, p_name text, p_notes text default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.cases%rowtype; v_name text := left(btrim(coalesce(p_name, '')), 120); v_no text;
begin
  select * into c from public.cases where id = p_case;
  if not found or not public.can_access_case(p_case) then raise exception 'Case not found' using errcode = '42501'; end if;
  if char_length(v_name) < 2 then raise exception 'Enter the name of the person who received it.' using errcode = '22023'; end if;
  if p_what = 'shipment' then
    if c.status <> 'shipped' then
      raise exception 'The shipment can be confirmed once the case is marked as shipped.' using errcode = '22023';
    end if;
    perform set_config('rukn.rpc', 'on', true);
    update public.cases
       set status = 'delivered', received_by_name = v_name, delivered_at = now(),
           delivery_notes = coalesce(nullif(btrim(p_notes), ''), delivery_notes)
     where id = p_case
     returning delivery_no into v_no;
    perform set_config('rukn.rpc', 'off', true);
    insert into public.case_events (case_id, kind, body, author_id)
    values (p_case, 'approval', 'Shipment received by ' || v_name || ' — delivery note ' || v_no
            || coalesce(' — ' || nullif(btrim(p_notes), ''), ''), auth.uid());
    return v_no;
  elsif p_what = 'plan' then
    if not exists (select 1 from public.case_files where case_id = p_case and is_deliverable) then
      raise exception 'There is no treatment plan file from RUKN on this case yet.' using errcode = '22023';
    end if;
    perform set_config('rukn.rpc', 'on', true);
    update public.cases set plan_received_at = now(), plan_received_by = v_name where id = p_case;
    perform set_config('rukn.rpc', 'off', true);
    insert into public.case_events (case_id, kind, body, author_id)
    values (p_case, 'approval', 'Treatment plan received by ' || v_name || coalesce(' — ' || nullif(btrim(p_notes), ''), ''), auth.uid());
    return null;
  end if;
  raise exception 'Unknown confirmation.' using errcode = '22023';
end $$;
revoke all on function public.confirm_case_receipt(uuid, text, text, text) from public, anon;
grant execute on function public.confirm_case_receipt(uuid, text, text, text) to authenticated;

-- Case update guard: agents change protected fields only through the confirmation functions above.
drop trigger if exists cases_plan_received_guard on public.cases;
drop function if exists public.tg_cases_plan_received_guard();
create or replace function public.tg_cases_before_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare via_rpc boolean := coalesce(current_setting('rukn.rpc', true), '') = 'on';
begin
  new.code := old.code;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();
  if not public.is_case_staff() then
    if old.status <> 'submitted' and not via_rpc then
      raise exception 'This case can no longer be edited. Add a comment instead.' using errcode = '42501';
    end if;
    new.agent_id := old.agent_id; new.assigned_to := old.assigned_to;
    new.intake_no := old.intake_no; new.intake_items := old.intake_items; new.intake_received_at := old.intake_received_at;
    new.intake_received_by := old.intake_received_by; new.intake_notes := old.intake_notes;
    new.quote_amount := old.quote_amount; new.quote_currency := old.quote_currency;
    new.carrier := old.carrier; new.tracking_no := old.tracking_no; new.shipped_at := old.shipped_at;
    new.delivery_no := old.delivery_no;
    if not via_rpc then
      new.status := old.status;
      new.plan_approved_at := old.plan_approved_at; new.plan_approved_by := old.plan_approved_by;
      new.plan_received_at := old.plan_received_at; new.plan_received_by := old.plan_received_by;
      new.delivered_at := old.delivered_at; new.received_by_name := old.received_by_name;
      new.delivery_notes := old.delivery_notes; new.closed_at := old.closed_at;
    end if;
  end if;
  if new.intake_received_at is not null and old.intake_no is null then
    new.intake_no := 'RR-' || to_char(now(), 'YY') || '-' || lpad(public.next_doc_no('intake')::text, 5, '0');
    new.intake_received_by := coalesce(new.intake_received_by, auth.uid());
  end if;
  if new.status = 'shipped' and new.shipped_at is null then new.shipped_at := now(); end if;
  if new.status = 'delivered' then
    new.delivered_at := coalesce(new.delivered_at, now());
    if old.delivery_no is null then
      new.delivery_no := 'DN-' || to_char(now(), 'YY') || '-' || lpad(public.next_doc_no('delivery')::text, 5, '0');
    end if;
  end if;
  if new.status in ('delivered', 'cancelled') and old.status not in ('delivered', 'cancelled') then new.closed_at := now(); end if;
  if new.status not in ('delivered', 'cancelled') then new.closed_at := null; end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Payment notices
-- ---------------------------------------------------------------------
create table if not exists public.case_payment_claims (
  id            uuid primary key default gen_random_uuid(),
  notice_no     text unique,
  case_id       uuid not null references public.cases (id) on delete cascade,
  invoice_id    uuid references public.case_invoices (id) on delete set null,
  amount        numeric(12, 2) not null check (amount > 0),
  currency      text not null check (currency ~ '^[A-Z]{3}$'),
  method        text not null check (method in ('cash', 'bank_transfer', 'card', 'online', 'other')),
  paid_at       date not null default current_date,
  reference     text check (char_length(reference) <= 120),
  notes         text check (char_length(notes) <= 500),
  proof_file_id uuid references public.case_files (id) on delete set null,
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  submitted_by  uuid references public.profiles (id) on delete set null,
  reviewed_by   uuid references public.profiles (id) on delete set null,
  reviewed_at   timestamptz,
  review_note   text check (char_length(review_note) <= 300),
  payment_id    uuid references public.case_payments (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists case_payment_claims_case_idx on public.case_payment_claims (case_id);
create index if not exists case_payment_claims_status_idx on public.case_payment_claims (status);

create or replace function public.tg_payment_claims_before()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare inv record;
begin
  if tg_op = 'UPDATE' then
    if current_setting('rukn.claim', true) is distinct from 'on' then
      raise exception 'Payment notices are reviewed with the Accept / Reject buttons.' using errcode = '42501';
    end if;
    new.notice_no := old.notice_no; new.case_id := old.case_id; new.submitted_by := old.submitted_by; new.created_at := old.created_at;
    return new;
  end if;
  new.status := 'pending'; new.reviewed_by := null; new.reviewed_at := null; new.review_note := null; new.payment_id := null;
  new.submitted_by := auth.uid();
  if new.invoice_id is not null then
    select case_id, status, currency into inv from public.case_invoices where id = new.invoice_id;
    if inv.case_id is distinct from new.case_id or inv.status <> 'issued' then
      raise exception 'Choose an issued invoice of this case.' using errcode = '22023';
    end if;
    new.currency := inv.currency;
  end if;
  if new.proof_file_id is not null and not exists (select 1 from public.case_files where id = new.proof_file_id and case_id = new.case_id) then
    raise exception 'The proof file does not belong to this case.' using errcode = '22023';
  end if;
  new.notice_no := 'PN-' || to_char(now(), 'YY') || '-' || lpad(public.next_doc_no('payment_notice')::text, 5, '0');
  return new;
end $$;
drop trigger if exists payment_claims_before on public.case_payment_claims;
create trigger payment_claims_before before insert or update on public.case_payment_claims for each row execute function public.tg_payment_claims_before();

create or replace function public.tg_payment_claims_after()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.case_events (case_id, kind, body, author_id)
  values (new.case_id, 'payment', 'Payment notice ' || new.notice_no || ' sent: ' || new.amount || ' ' || new.currency
          || ' (' || replace(new.method, '_', ' ') || coalesce(', ref. ' || new.reference, '') || ') — awaiting confirmation', auth.uid());
  return null;
end $$;
drop trigger if exists payment_claims_after on public.case_payment_claims;
create trigger payment_claims_after after insert on public.case_payment_claims for each row execute function public.tg_payment_claims_after();

drop trigger if exists case_payment_claims_audit on public.case_payment_claims;
create trigger case_payment_claims_audit after insert or update or delete on public.case_payment_claims for each row execute function public.tg_audit();

-- Case staff accept a notice: issues the payment receipt and (optionally) deposits it in a cash box.
create or replace function public.accept_payment_claim(p_claim uuid, p_cash_account uuid default null, p_amount numeric default null, p_note text default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare cl public.case_payment_claims%rowtype; v_pay uuid; v_rc text; v_amount numeric(12,2); v_box text;
begin
  if not public.is_case_staff() then raise exception 'Only RUKN case staff can confirm payments.' using errcode = '42501'; end if;
  select * into cl from public.case_payment_claims where id = p_claim for update;
  if not found then raise exception 'Payment notice not found.' using errcode = '22023'; end if;
  if cl.status <> 'pending' then raise exception 'This payment notice was already %.', cl.status using errcode = '22023'; end if;
  v_amount := coalesce(nullif(p_amount, 0), cl.amount);
  if v_amount <= 0 then raise exception 'Enter the amount received.' using errcode = '22023'; end if;
  if cl.invoice_id is not null and not exists (select 1 from public.case_invoices where id = cl.invoice_id and status = 'issued') then
    cl.invoice_id := null; -- the invoice was voided meanwhile: record the payment on the case
  end if;
  insert into public.case_payments (case_id, amount, currency, method, reference, paid_at, notes, invoice_id, cash_account_id)
  values (cl.case_id, v_amount, cl.currency, cl.method, cl.reference, cl.paid_at,
          left('Payment notice ' || cl.notice_no || coalesce(' — ' || nullif(btrim(p_note), ''), ''), 500), cl.invoice_id, p_cash_account)
  returning id, receipt_no into v_pay, v_rc;
  perform set_config('rukn.claim', 'on', true);
  update public.case_payment_claims
     set status = 'accepted', payment_id = v_pay, reviewed_by = auth.uid(), reviewed_at = now(), review_note = left(nullif(btrim(p_note), ''), 300)
   where id = p_claim;
  perform set_config('rukn.claim', 'off', true);
  select name into v_box from public.cash_accounts where id = p_cash_account;
  insert into public.case_events (case_id, kind, body, author_id)
  values (cl.case_id, 'payment', 'Payment notice ' || cl.notice_no || ' confirmed — receipt ' || v_rc || ' · ' || v_amount || ' ' || cl.currency
          || coalesce(' · deposited in ' || v_box, ''), auth.uid());
  return v_rc;
end $$;
revoke all on function public.accept_payment_claim(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.accept_payment_claim(uuid, uuid, numeric, text) to authenticated;

create or replace function public.reject_payment_claim(p_claim uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare cl public.case_payment_claims%rowtype;
begin
  if not public.is_case_staff() then raise exception 'Only RUKN case staff can review payments.' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Write the reason so the agent knows what to fix.' using errcode = '22023'; end if;
  select * into cl from public.case_payment_claims where id = p_claim for update;
  if not found or cl.status <> 'pending' then raise exception 'Only pending notices can be rejected.' using errcode = '22023'; end if;
  perform set_config('rukn.claim', 'on', true);
  update public.case_payment_claims set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = left(btrim(p_reason), 300) where id = p_claim;
  perform set_config('rukn.claim', 'off', true);
  insert into public.case_events (case_id, kind, body, author_id)
  values (cl.case_id, 'payment', 'Payment notice ' || cl.notice_no || ' not accepted: ' || left(btrim(p_reason), 300), auth.uid());
end $$;
revoke all on function public.reject_payment_claim(uuid, text) from public, anon;
grant execute on function public.reject_payment_claim(uuid, text) to authenticated;

-- The agent can withdraw his own pending notice (e.g. wrong amount).
create or replace function public.cancel_payment_claim(p_claim uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare cl public.case_payment_claims%rowtype;
begin
  select * into cl from public.case_payment_claims where id = p_claim for update;
  if not found or not public.can_access_case(cl.case_id) then raise exception 'Payment notice not found.' using errcode = '42501'; end if;
  if cl.status <> 'pending' then raise exception 'Only pending notices can be withdrawn.' using errcode = '22023'; end if;
  if cl.submitted_by is distinct from auth.uid() and not public.is_case_staff() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  perform set_config('rukn.claim', 'on', true);
  update public.case_payment_claims set status = 'cancelled', reviewed_at = now() where id = p_claim;
  perform set_config('rukn.claim', 'off', true);
  insert into public.case_events (case_id, kind, body, author_id)
  values (cl.case_id, 'payment', 'Payment notice ' || cl.notice_no || ' withdrawn', auth.uid());
end $$;
revoke all on function public.cancel_payment_claim(uuid) from public, anon;
grant execute on function public.cancel_payment_claim(uuid) to authenticated;

alter table public.case_payment_claims enable row level security;
revoke all on public.case_payment_claims from anon;
revoke update, delete, truncate on public.case_payment_claims from authenticated;
grant select, insert on public.case_payment_claims to authenticated;
drop policy if exists payment_claims_select on public.case_payment_claims;
drop policy if exists payment_claims_insert on public.case_payment_claims;
create policy payment_claims_select on public.case_payment_claims for select to authenticated using (public.can_access_case(case_id));
create policy payment_claims_insert on public.case_payment_claims for insert to authenticated with check (public.can_access_case(case_id));

drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated using (
  public.is_super_admin()
  or (public.can_manage_content() and entity_type not in ('inquiries', 'inquiry_notes', 'profiles', 'user_roles', 'private_settings', 'cases', 'case_payments', 'case_files', 'case_invoices', 'case_price_items', 'cash_accounts', 'cash_entries', 'case_payment_claims'))
  or (public.has_role('sales_manager') and entity_type in ('inquiries', 'inquiry_notes'))
  or (public.has_role('translator') and entity_type like '%translations')
  or (public.is_case_staff() and entity_type in ('cases', 'case_payments', 'case_files', 'case_invoices', 'case_price_items', 'cash_accounts', 'cash_entries', 'case_payment_claims')));

notify pgrst, 'reload schema';
