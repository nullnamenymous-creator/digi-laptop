create or replace function private.cancel_unused_opening_stock(_batch_id uuid)
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
  where id = _batch_id and private.is_owner(organization_id)
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

revoke all on function private.cancel_unused_opening_stock(uuid) from public, anon;
grant execute on function private.cancel_unused_opening_stock(uuid) to authenticated;

create or replace function public.cancel_unused_opening_stock(_batch_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.cancel_unused_opening_stock(_batch_id)
$$;

revoke all on function public.cancel_unused_opening_stock(uuid) from public, anon;
grant execute on function public.cancel_unused_opening_stock(uuid) to authenticated;
