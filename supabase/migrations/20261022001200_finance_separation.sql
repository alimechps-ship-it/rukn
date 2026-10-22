-- =====================================================================
-- RUKN — Separate the Case Manager (administration) from the Finance Manager
--   * New role finance_manager.
--   * Case Manager: cases, intake, files, plans, work orders, dispatch orders
--     (quantities only). NO prices, invoices, payments, cash, costs, partner
--     bills — enforced here with Row Level Security, not only in the screens.
--   * Finance Manager: prices, invoices, payment notices, receipts, cash boxes,
--     partner bills and payments, statements, work-order costs.
--   * Money that used to live on operational tables moves to finance-only tables:
--       cases.quote_*                 → case_finance
--       case_assignments.cost/currency → assignment_costs
--   * Dispatch orders DO-YY-#####: the case manager lists the services and
--     quantities and sends them to finance, who turns them into an invoice.
-- Safe to re-run.
-- =====================================================================

alter type public.app_role add value if not exists 'finance_manager';

-- ---------------------------------------------------------------------
-- Role helpers
-- ---------------------------------------------------------------------
create or replace function public.is_case_staff()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.role_names() && array['super_admin', 'case_manager', 'finance_manager'];
$$;
create or replace function public.is_ops()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.role_names() && array['super_admin', 'case_manager'];
$$;
create or replace function public.is_finance()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.role_names() && array['super_admin', 'finance_manager'];
$$;
create or replace function public.is_case_agent(p_case uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_agent() and exists (select 1 from public.cases c where c.id = p_case and c.agent_id = auth.uid());
$$;
create or replace function public.is_case_staff_user(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles r where r.user_id = p_user and r.role::text in ('super_admin', 'case_manager', 'finance_manager'));
$$;
grant execute on function public.is_case_staff(), public.is_ops(), public.is_finance(), public.is_case_agent(uuid) to authenticated;

drop policy if exists user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin()
         or (public.is_case_staff() and role::text in ('agent', 'case_manager', 'finance_manager', 'super_admin', 'planner', 'lab')));

-- ---------------------------------------------------------------------
-- Case price → case_finance (finance + the agent of the case)
-- ---------------------------------------------------------------------
create table if not exists public.case_finance (
  case_id        uuid primary key references public.cases (id) on delete cascade,
  quote_amount   numeric(12, 2) check (quote_amount is null or quote_amount >= 0),
  quote_currency text check (quote_currency is null or quote_currency ~ '^[A-Z]{3}$'),
  updated_at     timestamptz not null default now()
);
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cases' and column_name = 'quote_amount') then
    insert into public.case_finance (case_id, quote_amount, quote_currency)
    select id, quote_amount, quote_currency from public.cases where quote_amount is not null
    on conflict (case_id) do nothing;
  end if;
end $$;

create or replace function public.tg_cases_before_insert()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_case_staff() then
    new.agent_id := auth.uid();
    new.assigned_to := null;
  end if;
  new.status := 'submitted';
  new.code := 'RK-' || new.country_code || '-' || to_char(now(), 'YY') || '-' || lpad(public.next_doc_no('case')::text, 5, '0');
  new.created_by := auth.uid();
  new.intake_no := null; new.delivery_no := null; new.intake_received_at := null;
  new.plan_approved_at := null; new.shipped_at := null; new.delivered_at := null; new.closed_at := null;
  return new;
end $$;

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

