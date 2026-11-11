-- Separate receiving and technician work while keeping every unit in shared branch stock.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('owner','operator','technician'));
alter table public.team_invites add column if not exists role text not null default 'operator';
alter table public.team_invites drop constraint if exists team_invites_role_check;
alter table public.team_invites add constraint team_invites_role_check check (role in ('operator','technician'));

create table if not exists public.intake_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  product_id uuid not null references public.products(id),
  supplier text not null default '',
  unit_count integer not null check (unit_count > 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.stock_items add column if not exists intake_batch_id uuid references public.intake_batches(id);
alter table public.stock_items add column if not exists qc_stage text not null default 'initial';
alter table public.stock_items add column if not exists qc_notes text not null default '';
alter table public.stock_items add column if not exists qc_by uuid references auth.users(id);
alter table public.stock_items add column if not exists qc_at timestamptz;
alter table public.stock_items drop constraint if exists stock_items_status_check;
alter table public.stock_items add constraint stock_items_status_check check (status in ('pending_qc','repair_needed','repairing','waiting_parts','available','not_sellable','sold','used_for_service','transferred'));
alter table public.stock_items drop constraint if exists stock_items_qc_stage_check;
alter table public.stock_items add constraint stock_items_qc_stage_check check (qc_stage in ('initial','final'));

create table if not exists public.stock_repairs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  stock_item_id uuid not null references public.stock_items(id) on delete cascade,
  issue text not null,
  status text not null default 'repair_needed' check (status in ('repair_needed','repairing','waiting_parts','pending_final_qc','completed','not_sellable')),
  resolution text not null default '',
  technician_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stock_repair_parts (
  id uuid primary key default gen_random_uuid(),
  repair_id uuid not null references public.stock_repairs(id) on delete cascade,
  stock_item_id uuid not null references public.stock_items(id),
  product_name text not null,
  quantity integer not null check (quantity > 0),
  cost numeric(14,2) not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists intake_batches_branch_date_idx on public.intake_batches(branch_id, created_at desc);
create index if not exists stock_items_qc_queue_idx on public.stock_items(branch_id, status, created_at desc);
create index if not exists stock_repairs_item_idx on public.stock_repairs(stock_item_id, created_at desc);

create or replace function public.accept_operator_invite()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_invite public.team_invites%rowtype;
begin
  select * into v_invite from public.team_invites where lower(email) = lower(new.email) order by created_at limit 1;
  if found then
    insert into public.profiles(id, organization_id, branch_id, full_name, role)
    values (new.id, v_invite.organization_id, v_invite.branch_id,
      coalesce(nullif(trim(v_invite.full_name), ''), coalesce(new.raw_user_meta_data->>'full_name', 'Operator')), v_invite.role);
    delete from public.team_invites where id = v_invite.id;
  end if;
  return new;
end;
$$;

create or replace function private.receive_stock_batch(_branch_id uuid, _product_id uuid, _supplier text, _quantity integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid; v_batch uuid := gen_random_uuid(); v_i integer; v_barcode text; v_qc_required boolean;
begin
  select organization_id into v_org from public.profiles where id = v_uid and role in ('owner','operator');
  if v_org is null then raise exception 'Penerimaan barang hanya dapat dicatat pemilik atau operator.'; end if;
  if not exists (select 1 from public.branches where id = _branch_id and organization_id = v_org) then raise exception 'Cabang tidak ditemukan.'; end if;
  if not exists (select 1 from public.products where id = _product_id and organization_id = v_org) then raise exception 'Produk tidak ditemukan.'; end if;
  if _quantity is null or _quantity < 1 or _quantity > 500 then raise exception 'Jumlah penerimaan harus 1 sampai 500 unit.'; end if;
  select category = 'Laptop' into v_qc_required from public.products where id = _product_id and organization_id = v_org;
  insert into public.intake_batches(id, organization_id, branch_id, product_id, supplier, unit_count, created_by)
    values(v_batch, v_org, _branch_id, _product_id, coalesce(trim(_supplier),''), _quantity, v_uid);
  for v_i in 1.._quantity loop
    v_barcode := 'DL-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
    insert into public.stock_items(organization_id, branch_id, product_id, barcode, supplier, quantity, status, intake_batch_id, qc_stage, created_by)
      values(v_org, _branch_id, _product_id, v_barcode, coalesce(trim(_supplier),''), 1, case when v_qc_required then 'pending_qc' else 'available' end, v_batch, 'initial', v_uid);
    insert into public.stock_movements(organization_id, branch_id, product_id, stock_item_id, movement_type, quantity, reference, note, created_by)
      select v_org, _branch_id, _product_id, id, 'receive', 1, v_barcode, 'Batch ' || v_batch::text, v_uid from public.stock_items where organization_id = v_org and barcode = v_barcode;
  end loop;
  return v_batch;
end;
$$;
revoke all on function private.receive_stock_batch(uuid,uuid,text,integer) from public, anon;
grant execute on function private.receive_stock_batch(uuid,uuid,text,integer) to authenticated;
create or replace function public.receive_stock_batch(_branch_id uuid, _product_id uuid, _supplier text, _quantity integer)
returns uuid language sql security invoker set search_path = '' as $$ select private.receive_stock_batch(_branch_id,_product_id,_supplier,_quantity) $$;
revoke all on function public.receive_stock_batch(uuid,uuid,text,integer) from public, anon;
grant execute on function public.receive_stock_batch(uuid,uuid,text,integer) to authenticated;
revoke execute on function public.receive_stock(uuid,uuid,text,jsonb) from public, anon, authenticated;
revoke execute on function private.receive_stock(uuid,uuid,text,jsonb) from public, anon, authenticated;

create or replace function private.decide_stock_qc(_stock_item_id uuid, _decision text, _notes text, _serial_number text default null, _supplier_barcode text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_stock public.stock_items%rowtype; v_role text;
begin
  select role into v_role from public.profiles where id = v_uid;
  select * into v_stock from public.stock_items where id = _stock_item_id for update;
  if not found or not private.can_access_branch(v_stock.branch_id) or v_role not in ('owner','technician') then raise exception 'Tidak punya akses teknisi ke unit ini.'; end if;
  if v_stock.status <> 'pending_qc' then raise exception 'Unit ini tidak sedang menunggu QC.'; end if;
  if v_stock.qc_stage = 'initial' and _decision not in ('available','repair_needed','not_sellable') then raise exception 'Keputusan QC awal tidak valid.'; end if;
  if v_stock.qc_stage = 'final' and _decision not in ('available','repair_needed','not_sellable') then raise exception 'Keputusan QC akhir tidak valid.'; end if;
  update public.stock_items set status = _decision, qc_notes = coalesce(trim(_notes),''), qc_by = v_uid, qc_at = now(),
    serial_number = coalesce(nullif(trim(_serial_number),''),serial_number), supplier_barcode = coalesce(nullif(trim(_supplier_barcode),''),supplier_barcode)
    where id = _stock_item_id;
  if _decision = 'repair_needed' then
    if v_stock.qc_stage = 'final' then
      update public.stock_repairs set status = 'repair_needed', issue = coalesce(nullif(trim(_notes),''),'Perlu pemeriksaan lanjutan.'), resolution = '', technician_id = v_uid, updated_at = now()
        where stock_item_id = _stock_item_id and status = 'pending_final_qc';
    else
      insert into public.stock_repairs(organization_id, branch_id, stock_item_id, issue, technician_id)
        values(v_stock.organization_id, v_stock.branch_id, v_stock.id, coalesce(nullif(trim(_notes),''),'Perlu pemeriksaan teknisi.'), v_uid);
    end if;
  elsif v_stock.qc_stage = 'final' and _decision = 'available' then
    update public.stock_repairs set status = 'completed', resolution = coalesce(nullif(trim(_notes),''),resolution), technician_id = v_uid, updated_at = now()
      where stock_item_id = _stock_item_id and status = 'pending_final_qc';
  elsif v_stock.qc_stage = 'final' and _decision = 'not_sellable' then
    update public.stock_repairs set status = 'not_sellable', resolution = coalesce(nullif(trim(_notes),''),resolution), technician_id = v_uid, updated_at = now()
      where stock_item_id = _stock_item_id and status = 'pending_final_qc';
  end if;
end;
$$;
revoke all on function private.decide_stock_qc(uuid,text,text,text,text) from public, anon;
grant execute on function private.decide_stock_qc(uuid,text,text,text,text) to authenticated;
create or replace function public.decide_stock_qc(_stock_item_id uuid, _decision text, _notes text, _serial_number text default null, _supplier_barcode text default null)
returns void language sql security invoker set search_path = '' as $$ select private.decide_stock_qc(_stock_item_id,_decision,_notes,_serial_number,_supplier_barcode) $$;
revoke all on function public.decide_stock_qc(uuid,text,text,text,text) from public, anon;
grant execute on function public.decide_stock_qc(uuid,text,text,text,text) to authenticated;

create or replace function private.update_stock_repair(_repair_id uuid, _status text, _resolution text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_job public.stock_repairs%rowtype; v_role text;
begin
  select role into v_role from public.profiles where id = v_uid;
  select * into v_job from public.stock_repairs where id = _repair_id for update;
  if not found or not private.can_access_branch(v_job.branch_id) or v_role not in ('owner','technician') then raise exception 'Tidak punya akses teknisi ke pekerjaan ini.'; end if;
  if _status not in ('repairing','waiting_parts','pending_final_qc') then raise exception 'Status repair tidak valid.'; end if;
  update public.stock_repairs set status = _status, resolution = coalesce(trim(_resolution),''), technician_id = v_uid, updated_at = now() where id = _repair_id;
  update public.stock_items set status = case when _status = 'pending_final_qc' then 'pending_qc' else _status end,
    qc_stage = case when _status = 'pending_final_qc' then 'final' else qc_stage end where id = v_job.stock_item_id;
end;
$$;
revoke all on function private.update_stock_repair(uuid,text,text) from public, anon;
grant execute on function private.update_stock_repair(uuid,text,text) to authenticated;
create or replace function public.update_stock_repair(_repair_id uuid, _status text, _resolution text default '')
returns void language sql security invoker set search_path = '' as $$ select private.update_stock_repair(_repair_id,_status,_resolution) $$;
revoke all on function public.update_stock_repair(uuid,text,text) from public, anon;
grant execute on function public.update_stock_repair(uuid,text,text) to authenticated;

create or replace function private.use_stock_repair_part(_repair_id uuid, _part_stock_item_id uuid, _quantity integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_job public.stock_repairs%rowtype; v_part public.stock_items%rowtype; v_role text; v_name text; v_cost numeric;
begin
  select role into v_role from public.profiles where id = v_uid;
  select * into v_job from public.stock_repairs where id = _repair_id for update;
  if not found or not private.can_access_branch(v_job.branch_id) or v_role not in ('owner','technician') then raise exception 'Tidak punya akses teknisi ke pekerjaan ini.'; end if;
  if v_job.status not in ('repair_needed','repairing','waiting_parts') then raise exception 'Pekerjaan ini tidak menerima sparepart.'; end if;
  select * into v_part from public.stock_items where id = _part_stock_item_id and branch_id = v_job.branch_id and status = 'available' and quantity >= _quantity for update;
  if not found or _quantity < 1 then raise exception 'Stok sparepart tidak cukup di cabang ini.'; end if;
  select p.name,p.cost_price into v_name,v_cost from public.products p where p.id = v_part.product_id and p.category in ('Sparepart','Aksesori','Lainnya');
  if not found then raise exception 'Pilih barang kategori sparepart atau aksesori.'; end if;
  update public.stock_items set quantity = quantity - _quantity, status = case when quantity - _quantity = 0 then 'used_for_service' else status end where id = v_part.id;
  insert into public.stock_repair_parts(repair_id,stock_item_id,product_name,quantity,cost,created_by) values(_repair_id,v_part.id,v_name,_quantity,v_cost*_quantity,v_uid);
  insert into public.stock_movements(organization_id,branch_id,product_id,stock_item_id,movement_type,quantity,reference,note,created_by)
    values(v_job.organization_id,v_job.branch_id,v_part.product_id,v_part.id,'service_use',-_quantity,'Repair '||v_job.id::text,'Sparepart untuk unit '||v_job.stock_item_id::text,v_uid);
end;
$$;
revoke all on function private.use_stock_repair_part(uuid,uuid,integer) from public, anon;
grant execute on function private.use_stock_repair_part(uuid,uuid,integer) to authenticated;
create or replace function public.use_stock_repair_part(_repair_id uuid, _part_stock_item_id uuid, _quantity integer)
returns void language sql security invoker set search_path = '' as $$ select private.use_stock_repair_part(_repair_id,_part_stock_item_id,_quantity) $$;
revoke all on function public.use_stock_repair_part(uuid,uuid,integer) from public, anon;
grant execute on function public.use_stock_repair_part(uuid,uuid,integer) to authenticated;

alter table public.intake_batches enable row level security;
alter table public.stock_repairs enable row level security;
alter table public.stock_repair_parts enable row level security;
grant select on public.intake_batches, public.stock_repairs, public.stock_repair_parts to authenticated;
drop policy if exists intake_batches_read_branch on public.intake_batches;
create policy intake_batches_read_branch on public.intake_batches for select to authenticated using (private.can_access_branch(branch_id));
drop policy if exists stock_repairs_read_branch on public.stock_repairs;
create policy stock_repairs_read_branch on public.stock_repairs for select to authenticated using (private.can_access_branch(branch_id));
drop policy if exists stock_repair_parts_read_branch on public.stock_repair_parts;
create policy stock_repair_parts_read_branch on public.stock_repair_parts for select to authenticated using (exists(select 1 from public.stock_repairs r where r.id = repair_id and private.can_access_branch(r.branch_id)));

