alter table public.service_tickets
  add column if not exists handed_over_at timestamptz;

update public.service_tickets
set handed_over_at = updated_at
where status = 'handed_over' and handed_over_at is null;

create or replace function private.complete_service_handover(
  _ticket_id uuid, _final_cost numeric, _paid_amount numeric, _due_date date, _handover_photo_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_branch uuid;
  v_number text;
  v_customer text;
  v_status text;
begin
  select organization_id, branch_id, ticket_number, customer_name, status
  into v_org, v_branch, v_number, v_customer, v_status
  from public.service_tickets where id = _ticket_id for update;
  if v_org is null or not private.can_operate_branch(v_branch) then
    raise exception 'Tiket servis tidak ditemukan untuk cabang ini.';
  end if;
  if v_status <> 'ready' then
    raise exception 'Teknisi harus menandai tiket siap diambil sebelum serah terima.';
  end if;
  if _final_cost is null or _final_cost < 0 or _paid_amount is null or _paid_amount < 0 or _paid_amount > _final_cost then
    raise exception 'Biaya dan pembayaran servis tidak valid.';
  end if;
  if _paid_amount < _final_cost and _due_date is null then
    raise exception 'Tanggal jatuh tempo wajib untuk piutang servis.';
  end if;
  if _handover_photo_path !~ ('^' || v_org::text || '/' || v_branch::text || '/' || _ticket_id::text || '/handover[.]jpg$') then
    raise exception 'Lokasi foto serah terima tidak sesuai tiket.';
  end if;

  update public.service_tickets
  set status = 'handed_over', final_cost = _final_cost, paid_amount = _paid_amount,
      due_date = case when _paid_amount < _final_cost then _due_date else null end,
      handover_photo_path = _handover_photo_path, handed_over_at = now(), updated_at = now()
  where id = _ticket_id;
  if _paid_amount > 0 then
    insert into public.cash_transactions(organization_id, branch_id, direction, category, amount, description, source_type, source_id, created_by)
    values(v_org, v_branch, 'income', 'Penerimaan servis', _paid_amount,
      'Pembayaran servis ' || v_number || ' · ' || v_customer, 'service_ticket', _ticket_id, v_uid);
  end if;
end;
$$;

revoke all on function private.complete_service_handover(uuid,numeric,numeric,date,text) from public, anon, authenticated;
grant execute on function private.complete_service_handover(uuid,numeric,numeric,date,text) to authenticated;