create or replace function public.sync_case_quote(p_case uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int; v_cur text; v_sum numeric(12,2);
begin
  select count(distinct currency), min(currency), coalesce(sum(total), 0) into v_n, v_cur, v_sum
    from public.case_invoices where case_id = p_case and status = 'issued';
  if v_n = 1 then
    insert into public.case_finance (case_id, quote_amount, quote_currency, updated_at) values (p_case, v_sum, v_cur, now())
    on conflict (case_id) do update set quote_amount = excluded.quote_amount, quote_currency = excluded.quote_currency, updated_at = now();
  end if;
end $$;
revoke all on function public.sync_case_quote(uuid) from public, anon, authenticated;

-- The 0700 trigger still referenced cases.quote_* — route it through sync_case_quote
create or replace function public.tg_case_invoices_after()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if current_setting('rukn.invoice_recalc', true) = 'on' then return null; end if;
  if tg_op = 'UPDATE' and new.status in ('draft', 'issued') and (new.discount_amount <> old.discount_amount or new.tax_rate <> old.tax_rate) then
    perform public.recalc_case_invoice(new.id);
  end if;
  if tg_op = 'UPDATE' and new.status <> old.status then
    if new.status = 'issued' then
      insert into public.case_events (case_id, kind, body, author_id)
      values (new.case_id, 'payment', 'Invoice ' || new.invoice_no || ' issued · ' || new.total || ' ' || new.currency, auth.uid());
    elsif new.status = 'void' then
      insert into public.case_events (case_id, kind, body, author_id)
      values (new.case_id, 'payment', 'Invoice ' || new.invoice_no || ' voided' || coalesce(': ' || new.void_reason, ''), auth.uid());
    end if;
    perform public.sync_case_quote(new.case_id);
  end if;
  return null;
end $$;

alter table public.cases drop column if exists quote_amount;
alter table public.cases drop column if exists quote_currency;

-- ---------------------------------------------------------------------
-- Work-order cost → assignment_costs (finance + the partner of the order)
-- ---------------------------------------------------------------------
create table if not exists public.assignment_costs (
  assignment_id uuid primary key references public.case_assignments (id) on delete cascade,
  cost_amount   numeric(12, 2) check (cost_amount is null or cost_amount >= 0),
  currency      text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  updated_at    timestamptz not null default now()
);
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'case_assignments' and column_name = 'cost_amount') then
    insert into public.assignment_costs (assignment_id, cost_amount, currency)
    select id, cost_amount, currency from public.case_assignments
    on conflict (assignment_id) do nothing;
  end if;
end $$;

create or replace function public.tg_assignments_before()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare p record;
begin
  if tg_op = 'INSERT' then
    select * into p from public.partners where id = new.partner_id;
    if p.id is null or not p.active then raise exception 'Choose an active partner.' using errcode = '22023'; end if;
    if (p.kind = 'planner' and new.kind <> 'planning') or (p.kind = 'lab' and new.kind <> 'production') then
      raise exception 'Planning orders go to planners, production orders go to labs.' using errcode = '22023';
    end if;
    new.order_no := 'WO-' || to_char(now(), 'YY') || '-' || lpad(public.next_doc_no('work_order')::text, 5, '0');
    new.status := 'assigned'; new.created_by := auth.uid();
    new.accepted_at := null; new.completed_at := null; new.shipped_at := null; new.received_at := null;
    return new;
  end if;
  new.order_no := old.order_no; new.case_id := old.case_id; new.created_by := old.created_by; new.created_at := old.created_at;
  if new.partner_id <> old.partner_id and old.status <> 'assigned' then
    raise exception 'The partner can only be changed before the order is accepted.' using errcode = '22023';
  end if;
  if new.status <> old.status then
    if new.status = 'accepted' and new.accepted_at is null then new.accepted_at := now(); end if;
    if new.status = 'completed' and new.completed_at is null then new.completed_at := now(); end if;
    if new.status = 'shipped' and new.shipped_at is null then new.shipped_at := now(); end if;
    if new.status = 'received' and new.received_at is null then new.received_at := now(); end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- every new work order gets an (empty) cost row in the partner's currency
create or replace function public.tg_assignments_cost_row()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.assignment_costs (assignment_id, currency)
  select new.id, p.currency from public.partners p where p.id = new.partner_id
  on conflict (assignment_id) do nothing;
  return null;
end $$;
drop trigger if exists assignments_cost_row on public.case_assignments;
create trigger assignments_cost_row after insert on public.case_assignments for each row execute function public.tg_assignments_cost_row();

alter table public.case_assignments drop column if exists cost_amount;
alter table public.case_assignments drop column if exists currency;

-- ---------------------------------------------------------------------
-- Price list without prices for the case manager
-- ---------------------------------------------------------------------
create or replace function public.catalog_items()
returns table (id uuid, code text, category text, name_en text, name_ar text, unit_en text, unit_ar text)
language sql stable security definer set search_path = public, pg_temp as $$
  select id, code, category, name_en, name_ar, unit_en, unit_ar from public.case_price_items
   where active and public.is_case_staff() order by sort_order, code;
