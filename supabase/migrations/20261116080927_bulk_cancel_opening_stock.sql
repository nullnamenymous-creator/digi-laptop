begin;

create or replace function private.bulk_cancel_opening_stock(
  _branch_id uuid, _brand text, _model text, _batch_ids uuid[]
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_batch record;
  v_cancelled integer := 0;
  v_units bigint := 0;
  v_requested integer;
begin
  select b.organization_id into v_org
  from public.branches b
  where b.id = _branch_id and (
    private.is_owner(b.organization_id)
    or private.can_manage_central_opening_stock(b.organization_id, b.id)
  );
  if not found then raise exception 'Akses pembatalan stok awal cabang ditolak.'; end if;
  if coalesce(btrim(_brand), '') = '' or coalesce(btrim(_model), '') = '' then
    raise exception 'Pilih merek dan tipe laptop terlebih dahulu.';
  end if;

  select count(distinct id) into v_requested from unnest(_batch_ids) as ids(id);
  if v_requested = 0 then raise exception 'Tidak ada batch stok awal yang dipilih.'; end if;

  for v_batch in
    select s.id, s.unit_count
    from public.stock_opening_batches s
    join public.products p on p.id = s.product_id and p.organization_id = v_org
    where s.id = any(_batch_ids) and s.branch_id = _branch_id and s.organization_id = v_org
      and lower(btrim(p.category)) = 'laptop'
      and lower(btrim(p.brand)) = lower(btrim(_brand))
      and lower(btrim(p.model)) = lower(btrim(_model))
    order by s.id
    for update of s
  loop
    begin
      perform private.remove_unused_opening_stock(v_batch.id, true);
      v_cancelled := v_cancelled + 1;
      v_units := v_units + v_batch.unit_count;
    exception when raise_exception then
      if sqlerrm not in (
        'Batch stok awal sudah berubah atau memiliki riwayat pemakaian.',
        'Batch stok awal masih terhubung dengan transaksi atau riwayat stok.'
      ) then raise; end if;
    end;
  end loop;

  return jsonb_build_object(
    'cancelled_batches', v_cancelled,
    'cancelled_units', v_units,
    'skipped_batches', v_requested - v_cancelled
  );
end;
$$;
revoke all on function private.bulk_cancel_opening_stock(uuid, text, text, uuid[]) from public, anon;
grant execute on function private.bulk_cancel_opening_stock(uuid, text, text, uuid[]) to authenticated;

create or replace function public.bulk_cancel_opening_stock(
  _branch_id uuid, _brand text, _model text, _batch_ids uuid[]
)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.bulk_cancel_opening_stock(_branch_id, _brand, _model, _batch_ids)
$$;
revoke all on function public.bulk_cancel_opening_stock(uuid, text, text, uuid[]) from public, anon;
grant execute on function public.bulk_cancel_opening_stock(uuid, text, text, uuid[]) to authenticated;

notify pgrst, 'reload schema';

commit;
