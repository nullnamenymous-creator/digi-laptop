alter table public.service_tickets
  add column if not exists customer_id uuid references public.customers(id) on delete set null;

create index if not exists service_tickets_customer_branch_idx
  on public.service_tickets(customer_id, branch_id, created_at desc);

-- Link only existing tickets whose normalized name maps to one contact in the organization.
update public.service_tickets t
set customer_id = c.id
from public.customers c
where t.customer_id is null
  and c.organization_id = t.organization_id
  and lower(btrim(c.name)) = lower(btrim(t.customer_name))
  and (
    select count(*)
    from public.customers c2
    where c2.organization_id = t.organization_id
      and lower(btrim(c2.name)) = lower(btrim(t.customer_name))
  ) = 1;

create or replace function private.validate_service_ticket_customer_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.customer_id is not null and not exists (
    select 1 from public.customers c
    where c.id = new.customer_id and c.organization_id = new.organization_id
  ) then
    raise exception 'Pelanggan harus berasal dari organisasi toko yang sama.';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_service_ticket_customer_scope() from public, anon, authenticated;

drop trigger if exists service_tickets_customer_scope on public.service_tickets;
create trigger service_tickets_customer_scope
before insert or update of customer_id, organization_id on public.service_tickets
for each row execute function private.validate_service_ticket_customer_scope();

create or replace function private.create_customer_service_ticket(
  _ticket_id uuid,
  _branch_id uuid,
  _ticket_number text,
  _customer_id uuid,
  _customer_name text,
  _customer_phone text,
  _device_name text,
  _serial_number text,
  _complaint text,
  _estimated_cost numeric,
  _assigned_technician_id uuid,
  _intake_photo_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_role text;
  v_customer_id uuid := _customer_id;
  v_customer_name text;
  v_customer_phone text;
begin
  select organization_id, role into v_org, v_role
  from public.profiles where id = v_uid;
  if v_org is null or v_role not in ('owner','operator') then
    raise exception 'Hanya pemilik atau operator yang dapat menerima servis pelanggan.';
  end if;
  if not private.can_operate_branch(_branch_id) or not exists (
    select 1 from public.branches b where b.id = _branch_id and b.organization_id = v_org and b.is_active
  ) then
    raise exception 'Cabang tidak aktif atau bukan cabang toko ini.';
  end if;
  if _ticket_id is null or nullif(btrim(coalesce(_ticket_number,'')), '') is null then
    raise exception 'Nomor tiket tidak valid.';
  end if;
  if nullif(btrim(coalesce(_device_name,'')), '') is null
     or nullif(btrim(coalesce(_complaint,'')), '') is null then
    raise exception 'Unit dan keluhan pelanggan wajib diisi.';
  end if;
  if _estimated_cost is null or _estimated_cost < 0 then
    raise exception 'Estimasi biaya servis tidak valid.';
  end if;
  if _intake_photo_path !~ ('^' || v_org::text || '/' || _branch_id::text || '/' || _ticket_id::text || '/intake[.]jpg$') then
    raise exception 'Lokasi foto kondisi awal tidak sesuai tiket.';
  end if;
  if _assigned_technician_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = _assigned_technician_id
      and p.organization_id = v_org and p.branch_id = _branch_id and p.role = 'technician'
  ) then
    raise exception 'Teknisi harus berasal dari cabang tiket ini.';
  end if;

  if v_customer_id is null then
    v_customer_name := left(btrim(coalesce(_customer_name,'')), 160);
    v_customer_phone := left(btrim(coalesce(_customer_phone,'')), 40);
    if v_customer_name = '' then raise exception 'Nama pelanggan wajib diisi.'; end if;
    insert into public.customers(organization_id, name, phone, customer_type)
    values(v_org, v_customer_name, v_customer_phone, 'end_user')
    returning id into v_customer_id;
  else
    select c.name, c.phone into v_customer_name, v_customer_phone
    from public.customers c where c.id = v_customer_id and c.organization_id = v_org;
    if not found then raise exception 'Pelanggan tidak ditemukan di data toko.'; end if;
  end if;

  insert into public.service_tickets(
    id, organization_id, branch_id, ticket_number, customer_id, customer_name, customer_phone,
    device_name, serial_number, complaint, estimated_cost, assigned_technician_id,
    technician_name, created_by, intake_photo_path
  )
  values(
    _ticket_id, v_org, _branch_id, left(btrim(_ticket_number), 60), v_customer_id,
    v_customer_name, v_customer_phone, left(btrim(_device_name), 160),
    left(btrim(coalesce(_serial_number,'')), 120), left(btrim(_complaint), 4000),
    _estimated_cost, _assigned_technician_id,
    coalesce((select p.full_name from public.profiles p where p.id = _assigned_technician_id), ''),
    v_uid, _intake_photo_path
  );
  return _ticket_id;
end;
$$;
revoke all on function private.create_customer_service_ticket(uuid,uuid,text,uuid,text,text,text,text,text,numeric,uuid,text) from public, anon, authenticated;
grant execute on function private.create_customer_service_ticket(uuid,uuid,text,uuid,text,text,text,text,text,numeric,uuid,text) to authenticated;

create or replace function public.create_customer_service_ticket(
  _ticket_id uuid,
  _branch_id uuid,
  _ticket_number text,
  _customer_id uuid,
  _customer_name text,
  _customer_phone text,
  _device_name text,
  _serial_number text,
  _complaint text,
  _estimated_cost numeric,
  _assigned_technician_id uuid,
  _intake_photo_path text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_customer_service_ticket(
    _ticket_id, _branch_id, _ticket_number, _customer_id, _customer_name, _customer_phone,
    _device_name, _serial_number, _complaint, _estimated_cost, _assigned_technician_id, _intake_photo_path
  )
$$;
revoke all on function public.create_customer_service_ticket(uuid,uuid,text,uuid,text,text,text,text,text,numeric,uuid,text) from public, anon, authenticated;
grant execute on function public.create_customer_service_ticket(uuid,uuid,text,uuid,text,text,text,text,text,numeric,uuid,text) to authenticated;