$$;
grant execute on function public.catalog_items() to authenticated;

-- ---------------------------------------------------------------------
-- Dispatch orders (اذن صرف): services + quantities, prepared by the case manager
-- ---------------------------------------------------------------------
create table if not exists public.case_dispatch_orders (
  id          uuid primary key default gen_random_uuid(),
  order_no    text unique,
  case_id     uuid not null references public.cases (id) on delete cascade,
  status      text not null default 'draft' check (status in ('draft', 'sent', 'invoiced', 'cancelled')),
  notes       text check (char_length(notes) <= 1500),
  invoice_id  uuid references public.case_invoices (id) on delete set null,
  created_by  uuid references public.profiles (id) on delete set null,
  sent_by     uuid references public.profiles (id) on delete set null,
  sent_at     timestamptz,
  invoiced_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists case_dispatch_orders_case_idx on public.case_dispatch_orders (case_id);
create index if not exists case_dispatch_orders_status_idx on public.case_dispatch_orders (status);

create table if not exists public.case_dispatch_lines (
  id             uuid primary key default gen_random_uuid(),
  dispatch_id    uuid not null references public.case_dispatch_orders (id) on delete cascade,
  sort_order     int not null default 0,
  price_item_id  uuid references public.case_price_items (id) on delete set null,
  code           text check (char_length(code) <= 24),
  description    text not null check (char_length(description) between 1 and 300),
  description_ar text check (char_length(description_ar) <= 300),
  arch           text check (arch in ('upper', 'lower', 'both')),
  unit           text check (char_length(unit) <= 40),
  qty            numeric(10, 2) not null default 1 check (qty > 0)
);
create index if not exists case_dispatch_lines_idx on public.case_dispatch_lines (dispatch_id);

create or replace function public.tg_dispatch_before()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.order_no := 'DO-' || to_char(now(), 'YY') || '-' || lpad(public.next_doc_no('dispatch')::text, 5, '0');
    new.status := 'draft'; new.created_by := auth.uid(); new.invoice_id := null; new.sent_by := null; new.sent_at := null; new.invoiced_at := null;
    return new;
  end if;
  new.order_no := old.order_no; new.case_id := old.case_id; new.created_by := old.created_by; new.created_at := old.created_at;
  if current_setting('rukn.dispatch', true) is distinct from 'on' then
    new.invoice_id := old.invoice_id; new.invoiced_at := old.invoiced_at;
    if old.status = 'invoiced' then raise exception 'This dispatch order is already invoiced.' using errcode = '42501'; end if;
    if new.status = 'invoiced' then raise exception 'Finance creates the invoice from the dispatch order.' using errcode = '42501'; end if;
    if new.status = 'sent' and old.status = 'draft' then
      if not exists (select 1 from public.case_dispatch_lines where dispatch_id = old.id) then
        raise exception 'Add at least one service before sending to finance.' using errcode = '22023';
      end if;
      new.sent_by := auth.uid(); new.sent_at := now();
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists dispatch_before on public.case_dispatch_orders;
create trigger dispatch_before before insert or update on public.case_dispatch_orders for each row execute function public.tg_dispatch_before();

create or replace function public.tg_dispatch_after()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into public.case_events (case_id, kind, body, author_id) values (new.case_id, 'internal', 'Dispatch order ' || new.order_no || ' prepared', auth.uid());
  elsif new.status <> old.status then
    insert into public.case_events (case_id, kind, body, author_id)
    values (new.case_id, 'internal', 'Dispatch order ' || new.order_no || ': ' || old.status || ' → ' || new.status, auth.uid());
  end if;
  return null;
end $$;
drop trigger if exists dispatch_after on public.case_dispatch_orders;
create trigger dispatch_after after insert or update on public.case_dispatch_orders for each row execute function public.tg_dispatch_after();

create or replace function public.tg_dispatch_lines_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_status text;
begin
  select status into v_status from public.case_dispatch_orders where id = coalesce(new.dispatch_id, old.dispatch_id);
  if v_status is not null and v_status <> 'draft' and current_setting('rukn.dispatch', true) is distinct from 'on' then
    raise exception 'Services can only change while the dispatch order is a draft (recall it from finance first).' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists dispatch_lines_guard on public.case_dispatch_lines;
create trigger dispatch_lines_guard before insert or update or delete on public.case_dispatch_lines for each row execute function public.tg_dispatch_lines_guard();

-- Finance: draft invoice from a dispatch order, with price-list prices
create or replace function public.invoice_from_dispatch(p_dispatch uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.case_dispatch_orders%rowtype; c public.cases%rowtype; v_inv uuid; v_cur text; v_due int; v_tax numeric; v_label text; v_terms text;
begin
  if not public.is_finance() then raise exception 'Only finance can price dispatch orders.' using errcode = '42501'; end if;
  select * into d from public.case_dispatch_orders where id = p_dispatch for update;
  if not found then raise exception 'Dispatch order not found.' using errcode = '22023'; end if;
  if d.status <> 'sent' then raise exception 'Only dispatch orders sent to finance can be invoiced (status: %).', d.status using errcode = '22023'; end if;
  select * into c from public.cases where id = d.case_id;
  select default_currency, due_days, tax_rate, tax_label, terms into v_cur, v_due, v_tax, v_label, v_terms from public.case_billing_settings where id = 1;
  select coalesce((select quote_currency from public.case_finance where case_id = d.case_id), v_cur, 'USD') into v_cur;
  insert into public.case_invoices (case_id, currency, issue_date, due_date, bill_to, tax_label, tax_rate, notes)
  values (d.case_id, v_cur, current_date, current_date + coalesce(v_due, 14),
          left(c.clinic_name || ' — ' || c.doctor_name || coalesce(E'\n' || nullif(btrim(coalesce(c.city, '')), ''), ''), 600),
          coalesce(v_label, 'VAT'), coalesce(v_tax, 0), v_terms)
  returning id into v_inv;
  insert into public.case_invoice_items (invoice_id, sort_order, price_item_id, code, description, description_ar, arch, unit, qty, unit_price)
  select v_inv, l.sort_order, l.price_item_id, l.code, l.description, l.description_ar, l.arch, l.unit, l.qty,
         coalesce((select p.unit_price from public.case_price_items p where p.id = l.price_item_id and p.currency = v_cur), 0)
    from public.case_dispatch_lines l where l.dispatch_id = d.id order by l.sort_order;
  perform set_config('rukn.dispatch', 'on', true);
  update public.case_dispatch_orders set status = 'invoiced', invoice_id = v_inv, invoiced_at = now() where id = d.id;
  perform set_config('rukn.dispatch', 'off', true);
  return v_inv;
end $$;
revoke all on function public.invoice_from_dispatch(uuid) from public, anon;
grant execute on function public.invoice_from_dispatch(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Money RLS: finance (and the agent / partner concerned) only
-- ---------------------------------------------------------------------
alter table public.case_finance enable row level security;
alter table public.assignment_costs enable row level security;
alter table public.case_dispatch_orders enable row level security;
alter table public.case_dispatch_lines enable row level security;
revoke all on public.case_finance, public.assignment_costs, public.case_dispatch_orders, public.case_dispatch_lines from anon;
grant select, insert, update, delete on public.case_finance, public.assignment_costs, public.case_dispatch_orders, public.case_dispatch_lines to authenticated;

drop policy if exists case_finance_select on public.case_finance;
drop policy if exists case_finance_write on public.case_finance;
create policy case_finance_select on public.case_finance for select to authenticated using (public.is_finance() or public.is_case_agent(case_id));
create policy case_finance_write on public.case_finance for all to authenticated using (public.is_finance()) with check (public.is_finance());

drop policy if exists assignment_costs_select on public.assignment_costs;
drop policy if exists assignment_costs_write on public.assignment_costs;
create policy assignment_costs_select on public.assignment_costs for select to authenticated
  using (public.is_finance() or exists (select 1 from public.case_assignments a where a.id = assignment_id and a.partner_id = public.my_partner()));
create policy assignment_costs_write on public.assignment_costs for all to authenticated using (public.is_finance()) with check (public.is_finance());

drop policy if exists dispatch_select on public.case_dispatch_orders;
drop policy if exists dispatch_insert on public.case_dispatch_orders;
drop policy if exists dispatch_update on public.case_dispatch_orders;
drop policy if exists dispatch_delete on public.case_dispatch_orders;
create policy dispatch_select on public.case_dispatch_orders for select to authenticated using (public.is_case_staff());
create policy dispatch_insert on public.case_dispatch_orders for insert to authenticated with check (public.is_ops());
create policy dispatch_update on public.case_dispatch_orders for update to authenticated using (public.is_case_staff()) with check (public.is_case_staff());
create policy dispatch_delete on public.case_dispatch_orders for delete to authenticated using (public.is_ops() and status = 'draft');
drop policy if exists dispatch_lines_select on public.case_dispatch_lines;
drop policy if exists dispatch_lines_write on public.case_dispatch_lines;
create policy dispatch_lines_select on public.case_dispatch_lines for select to authenticated using (public.is_case_staff());
create policy dispatch_lines_write on public.case_dispatch_lines for all to authenticated using (public.is_ops()) with check (public.is_ops());

-- case payments / receipts
drop policy if exists case_payments_select on public.case_payments;
drop policy if exists case_payments_insert on public.case_payments;
drop policy if exists case_payments_update on public.case_payments;
create policy case_payments_select on public.case_payments for select to authenticated using (public.is_finance() or public.is_case_agent(case_id));
create policy case_payments_insert on public.case_payments for insert to authenticated with check (public.is_finance());
create policy case_payments_update on public.case_payments for update to authenticated using (public.is_finance()) with check (public.is_finance());

-- price list & billing
drop policy if exists case_price_items_select on public.case_price_items;
drop policy if exists case_price_items_write on public.case_price_items;
create policy case_price_items_select on public.case_price_items for select to authenticated using (public.is_finance());
create policy case_price_items_write on public.case_price_items for all to authenticated using (public.is_finance()) with check (public.is_finance());
drop policy if exists case_billing_select on public.case_billing_settings;
drop policy if exists case_billing_update on public.case_billing_settings;
create policy case_billing_select on public.case_billing_settings for select to authenticated using (public.is_finance() or public.is_agent());
create policy case_billing_update on public.case_billing_settings for update to authenticated using (public.is_finance()) with check (public.is_finance());

-- invoices
drop policy if exists case_invoices_select on public.case_invoices;
drop policy if exists case_invoices_insert on public.case_invoices;
drop policy if exists case_invoices_update on public.case_invoices;
drop policy if exists case_invoices_delete on public.case_invoices;
create policy case_invoices_select on public.case_invoices for select to authenticated
  using (public.is_finance() or (status <> 'draft' and public.is_case_agent(case_id)));
create policy case_invoices_insert on public.case_invoices for insert to authenticated with check (public.is_finance());
create policy case_invoices_update on public.case_invoices for update to authenticated using (public.is_finance()) with check (public.is_finance());
create policy case_invoices_delete on public.case_invoices for delete to authenticated using (public.is_finance());
drop policy if exists case_invoice_items_write on public.case_invoice_items;
create policy case_invoice_items_write on public.case_invoice_items for all to authenticated using (public.is_finance()) with check (public.is_finance());

-- payment notices
drop policy if exists payment_claims_select on public.case_payment_claims;
drop policy if exists payment_claims_insert on public.case_payment_claims;
create policy payment_claims_select on public.case_payment_claims for select to authenticated using (public.is_finance() or public.is_case_agent(case_id));
create policy payment_claims_insert on public.case_payment_claims for insert to authenticated with check (public.is_finance() or public.is_case_agent(case_id));

-- cash
drop policy if exists cash_accounts_select on public.cash_accounts;
drop policy if exists cash_accounts_insert on public.cash_accounts;
drop policy if exists cash_accounts_update on public.cash_accounts;
create policy cash_accounts_select on public.cash_accounts for select to authenticated using (public.is_finance());
create policy cash_accounts_insert on public.cash_accounts for insert to authenticated with check (public.is_finance());
create policy cash_accounts_update on public.cash_accounts for update to authenticated using (public.is_finance()) with check (public.is_finance());
drop policy if exists cash_entries_select on public.cash_entries;
drop policy if exists cash_entries_insert on public.cash_entries;
drop policy if exists cash_entries_update on public.cash_entries;
create policy cash_entries_select on public.cash_entries for select to authenticated using (public.is_finance());
create policy cash_entries_insert on public.cash_entries for insert to authenticated with check (public.is_finance() and category <> 'case_payment' and category <> 'transfer');
create policy cash_entries_update on public.cash_entries for update to authenticated using (public.is_finance()) with check (public.is_finance());

-- partner bills & payments
drop policy if exists partner_bills_select on public.partner_bills;
drop policy if exists partner_bills_insert on public.partner_bills;
drop policy if exists partner_bills_update on public.partner_bills;
drop policy if exists partner_bills_delete on public.partner_bills;
create policy partner_bills_select on public.partner_bills for select to authenticated using (public.is_finance() or partner_id = public.my_partner());
create policy partner_bills_insert on public.partner_bills for insert to authenticated with check (public.is_finance() or public.is_partner());
create policy partner_bills_update on public.partner_bills for update to authenticated using (public.is_finance()) with check (public.is_finance());
create policy partner_bills_delete on public.partner_bills for delete to authenticated
  using (status = 'submitted' and (public.is_finance() or (partner_id = public.my_partner() and created_by = auth.uid())));
drop policy if exists partner_bill_lines_write on public.partner_bill_lines;
create policy partner_bill_lines_write on public.partner_bill_lines for all to authenticated
  using (public.is_finance() or exists (select 1 from public.partner_bills b where b.id = bill_id and b.partner_id = public.my_partner() and b.created_by = auth.uid()))
  with check (public.is_finance() or exists (select 1 from public.partner_bills b where b.id = bill_id and b.partner_id = public.my_partner() and b.created_by = auth.uid()));
drop policy if exists partner_payments_select on public.partner_payments;
drop policy if exists partner_payments_write on public.partner_payments;
create policy partner_payments_select on public.partner_payments for select to authenticated using (public.is_finance() or partner_id = public.my_partner());
create policy partner_payments_write on public.partner_payments for all to authenticated using (public.is_finance()) with check (public.is_finance());

create or replace function public.tg_partner_bills_before()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_finance() then new.partner_id := public.my_partner(); end if;
    if new.partner_id is null then raise exception 'Unknown partner.' using errcode = '42501'; end if;
    new.bill_no := 'PB-' || to_char(now(), 'YY') || '-' || lpad(public.next_doc_no('partner_bill')::text, 5, '0');
    new.status := 'submitted'; new.total := 0; new.created_by := auth.uid(); new.reviewed_by := null; new.reviewed_at := null; new.review_note := null;
    return new;
  end if;
  if current_setting('rukn.bill_total', true) = 'on' then return new; end if;
  new.bill_no := old.bill_no; new.partner_id := old.partner_id; new.created_by := old.created_by; new.created_at := old.created_at; new.total := old.total;
  if old.status in ('rejected', 'void') then raise exception 'This bill is closed.' using errcode = '42501'; end if;
  if old.status = 'approved' and new.status not in ('approved', 'void') then raise exception 'An approved bill can only be voided.' using errcode = '42501'; end if;
  if old.status = 'approved' and new.status = 'void'
     and exists (select 1 from public.partner_payments where bill_id = old.id and not voided) then
    raise exception 'Void the payments of this bill first.' using errcode = '22023';
  end if;
  if new.status <> old.status then new.reviewed_by := auth.uid(); new.reviewed_at := now(); end if;
  return new;
end $$;

-- events: money events (kind 'payment') only for finance and the agent of the case
drop policy if exists case_events_select on public.case_events;
create policy case_events_select on public.case_events for select to authenticated using (
  public.is_finance()
  or (public.is_ops() and kind <> 'payment')
  or (public.is_case_staff() and kind <> 'payment')
  or (public.is_case_agent(case_id) and kind <> 'internal'));

-- files: payment proofs only for finance and the agent
drop policy if exists case_files_select on public.case_files;
create policy case_files_select on public.case_files for select to authenticated using (
  public.is_finance()
  or (public.is_case_staff() and category <> 'payment_proof')
  or (public.is_case_agent(case_id) and not internal)
  or (public.partner_can_access_case(case_id) and category not in ('payment_proof', 'delivery_proof')));

-- RPCs that move money: finance only
create or replace function public.log_invoice_revision(p_invoice uuid, p_old_total numeric, p_note text default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare inv record; v_rev int;
begin
  if not public.is_finance() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  select * into inv from public.case_invoices where id = p_invoice;
  if inv.id is null or inv.status <> 'issued' then raise exception 'Only issued invoices have revisions.' using errcode = '22023'; end if;
  v_rev := inv.revision + 1;
  update public.case_invoices set revision = v_rev, revised_at = now(), revised_by = auth.uid() where id = p_invoice;
  insert into public.case_events (case_id, kind, body, author_id)
  values (inv.case_id, 'payment',
          'Invoice ' || inv.invoice_no || ' revised (rev. ' || v_rev || '): ' || round(p_old_total, 2) || ' → ' || inv.total || ' ' || inv.currency
          || coalesce(' — ' || nullif(trim(p_note), ''), ''), auth.uid());
  return v_rev;
end $$;

create or replace function public.cash_transfer(p_from uuid, p_to uuid, p_amount numeric, p_amount_to numeric default null,
                                                p_date date default current_date, p_description text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare g uuid := gen_random_uuid(); a_from record; a_to record; v_to numeric(14,2);
begin
  if not public.is_finance() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if p_from = p_to then raise exception 'Choose two different cash boxes.' using errcode = '22023'; end if;
  select * into a_from from public.cash_accounts where id = p_from;
  select * into a_to from public.cash_accounts where id = p_to;
  if a_from.id is null or a_to.id is null then raise exception 'Unknown cash box.' using errcode = '22023'; end if;
  v_to := case when a_from.currency = a_to.currency then p_amount else p_amount_to end;
  if v_to is null or v_to <= 0 then raise exception 'Enter the amount received in % (exchange).', a_to.currency using errcode = '22023'; end if;
  insert into public.cash_entries (account_id, direction, amount, currency, entry_date, category, description, transfer_group)
  values (p_from, 'out', p_amount, a_from.currency, coalesce(p_date, current_date), 'transfer', coalesce(nullif(trim(p_description), ''), 'Transfer to ' || a_to.name), g);
  insert into public.cash_entries (account_id, direction, amount, currency, entry_date, category, description, transfer_group)
  values (p_to, 'in', v_to, a_to.currency, coalesce(p_date, current_date), 'transfer', coalesce(nullif(trim(p_description), ''), 'Transfer from ' || a_from.name), g);
  return g;
end $$;

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
  insert into public.case_payments (case_id, amount, currency, method, reference, paid_at, notes, invoice_id, cash_account_id)
  values (cl.case_id, v_amount, cl.currency, cl.method, cl.reference, cl.paid_at,
          left('Payment notice ' || cl.notice_no || coalesce(' — ' || nullif(btrim(p_note), ''), ''), 500), cl.invoice_id, p_cash_account)
  returning id, receipt_no into v_pay, v_rc;
  perform set_config('rukn.claim', 'on', true);
  update public.case_payment_claims set status = 'accepted', payment_id = v_pay, reviewed_by = auth.uid(), reviewed_at = now(), review_note = left(nullif(btrim(p_note), ''), 300) where id = p_claim;
  perform set_config('rukn.claim', 'off', true);
  select name into v_box from public.cash_accounts where id = p_cash_account;
  insert into public.case_events (case_id, kind, body, author_id)
  values (cl.case_id, 'payment', 'Payment notice ' || cl.notice_no || ' confirmed — receipt ' || v_rc || ' · ' || v_amount || ' ' || cl.currency || coalesce(' · deposited in ' || v_box, ''), auth.uid());
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
  insert into public.case_events (case_id, kind, body, author_id) values (cl.case_id, 'payment', 'Payment notice ' || cl.notice_no || ' not accepted: ' || left(btrim(p_reason), 300), auth.uid());
end $$;

create or replace function public.cancel_payment_claim(p_claim uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare cl public.case_payment_claims%rowtype;
begin
  select * into cl from public.case_payment_claims where id = p_claim for update;
  if not found or not (public.is_finance() or public.is_case_agent(cl.case_id)) then raise exception 'Payment notice not found.' using errcode = '42501'; end if;
  if cl.status <> 'pending' then raise exception 'Only pending notices can be withdrawn.' using errcode = '22023'; end if;
  if cl.submitted_by is distinct from auth.uid() and not public.is_finance() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  perform set_config('rukn.claim', 'on', true);
  update public.case_payment_claims set status = 'cancelled', reviewed_at = now() where id = p_claim;
  perform set_config('rukn.claim', 'off', true);
  insert into public.case_events (case_id, kind, body, author_id) values (cl.case_id, 'payment', 'Payment notice ' || cl.notice_no || ' withdrawn', auth.uid());
end $$;

create or replace function public.set_claim_ai(p_claim uuid, p_status text, p_extracted jsonb, p_summary text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not (public.is_finance() or public.is_service_role()) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if p_status not in ('match', 'mismatch', 'unreadable', 'error') then raise exception 'Invalid AI status.' using errcode = '22023'; end if;
  perform set_config('rukn.claim', 'on', true);
  update public.case_payment_claims set ai_status = p_status, ai_extracted = p_extracted, ai_summary = left(p_summary, 1000), ai_checked_at = now() where id = p_claim;
  perform set_config('rukn.claim', 'off', true);
end $$;

create or replace function public.review_partner_bill(p_bill uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare b record;
begin
  if not public.is_finance() then raise exception 'Only the finance team can review bills.' using errcode = '42501'; end if;
  select * into b from public.partner_bills where id = p_bill;
  if b.id is null or b.status <> 'submitted' then raise exception 'Only bills awaiting review can be approved or rejected.' using errcode = '22023'; end if;
  if p_decision = 'approve' then
    if b.total <= 0 then raise exception 'The bill has no amount.' using errcode = '22023'; end if;
    update public.partner_bills set status = 'approved', review_note = left(nullif(btrim(p_note), ''), 300) where id = p_bill;
  elsif p_decision = 'reject' then
    if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Write the reason so the partner can correct the bill.' using errcode = '22023'; end if;
    update public.partner_bills set status = 'rejected', review_note = left(btrim(p_note), 300) where id = p_bill;
  else
    raise exception 'Unknown decision.' using errcode = '22023';
  end if;
end $$;

-- audit
drop trigger if exists case_dispatch_orders_audit on public.case_dispatch_orders;
create trigger case_dispatch_orders_audit after insert or update or delete on public.case_dispatch_orders for each row execute function public.tg_audit();
drop trigger if exists assignment_costs_audit on public.assignment_costs;
create trigger assignment_costs_audit after insert or update or delete on public.assignment_costs for each row execute function public.tg_audit();
drop trigger if exists case_finance_audit on public.case_finance;
create trigger case_finance_audit after insert or update or delete on public.case_finance for each row execute function public.tg_audit();

drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated using (
  public.is_super_admin()
  or (public.can_manage_content() and entity_type not in ('inquiries', 'inquiry_notes', 'profiles', 'user_roles', 'private_settings', 'cases', 'case_payments', 'case_files', 'case_invoices', 'case_price_items', 'cash_accounts', 'cash_entries', 'case_payment_claims', 'partners', 'case_assignments', 'partner_bills', 'partner_payments', 'case_dispatch_orders', 'assignment_costs', 'case_finance'))
  or (public.has_role('sales_manager') and entity_type in ('inquiries', 'inquiry_notes'))
  or (public.has_role('translator') and entity_type like '%translations')
  or (public.is_ops() and entity_type in ('cases', 'case_files', 'partners', 'case_assignments', 'case_dispatch_orders'))
  or (public.is_finance() and entity_type in ('cases', 'case_payments', 'case_invoices', 'case_price_items', 'cash_accounts', 'cash_entries', 'case_payment_claims', 'partner_bills', 'partner_payments', 'assignment_costs', 'case_finance', 'case_dispatch_orders')));

notify pgrst, 'reload schema';
