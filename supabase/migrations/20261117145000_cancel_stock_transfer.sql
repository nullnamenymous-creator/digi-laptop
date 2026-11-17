begin;

alter table public.stock_transfers
  drop constraint stock_transfers_status_check,
  drop constraint stock_transfers_check1,
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references auth.users(id),
  add column cancellation_reason text,
  add constraint stock_transfers_status_check check (
    (status = 'in_transit' and received_at is null and received_by is null and cancelled_at is null)
    or (status = 'received' and received_at is not null and received_by is not null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null and cancellation_reason is not null
        and (received_at is null) = (received_by is null))
  );

create function private.cancel_stock_transfer(_transfer_id uuid, _reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := btrim(coalesce(_reason, ''));
  v_transfer public.stock_transfers%rowtype;
  v_item public.stock_transfer_items%rowtype;
  v_source public.stock_items%rowtype;
  v_target public.stock_items%rowtype;
  v_received_movement public.stock_movements%rowtype;
  v_count integer := 0;
begin
  select t.* into v_transfer from public.stock_transfers t
  where t.id = _transfer_id and (
    private.is_owner(t.organization_id) or private.is_central_admin(t.organization_id)
  ) for update;
  if not found then raise exception 'Mutasi tidak ditemukan atau akses pembatalan ditolak.'; end if;
  if v_transfer.status = 'cancelled' then return; end if;
  if char_length(v_reason) not between 3 and 500 then
    raise exception 'Isi alasan pembatalan antara 3 dan 500 karakter.';
  end if;
  if not exists (select 1 from public.branches b where b.id = v_transfer.source_branch_id and b.is_active) then
    raise exception 'Cabang asal sudah tidak aktif.';
  end if;

  -- Lock stock before checking its current state or writing any reversal.
  perform s.id from public.stock_items s
  where s.id in (
    select i.source_stock_item_id from public.stock_transfer_items i where i.transfer_id = v_transfer.id
    union
    select i.received_stock_item_id from public.stock_transfer_items i where i.transfer_id = v_transfer.id
  ) order by s.id for update;

  for v_item in select * from public.stock_transfer_items where transfer_id = v_transfer.id
  loop
    v_count := v_count + 1;
    select * into v_source from public.stock_items where id = v_item.source_stock_item_id
      and organization_id = v_transfer.organization_id and product_id = v_item.product_id
      and barcode = v_item.source_barcode;
    if not found then raise exception 'Stok asal untuk % tidak ditemukan.', v_item.source_barcode; end if;

    if v_transfer.status = 'received' then
      select * into v_target from public.stock_items where id = v_item.received_stock_item_id
        and organization_id = v_transfer.organization_id and product_id = v_item.product_id
        and branch_id = v_transfer.destination_branch_id and barcode = v_item.target_barcode
        and status = 'available' and quantity = v_item.quantity and acquisition_cost = v_item.unit_cost;
      if not found then
        raise exception 'Stok tujuan % sudah berubah atau tidak tersedia.', v_item.source_barcode;
      end if;

      select m.* into v_received_movement from public.stock_movements m
      where m.stock_item_id = v_target.id and m.reference = v_transfer.transfer_number
        and m.branch_id = v_transfer.destination_branch_id and m.movement_type = 'transfer_in'
        and m.organization_id = v_transfer.organization_id
      order by m.created_at limit 1;
      if not found or exists (
        select 1 from public.stock_movements m where m.stock_item_id = v_target.id
          and m.id <> v_received_movement.id and m.created_at >= v_received_movement.created_at
      ) then
        raise exception 'Stok % memiliki aktivitas lain setelah diterima.', v_item.source_barcode;
      end if;

      if v_item.split_lot then
        update public.stock_items set quantity = 0, status = 'withdrawn' where id = v_target.id;
      elsif v_target.id <> v_source.id then
        raise exception 'Barcode tujuan % tidak sesuai dengan stok asal.', v_item.source_barcode;
      end if;

      insert into public.stock_movements(organization_id, branch_id, product_id, stock_item_id, movement_type, quantity, reference, note, created_by)
      values (v_transfer.organization_id, v_transfer.destination_branch_id, v_item.product_id, v_target.id,
        'transfer_out', -v_item.quantity, v_transfer.transfer_number, 'Pembatalan mutasi: ' || v_reason, v_uid);
    end if;

    if v_item.split_lot then
      if v_source.branch_id <> v_transfer.source_branch_id or v_source.status <> 'available'
          or v_source.acquisition_cost <> v_item.unit_cost then
        raise exception 'Lot asal % sudah berubah. Stok perlu diperiksa.', v_item.source_barcode;
      end if;
      update public.stock_items set quantity = quantity + v_item.quantity where id = v_source.id;
    else
      if v_transfer.status = 'in_transit' and (
          v_source.branch_id <> v_transfer.source_branch_id or v_source.status <> 'transferred' or v_source.quantity <> 0
      ) then raise exception 'Stok % sudah berubah dan tidak sedang dalam perjalanan.', v_item.source_barcode; end if;

      update public.stock_items set branch_id = v_transfer.source_branch_id, quantity = v_item.quantity, status = 'available'
      where id = v_source.id;
    end if;

    insert into public.stock_movements(organization_id, branch_id, product_id, stock_item_id, movement_type, quantity, reference, note, created_by)
    values (v_transfer.organization_id, v_transfer.source_branch_id, v_item.product_id, v_source.id,
      'transfer_in', v_item.quantity, v_transfer.transfer_number, 'Pembatalan mutasi: ' || v_reason, v_uid);
  end loop;

  if v_count = 0 then raise exception 'Mutasi tidak memiliki baris barang.'; end if;
  update public.stock_transfers set status = 'cancelled', cancelled_at = now(),
    cancelled_by = v_uid, cancellation_reason = v_reason where id = v_transfer.id;
end;
$$;

create function public.cancel_stock_transfer(_transfer_id uuid, _reason text)
returns void language sql security invoker set search_path = '' as $$
  select private.cancel_stock_transfer(_transfer_id, _reason)
$$;

revoke all on function private.cancel_stock_transfer(uuid,text), public.cancel_stock_transfer(uuid,text)
  from public, anon, authenticated;
grant execute on function private.cancel_stock_transfer(uuid,text), public.cancel_stock_transfer(uuid,text)
  to authenticated;

notify pgrst, 'reload schema';

commit;
