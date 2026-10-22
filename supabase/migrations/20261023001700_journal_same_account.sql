-- =====================================================================
-- RUKN — Journal entries: the same account may be on both sides when the
-- currencies differ (moving a balance of one agent / partner / account from
-- one currency to another, e.g. USD → EGP at the exchange rate).
-- Safe to run more than once.
-- =====================================================================
create or replace function public.tg_journal_entries_before()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare inv record; bl record; v_auto numeric; side text; v_agent uuid; v_partner uuid; v_inv uuid; v_bill uuid; v_cur text;
begin
  if tg_op = 'UPDATE' then
    if old.voided then raise exception 'A voided entry cannot be changed.' using errcode = '42501'; end if;
    if (to_jsonb(new) - 'voided' - 'void_reason') is distinct from (to_jsonb(old) - 'voided' - 'void_reason') then
      raise exception 'Journal entries cannot be edited — void it and make a new one.' using errcode = '42501';
    end if;
    if new.voided and nullif(trim(coalesce(new.void_reason, '')), '') is null then
      raise exception 'Write the reason for voiding.' using errcode = '22023';
    end if;
    return new;
  end if;

  -- The same account on both sides is allowed only to convert its balance between two currencies.
  if (new.dr_type = new.cr_type) and coalesce(new.dr_agent_id, new.dr_partner_id, new.dr_ledger_id) = coalesce(new.cr_agent_id, new.cr_partner_id, new.cr_ledger_id)
     and new.dr_currency = new.cr_currency then
    raise exception 'The same account on both sides is only allowed with two different currencies.' using errcode = '22023';
  end if;

  foreach side in array array['dr', 'cr'] loop
    if side = 'dr' then v_agent := new.dr_agent_id; v_partner := new.dr_partner_id; v_inv := new.dr_invoice_id; v_bill := new.dr_bill_id; v_cur := new.dr_currency;
    else v_agent := new.cr_agent_id; v_partner := new.cr_partner_id; v_inv := new.cr_invoice_id; v_bill := new.cr_bill_id; v_cur := new.cr_currency; end if;
    if v_agent is not null and not exists (select 1 from public.user_roles where user_id = v_agent and role::text = 'agent') then
      raise exception 'Choose an agent.' using errcode = '22023';
    end if;
    if v_inv is not null then
      select i.status, i.currency, c.agent_id into inv from public.case_invoices i join public.cases c on c.id = i.case_id where i.id = v_inv;
      if inv.status is distinct from 'issued' then raise exception 'Link only to an issued invoice.' using errcode = '22023'; end if;
      if inv.agent_id <> v_agent then raise exception 'The invoice is not on a case of this agent.' using errcode = '22023'; end if;
      if inv.currency <> v_cur then raise exception 'Invoice is in %; that side must be in %.', inv.currency, inv.currency using errcode = '22023'; end if;
    end if;
    if v_bill is not null then
      select status, currency, partner_id into bl from public.partner_bills where id = v_bill;
      if bl.status is distinct from 'approved' then raise exception 'Link only to an approved bill.' using errcode = '22023'; end if;
      if bl.partner_id <> v_partner then raise exception 'The bill belongs to another partner.' using errcode = '22023'; end if;
      if bl.currency <> v_cur then raise exception 'Bill is in %; that side must be in %.', bl.currency, bl.currency using errcode = '22023'; end if;
    end if;
  end loop;

  -- Currencies: same → same amount; different → amount from the given amount, the given rate or the automatic rate
  if new.dr_currency = new.cr_currency then
    new.cr_amount := new.dr_amount; new.fx_rate := null; new.fx_source := null;
  else
    v_auto := public.fx_rate(new.dr_currency, new.cr_currency);
    if new.cr_amount is not null then new.fx_rate := new.cr_amount / new.dr_amount;
    elsif new.fx_rate is not null then new.cr_amount := round(new.dr_amount * new.fx_rate, 2);
    elsif v_auto is not null then new.fx_rate := v_auto; new.cr_amount := round(new.dr_amount * v_auto, 2);
    else raise exception 'No exchange rate between % and %: enter the rate or the credit amount.', new.dr_currency, new.cr_currency using errcode = '22023';
    end if;
    new.fx_source := case when v_auto is not null and round(new.fx_rate, 6) = round(v_auto, 6) then 'auto' else 'manual' end;
  end if;

  new.voided := false; new.void_reason := null;
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.entry_no := 'JV-' || to_char(now(), 'YY') || '-' || lpad(public.next_doc_no('journal')::text, 5, '0');
  return new;
end $$;

notify pgrst, 'reload schema';
