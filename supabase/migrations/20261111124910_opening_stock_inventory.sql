-- Record goods already owned by a branch when Digi-Laptop is first introduced.
-- Opening stock is not a supplier invoice and does not create payable balances.
create table if not exists public.stock_opening_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  product_id uuid not null references public.products(id),
  unit_count integer not null check (unit_count between 1 and 500),
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  notes text not null default '',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.stock_items
  add column if not exists opening_batch_id uuid references public.stock_opening_batches(id);

create index if not exists stock_opening_batches_branch_created_idx
  on public.stock_opening_batches(branch_id, created_at desc);
create index if not exists stock_items_opening_batch_idx
  on public.stock_items(opening_batch_id) where opening_batch_id is not null;

alter table public.stock_opening_batches enable row level security;
grant select on public.stock_opening_batches to authenticated;
drop policy if exists stock_opening_batches_owner_read on public.stock_opening_batches;
create policy stock_opening_batches_owner_read on public.stock_opening_batches
  for select to authenticated using (private.is_owner(organization_id));

create or replace function private.record_opening_stock(
  _branch_id uuid,
  _product_id uuid,
  _quantity integer,
  _unit_cost numeric,
  _unit_details jsonb default '[]'::jsonb,
  _notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_batch uuid := gen_random_uuid();
  v_product public.products%rowtype;
  v_barcode text;
  v_serial text;
  v_item uuid;
  v_i integer;
  v_details jsonb := coalesce(_unit_details, '[]'::jsonb);
  v_items jsonb := '[]'::jsonb;
begin
  select organization_id into v_org
  from public.profiles
  where id = v_uid and role = 'owner';
  if v_org is null then raise exception 'Hanya pemilik yang dapat mencatat stok awal.'; end if;
  if not exists(select 1 from public.branches where id = _branch_id and organization_id = v_org and is_active) then
    raise exception 'Cabang tidak aktif atau bukan milik toko ini.';
  end if;
  if _quantity is null or _quantity < 1 or _quantity > 500 then raise exception 'Jumlah stok awal harus 1 sampai 500.'; end if;
  if _unit_cost is null or _unit_cost < 0 then raise exception 'Modal per unit tidak boleh negatif.'; end if;
  if jsonb_typeof(v_details) <> 'array' then raise exception 'Data unit tidak valid.'; end if;

  select * into v_product from public.products where id = _product_id and organization_id = v_org;
  if not found then raise exception 'Produk tidak ditemukan di toko ini. Buat produk terlebih dahulu.'; end if;
  if lower(v_product.category) = 'laptop' and jsonb_array_length(v_details) not in (0, _quantity) then
    raise exception 'Isi nomor seri untuk semua unit atau kosongkan semuanya.';
  end if;
  if lower(v_product.category) <> 'laptop' and jsonb_array_length(v_details) > 0 then
    raise exception 'Nomor seri per unit hanya berlaku untuk laptop.';
  end if;

  insert into public.stock_opening_batches(id, organization_id, branch_id, product_id, unit_count, unit_cost, notes, created_by)
  values(v_batch, v_org, _branch_id, _product_id, _quantity, _unit_cost, left(btrim(coalesce(_notes, '')), 1000), v_uid);

  if lower(v_product.category) = 'laptop' then
    for v_i in 1.._quantity loop
      v_barcode := 'DL-O-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
      v_serial := case when jsonb_array_length(v_details) = 0 then '' else left(btrim(coalesce(v_details->(v_i - 1)->>'serial_number', '')), 120) end;
      insert into public.stock_items(organization_id, branch_id, product_id, barcode, serial_number, quantity, status, qc_stage, acquisition_cost, opening_batch_id, created_by)
      values(v_org, _branch_id, _product_id, v_barcode, v_serial, 1, 'available', 'initial', _unit_cost, v_batch, v_uid)
      returning id into v_item;
      insert into public.stock_movements(organization_id, branch_id, product_id, stock_item_id, movement_type, quantity, reference, note, created_by)
      values(v_org, _branch_id, _product_id, v_item, 'receive', 1, 'OPENING-' || v_batch::text, 'Stok awal · sudah tersedia sebelum Digi-Laptop', v_uid);
      v_items := v_items || jsonb_build_array(jsonb_build_object('id', v_item, 'barcode', v_barcode, 'serial_number', v_serial, 'quantity', 1));
    end loop;
  else
    v_barcode := 'DL-O-P-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    insert into public.stock_items(organization_id, branch_id, product_id, barcode, quantity, status, qc_stage, acquisition_cost, opening_batch_id, created_by)
    values(v_org, _branch_id, _product_id, v_barcode, _quantity, 'available', 'initial', _unit_cost, v_batch, v_uid)
    returning id into v_item;
    insert into public.stock_movements(organization_id, branch_id, product_id, stock_item_id, movement_type, quantity, reference, note, created_by)
    values(v_org, _branch_id, _product_id, v_item, 'receive', _quantity, 'OPENING-' || v_batch::text, 'Stok awal · sudah tersedia sebelum Digi-Laptop', v_uid);
    v_items := jsonb_build_array(jsonb_build_object('id', v_item, 'barcode', v_barcode, 'serial_number', '', 'quantity', _quantity));
  end if;

  return jsonb_build_object('batch_id', v_batch, 'items', v_items);
end;
$$;

revoke all on function private.record_opening_stock(uuid, uuid, integer, numeric, jsonb, text) from public, anon, authenticated;
grant execute on function private.record_opening_stock(uuid, uuid, integer, numeric, jsonb, text) to authenticated;
grant usage on schema private to authenticated;

create or replace function public.record_opening_stock(
  _branch_id uuid,
  _product_id uuid,
  _quantity integer,
  _unit_cost numeric,
  _unit_details jsonb default '[]'::jsonb,
  _notes text default ''
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.record_opening_stock(_branch_id, _product_id, _quantity, _unit_cost, _unit_details, _notes)
$$;
revoke all on function public.record_opening_stock(uuid, uuid, integer, numeric, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_opening_stock(uuid, uuid, integer, numeric, jsonb, text) to authenticated;
