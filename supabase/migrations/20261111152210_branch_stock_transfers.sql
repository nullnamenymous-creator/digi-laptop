create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  transfer_number text not null,
  source_branch_id uuid not null references public.branches(id),
  destination_branch_id uuid not null references public.branches(id),
  status text not null default 'in_transit' check (status in ('in_transit','received')),
  note text not null default '',
  created_by uuid references auth.users(id),
  received_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  shipped_at timestamptz not null default now(),
  received_at timestamptz,
  unique (organization_id, transfer_number),
  check (source_branch_id <> destination_branch_id),
  check ((status = 'in_transit' and received_at is null and received_by is null)
      or (status = 'received' and received_at is not null and received_by is not null))
);

create table if not exists public.stock_transfer_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  transfer_id uuid not null references public.stock_transfers(id),
  product_id uuid not null references public.products(id),
  source_stock_item_id uuid not null references public.stock_items(id),
  received_stock_item_id uuid references public.stock_items(id),
  source_barcode text not null,
  target_barcode text,
  quantity integer not null check (quantity > 0),
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  split_lot boolean not null default false,
  created_at timestamptz not null default now(),
  unique (transfer_id, source_stock_item_id)
);

create index if not exists stock_transfers_source_created_idx
  on public.stock_transfers(source_branch_id, created_at desc);
create index if not exists stock_transfers_destination_created_idx
  on public.stock_transfers(destination_branch_id, created_at desc);
create index if not exists stock_transfer_items_transfer_idx
  on public.stock_transfer_items(transfer_id, created_at);
create index if not exists stock_transfer_items_source_stock_idx
  on public.stock_transfer_items(source_stock_item_id);

alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_items enable row level security;
revoke all on public.stock_transfers, public.stock_transfer_items from anon, authenticated;
grant select on public.stock_transfers, public.stock_transfer_items to authenticated;

drop policy if exists stock_transfers_read_member on public.stock_transfers;
create policy stock_transfers_read_member on public.stock_transfers
for select to authenticated
using (
  private.is_owner(organization_id)
  or private.can_operate_branch(source_branch_id)
  or private.can_operate_branch(destination_branch_id)
);

drop policy if exists stock_transfer_items_read_member on public.stock_transfer_items;
create policy stock_transfer_items_read_member on public.stock_transfer_items
for select to authenticated
using (
  exists (
    select 1 from public.stock_transfers t
    where t.id = transfer_id
      and (
        private.is_owner(t.organization_id)
        or private.can_operate_branch(t.source_branch_id)
        or private.can_operate_branch(t.destination_branch_id)
      )
  )
);

