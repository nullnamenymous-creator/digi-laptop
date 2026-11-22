begin;

-- Bulk intake intentionally uses an archived placeholder product until each
-- laptop is assigned its real model during QC. Allow only those pending units
-- through the archived-product stock guard.
create or replace function private.guard_archived_product_stock()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_archived_at timestamptz;
begin
  if new.quantity > 0 then
    select p.archived_at into v_archived_at
    from public.products p
    where p.id = new.product_id
    for share;

    if v_archived_at is not null and not (
      new.status = 'pending_qc'
      and exists (
        select 1
        from public.intake_batches b
        join public.products p on p.id = b.product_id
        where b.id = new.intake_batch_id
          and b.bulk_laptop_intake
          and p.id = new.product_id
          and p.sku = 'DL-BORONGAN-UNASSIGNED'
      )
    ) then
      raise exception 'Produk sudah diarsipkan dan tidak bisa ditambahkan ke stok.';
    end if;
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';

commit;
