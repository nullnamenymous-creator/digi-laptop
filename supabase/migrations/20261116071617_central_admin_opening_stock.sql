begin;

create or replace function private.can_manage_central_opening_stock(_org uuid, _branch uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.is_central_admin(_org) and private.is_central_branch(_branch)
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.organization_id = _org and p.branch_id = _branch
    )
$$;
revoke all on function private.can_manage_central_opening_stock(uuid, uuid) from public, anon;
grant execute on function private.can_manage_central_opening_stock(uuid, uuid) to authenticated;

drop policy if exists stock_opening_batches_central_admin_read on public.stock_opening_batches;
create policy stock_opening_batches_central_admin_read on public.stock_opening_batches
  for select to authenticated using (private.can_manage_central_opening_stock(organization_id, branch_id));

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
  where id = v_uid and (
    role = 'owner' or (role = 'central_admin' and branch_id = _branch_id
      and private.can_manage_central_opening_stock(organization_id, _branch_id))
  );
  if v_org is null then raise exception 'Akses pencatatan stok awal ditolak.'; end if;
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

create or replace function private.remove_unused_opening_stock(_batch_id uuid, _allow_central_admin boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.stock_opening_batches%rowtype;
  item_ids uuid[];
  total_units bigint;
  intact boolean;
begin
  select * into batch
  from public.stock_opening_batches
  where id = _batch_id and (private.is_owner(organization_id)
    or (_allow_central_admin and private.can_manage_central_opening_stock(organization_id, branch_id)))
  for update;

  if not found then
    raise exception 'Batch stok awal tidak ditemukan atau akses ditolak.';
  end if;

  -- Lock the same stock rows that sales and transfers update.
  select array_agg(id), sum(quantity),
         bool_and(status = 'available' and quantity > 0
           and branch_id = batch.branch_id and product_id = batch.product_id
           and organization_id = batch.organization_id)
    into item_ids, total_units, intact
  from (
    select id, quantity, status, branch_id, product_id, organization_id
    from public.stock_items
    where opening_batch_id = batch.id
    order by id
    for update
  ) as units;

  if intact is distinct from true or total_units is distinct from batch.unit_count
     or exists (select 1 from public.stock_repairs where stock_item_id = any(item_ids))
     or exists (
       select 1 from public.stock_movements m
       where m.stock_item_id = any(item_ids)
         and (m.movement_type <> 'receive' or m.reference is distinct from ('OPENING-' || batch.id::text))
     ) then
    raise exception 'Batch stok awal sudah berubah atau memiliki riwayat pemakaian.';
  end if;

  delete from public.stock_movements
  where stock_item_id = any(item_ids)
    and movement_type = 'receive' and reference = 'OPENING-' || batch.id::text;

  delete from public.stock_items where id = any(item_ids);
  delete from public.stock_opening_batches where id = batch.id;
exception when foreign_key_violation then
  raise exception 'Batch stok awal masih terhubung dengan transaksi atau riwayat stok.';
end;
$$;

revoke all on function private.remove_unused_opening_stock(uuid, boolean) from public, anon, authenticated;

create or replace function private.cancel_unused_opening_stock(_batch_id uuid)
returns void language sql security definer set search_path = '' as $$
  select private.remove_unused_opening_stock(_batch_id, false)
$$;

create or replace function private.correct_unused_opening_stock(
  _batch_id uuid, _quantity integer, _unit_cost numeric, _unit_details jsonb, _notes text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  batch public.stock_opening_batches%rowtype;
begin
  select * into batch from public.stock_opening_batches where id = _batch_id and (
    private.is_owner(organization_id)
    or private.can_manage_central_opening_stock(organization_id, branch_id)
  ) for update;
  if not found then raise exception 'Batch stok awal tidak ditemukan atau akses ditolak.'; end if;

  perform private.remove_unused_opening_stock(batch.id, true);
  return private.record_opening_stock(batch.branch_id, batch.product_id, _quantity, _unit_cost, _unit_details, _notes);
end;
$$;
revoke all on function private.correct_unused_opening_stock(uuid, integer, numeric, jsonb, text) from public, anon;
grant execute on function private.correct_unused_opening_stock(uuid, integer, numeric, jsonb, text) to authenticated;

create or replace function public.correct_unused_opening_stock(
  _batch_id uuid, _quantity integer, _unit_cost numeric, _unit_details jsonb, _notes text
)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.correct_unused_opening_stock(_batch_id, _quantity, _unit_cost, _unit_details, _notes)
$$;
revoke all on function public.correct_unused_opening_stock(uuid, integer, numeric, jsonb, text) from public, anon;
grant execute on function public.correct_unused_opening_stock(uuid, integer, numeric, jsonb, text) to authenticated;

notify pgrst, 'reload schema';

commit;
