alter table public.service_tickets
  add column if not exists assigned_technician_id uuid references auth.users(id) on delete set null,
  add column if not exists technician_note text not null default '';

create index if not exists service_tickets_assignee_status_idx
  on public.service_tickets(branch_id, assigned_technician_id, status, created_at desc);

create or replace function private.can_work_service_ticket(_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.service_tickets t on t.id = _ticket_id
    where p.id = (select auth.uid())
      and p.organization_id = t.organization_id
      and p.branch_id = t.branch_id
      and p.role = 'technician'
      and (t.assigned_technician_id is null or t.assigned_technician_id = p.id)
  )
$$;

revoke all on function private.can_work_service_ticket(uuid) from public, anon;
grant execute on function private.can_work_service_ticket(uuid) to authenticated;
grant usage on schema private to authenticated;

drop policy if exists services_read_branch on public.service_tickets;
create policy services_read_branch on public.service_tickets
for select to authenticated
using (private.can_operate_branch(branch_id) or private.can_work_service_ticket(id));

drop policy if exists services_add_branch on public.service_tickets;
create policy services_add_branch on public.service_tickets
for insert to authenticated
with check (
  private.can_operate_branch(branch_id)
  and private.is_org_member(organization_id)
  and (
    assigned_technician_id is null
    or exists (
      select 1 from public.profiles p
      where p.id = assigned_technician_id
        and p.organization_id = service_tickets.organization_id
        and p.branch_id = service_tickets.branch_id
        and p.role = 'technician'
    )
  )
);

drop policy if exists services_update_branch on public.service_tickets;
revoke update on public.service_tickets from anon, authenticated;

drop policy if exists service_parts_read_branch on public.service_parts;
create policy service_parts_read_branch on public.service_parts
for select to authenticated
using (
  exists (
    select 1 from public.service_tickets t
    where t.id = ticket_id
      and (private.can_operate_branch(t.branch_id) or private.can_work_service_ticket(t.id))
  )
);