create or replace function private.create_stock_transfer(
  _source_branch_id uuid,
  _destination_branch_id uuid,
  _items jsonb,
  _note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_role text;
  v_transfer_id uuid := gen_random_uuid();
  v_transfer_number text := 'MUT-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  v_line jsonb;
  v_stock public.stock_items%rowtype;
  v_product_category text;
  v_quantity integer;
  v_split boolean;
  v_count integer := 0;
  v_note text := left(btrim(coalesce(_note, '')), 1000);
begin
  select organization_id, role into v_org, v_role from public.profiles where id = v_uid;
  if v_org is null or v_role not in ('owner','operator') then
    raise exception 'Hanya pemilik atau operator yang dapat mengirim mutasi stok.';
  end if;
  if _source_branch_id is null or _destination_branch_id is null or _source_branch_id = _destination_branch_id then
    raise exception 'Pilih dua cabang yang berbeda.';
  end if;
  if not exists(select 1 from public.branches b where b.id = _source_branch_id and b.organization_id = v_org and b.is_active)
     or not exists(select 1 from public.branches b where b.id = _destination_branch_id and b.organization_id = v_org and b.is_active) then
    raise exception 'Cabang asal atau tujuan tidak aktif atau bukan milik toko ini.';
  end if;
  if v_role = 'operator' and not private.can_operate_branch(_source_branch_id) then
    raise exception 'Operator hanya dapat mengirim stok dari cabangnya sendiri.';
  end if;
  if _items is null or jsonb_typeof(_items) <> 'array' then
    raise exception 'Pilih 1 sampai 100 baris stok untuk dikirim.';
  end if;
  if jsonb_array_length(_items) < 1 or jsonb_array_length(_items) > 100 then
    raise exception 'Pilih 1 sampai 100 baris stok untuk dikirim.';
  end if;

  insert into public.stock_transfers(id, organization_id, transfer_number, source_branch_id, destination_branch_id, note, created_by)
  values(v_transfer_id, v_org, v_transfer_number, _source_branch_id, _destination_branch_id, v_note, v_uid);

  for v_line in select value from jsonb_array_elements(_items)
  loop
    if nullif(v_line->>'stock_item_id', '') is null or coalesce(v_line->>'quantity', '') !~ '^[0-9]+$' then
      raise exception 'Baris stok mutasi tidak valid.';
    end if;
    v_quantity := (v_line->>'quantity')::integer;
    if v_quantity < 1 then raise exception 'Jumlah mutasi minimal satu.'; end if;

    select si.* into v_stock
    from public.stock_items si
    join public.products p on p.id = si.product_id and p.organization_id = v_org
    where si.id = (v_line->>'stock_item_id')::uuid
      and si.organization_id = v_org and si.branch_id = _source_branch_id
      and si.status = 'available' and si.quantity >= v_quantity
    for update of si;
    if not found then raise exception 'Stok berubah atau jumlahnya tidak cukup. Muat ulang daftar stok.'; end if;
    select p.category into v_product_category from public.products p where p.id = v_stock.product_id;
    if lower(v_product_category) = 'laptop' and (v_quantity <> 1 or v_stock.quantity <> 1) then
      raise exception 'Laptop dimutasi satu unit per barcode.';
    end if;
    v_split := lower(v_product_category) <> 'laptop' and v_quantity < v_stock.quantity;

    insert into public.stock_transfer_items(
      organization_id, transfer_id, product_id, source_stock_item_id,
      source_barcode, quantity, unit_cost, split_lot
    ) values(
      v_org, v_transfer_id, v_stock.product_id, v_stock.id,
      v_stock.barcode, v_quantity, v_stock.acquisition_cost, v_split
    );

    update public.stock_items
    set quantity = case when lower(v_product_category) = 'laptop' or v_quantity = v_stock.quantity then 0 else quantity - v_quantity end,
        status = case when lower(v_product_category) = 'laptop' or v_quantity = v_stock.quantity then 'transferred' else status end
    where id = v_stock.id;

    insert into public.stock_movements(organization_id, branch_id, product_id, stock_item_id, movement_type, quantity, reference, note, created_by)
    values(v_org, _source_branch_id, v_stock.product_id, v_stock.id, 'transfer_out', -v_quantity,
      v_transfer_number, 'Mutasi ke ' || (select b.name from public.branches b where b.id = _destination_branch_id), v_uid);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('id', v_transfer_id, 'transfer_number', v_transfer_number, 'item_count', v_count, 'status', 'in_transit');
end;
$$;
revoke all on function private.create_stock_transfer(uuid,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function private.create_stock_transfer(uuid,uuid,jsonb,text) to authenticated;

create or replace function public.create_stock_transfer(
  _source_branch_id uuid,
  _destination_branch_id uuid,
  _items jsonb,
  _note text default ''
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.create_stock_transfer(_source_branch_id, _destination_branch_id, _items, _note) $$;
revoke all on function public.create_stock_transfer(uuid,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.create_stock_transfer(uuid,uuid,jsonb,text) to authenticated;

create or replace function private.receive_stock_transfer(_transfer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_role text;
  v_transfer public.stock_transfers%rowtype;
  v_item public.stock_transfer_items%rowtype;
  v_source public.stock_items%rowtype;
  v_target_id uuid;
  v_target_barcode text;
  v_count integer := 0;
  v_result jsonb := '[]'::jsonb;
begin
  select organization_id, role into v_org, v_role from public.profiles where id = v_uid;
  if v_org is null or v_role not in ('owner','operator') then
    raise exception 'Hanya pemilik atau operator yang dapat menerima mutasi stok.';
  end if;
  select * into v_transfer from public.stock_transfers where id = _transfer_id and organization_id = v_org for update;
  if not found then raise exception 'Mutasi tidak ditemukan.'; end if;
  if v_transfer.status <> 'in_transit' then raise exception 'Mutasi ini sudah pernah diterima.'; end if;
  if v_role = 'operator' and not private.can_operate_branch(v_transfer.destination_branch_id) then
    raise exception 'Operator hanya dapat menerima mutasi untuk cabangnya sendiri.';
  end if;

  for v_item in select * from public.stock_transfer_items where transfer_id = v_transfer.id order by created_at for update
  loop
    select * into v_source from public.stock_items where id = v_item.source_stock_item_id for update;
    if not found then raise exception 'Asal stok untuk % tidak ditemukan.', v_item.source_barcode; end if;
    if v_item.split_lot then
      v_target_id := gen_random_uuid();
      v_target_barcode := 'DL-M-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
      insert into public.stock_items(
        organization_id, branch_id, product_id, barcode, supplier_barcode, serial_number,
        supplier, supplier_id, quantity, status, qc_stage, qc_notes, qc_by, qc_at,
        acquisition_cost, intake_batch_id, created_by
      ) values(
        v_org, v_transfer.destination_branch_id, v_item.product_id, v_target_barcode,
        v_source.supplier_barcode, '', v_source.supplier, v_source.supplier_id,
        v_item.quantity, 'available', v_source.qc_stage, v_source.qc_notes,
        v_source.qc_by, v_source.qc_at, v_item.unit_cost, v_source.intake_batch_id, v_uid
      );
    else
      if v_source.status <> 'transferred' or v_source.quantity <> 0 then
        raise exception 'Stok % tidak berada dalam status perjalanan.', v_item.source_barcode;
      end if;
      v_target_id := v_source.id;
      v_target_barcode := v_source.barcode;
      update public.stock_items
      set branch_id = v_transfer.destination_branch_id, quantity = v_item.quantity, status = 'available'
      where id = v_source.id;
    end if;

    update public.stock_transfer_items
    set received_stock_item_id = v_target_id, target_barcode = v_target_barcode
    where id = v_item.id;
    insert into public.stock_movements(organization_id, branch_id, product_id, stock_item_id, movement_type, quantity, reference, note, created_by)
    values(v_org, v_transfer.destination_branch_id, v_item.product_id, v_target_id, 'transfer_in', v_item.quantity,
      v_transfer.transfer_number, 'Mutasi dari ' || (select b.name from public.branches b where b.id = v_transfer.source_branch_id), v_uid);
    v_result := v_result || jsonb_build_array(jsonb_build_object('product_id', v_item.product_id, 'quantity', v_item.quantity, 'source_barcode', v_item.source_barcode, 'target_barcode', v_target_barcode));
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then raise exception 'Mutasi tidak memiliki baris barang.'; end if;
  update public.stock_transfers
  set status = 'received', received_by = v_uid, received_at = now()
  where id = v_transfer.id;
  return jsonb_build_object('transfer_number', v_transfer.transfer_number, 'item_count', v_count, 'items', v_result, 'status', 'received');
end;
$$;
revoke all on function private.receive_stock_transfer(uuid) from public, anon, authenticated;
grant execute on function private.receive_stock_transfer(uuid) to authenticated;

create or replace function public.receive_stock_transfer(_transfer_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.receive_stock_transfer(_transfer_id) $$;
revoke all on function public.receive_stock_transfer(uuid) from public, anon, authenticated;
grant execute on function public.receive_stock_transfer(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stock_transfers') then
    alter publication supabase_realtime add table public.stock_transfers;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stock_transfer_items') then
    alter publication supabase_realtime add table public.stock_transfer_items;
  end if;
end;
$$;