create or replace function private.update_customer_service(
  _ticket_id uuid,
  _status text,
  _technician_note text,
  _estimated_cost numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_ticket public.service_tickets%rowtype;
  v_technician_name text;
begin
  select role, full_name into v_role, v_technician_name
  from public.profiles where id = v_uid;
  if v_role is null then raise exception 'Akun tidak ditemukan.'; end if;

  select * into v_ticket from public.service_tickets
  where id = _ticket_id for update;
  if not found then raise exception 'Tiket servis tidak ditemukan.'; end if;
  if _estimated_cost is null or _estimated_cost < 0 then
    raise exception 'Estimasi biaya tidak valid.';
  end if;

  if v_role = 'technician' then
    if not private.can_work_service_ticket(_ticket_id) then
      raise exception 'Tiket ini bukan antrean teknisi cabang lo.';
    end if;
    if _status not in ('diagnosing','waiting_approval','waiting_parts','repairing','ready') then
      raise exception 'Status tersebut hanya dapat diubah oleh operator.';
    end if;
    if v_ticket.status in ('handed_over','cancelled') then
      raise exception 'Tiket yang sudah ditutup tidak dapat diubah.';
    end if;
    if (v_ticket.status = 'received' and _status <> 'diagnosing')
      or (v_ticket.status = 'diagnosing' and _status not in ('waiting_approval','waiting_parts','repairing'))
      or (v_ticket.status = 'waiting_approval' and _status not in ('waiting_parts','repairing'))
      or (v_ticket.status = 'waiting_parts' and _status <> 'repairing')
      or (v_ticket.status = 'repairing' and _status not in ('waiting_parts','ready'))
      or (v_ticket.status = 'ready' and _status <> 'repairing') then
      raise exception 'Urutan status pekerjaan tidak sesuai. Periksa status tiket saat ini.';
    end if;
    update public.service_tickets
    set status = _status,
        assigned_technician_id = coalesce(assigned_technician_id, v_uid),
        technician_name = v_technician_name,
        technician_note = left(btrim(coalesce(_technician_note,'')), 4000),
        estimated_cost = _estimated_cost,
        updated_at = now()
    where id = _ticket_id;
  elsif v_role in ('owner','operator') then
    if not private.can_operate_branch(v_ticket.branch_id) then
      raise exception 'Tiket servis tidak ditemukan untuk cabang ini.';
    end if;
    if _status <> 'cancelled' or v_ticket.status in ('handed_over','cancelled','ready') then
      raise exception 'Operator hanya dapat membatalkan tiket yang belum siap diserahkan.';
    end if;
    if exists (select 1 from public.service_parts where ticket_id = _ticket_id) then
      raise exception 'Tiket dengan sparepart terpakai tidak dapat dibatalkan.';
    end if;
    update public.service_tickets set status = 'cancelled', updated_at = now()
    where id = _ticket_id;
  else
    raise exception 'Role ini tidak dapat mengelola tiket servis pelanggan.';
  end if;
end;
$$;

revoke all on function private.update_customer_service(uuid,text,text,numeric) from public, anon, authenticated;
grant execute on function private.update_customer_service(uuid,text,text,numeric) to authenticated;

create or replace function public.update_customer_service(
  _ticket_id uuid,
  _status text,
  _technician_note text default '',
  _estimated_cost numeric default 0
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.update_customer_service(_ticket_id, _status, _technician_note, _estimated_cost)
$$;
revoke all on function public.update_customer_service(uuid,text,text,numeric) from public, anon, authenticated;
grant execute on function public.update_customer_service(uuid,text,text,numeric) to authenticated;

create or replace function private.use_service_part(_ticket_id uuid, _stock_item_id uuid, _quantity integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.service_tickets%rowtype;
  v_stock public.stock_items%rowtype;
  v_uid uuid := (select auth.uid());
  v_role text;
begin
  select role into v_role from public.profiles where id = v_uid;
  select * into v_ticket from public.service_tickets where id = _ticket_id for update;
  if not found then raise exception 'Tiket servis tidak ditemukan.'; end if;
  if v_role in ('owner','operator') then
    if not private.can_operate_branch(v_ticket.branch_id) then raise exception 'Tiket servis tidak ditemukan untuk cabang ini.'; end if;
  elsif v_role = 'technician' then
    if not private.can_work_service_ticket(_ticket_id) or v_ticket.status <> 'repairing' then
      raise exception 'Sparepart hanya dapat dicatat oleh teknisi yang mengerjakan tiket.';
    end if;
  else
    raise exception 'Role ini tidak dapat memakai sparepart servis.';
  end if;
  if v_ticket.status in ('handed_over','cancelled') then raise exception 'Tiket sudah ditutup.'; end if;
  if _quantity is null or _quantity < 1 then raise exception 'Jumlah sparepart tidak valid.'; end if;

  select * into v_stock from public.stock_items
  where id = _stock_item_id and branch_id = v_ticket.branch_id
    and status = 'available' and quantity >= _quantity for update;
  if not found then raise exception 'Stok sparepart tidak cukup di cabang tiket.'; end if;

  update public.stock_items
  set quantity = quantity - _quantity,
      status = case when quantity - _quantity = 0 then 'used_for_service' else status end
  where id = v_stock.id;
  insert into public.service_parts(organization_id, ticket_id, stock_item_id, product_name, quantity, cost, created_by)
  select v_ticket.organization_id, _ticket_id, v_stock.id, p.name, _quantity,
         v_stock.acquisition_cost * _quantity, v_uid
  from public.products p where p.id = v_stock.product_id;
  insert into public.stock_movements(organization_id, branch_id, product_id, stock_item_id, movement_type, quantity, reference, created_by)
  values(v_ticket.organization_id, v_ticket.branch_id, v_stock.product_id, v_stock.id, 'service_use', -_quantity, v_ticket.ticket_number, v_uid);
  update public.service_tickets set updated_at = now() where id = _ticket_id;
end;
$$;
revoke all on function private.use_service_part(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function private.use_service_part(uuid,uuid,integer) to authenticated;

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
  if v_org is null or not private.can_operate_branch(v_branch) then raise exception 'Tiket servis tidak ditemukan untuk cabang ini.'; end if;
  if v_status <> 'ready' then raise exception 'Teknisi harus menandai tiket siap diambil sebelum serah terima.'; end if;
  if _final_cost is null or _final_cost < 0 or _paid_amount is null or _paid_amount < 0 or _paid_amount > _final_cost then
    raise exception 'Biaya dan pembayaran servis tidak valid.';
  end if;
  if _paid_amount < _final_cost and _due_date is null then raise exception 'Tanggal jatuh tempo wajib untuk piutang servis.'; end if;
  if _handover_photo_path !~ ('^' || v_org::text || '/' || v_branch::text || '/' || _ticket_id::text || '/handover[.]jpg$') then
    raise exception 'Lokasi foto serah terima tidak sesuai tiket.';
  end if;
  update public.service_tickets
  set status = 'handed_over', final_cost = _final_cost, paid_amount = _paid_amount,
      due_date = case when _paid_amount < _final_cost then _due_date else null end,
      handover_photo_path = _handover_photo_path, updated_at = now()
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

drop policy if exists service_evidence_read_member on storage.objects;
create policy service_evidence_read_member on storage.objects
for select to authenticated
using (
  bucket_id = 'service-evidence'
  and (storage.foldername(name))[1] = (select p.organization_id::text from public.profiles p where p.id = (select auth.uid()))
  and (
    private.can_operate_branch(((storage.foldername(name))[2])::uuid)
    or (
      (storage.foldername(name))[2] = (select p.branch_id::text from public.profiles p where p.id = (select auth.uid()))
      and private.can_work_service_ticket(((storage.foldername(name))[3])::uuid)
    )
  )
);
