CREATE OR REPLACE FUNCTION private.receive_stock_transfer(_transfer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        id, organization_id, branch_id, product_id, barcode, supplier_barcode, serial_number,
        supplier, supplier_id, quantity, status, qc_stage, qc_notes, qc_by, qc_at,
        acquisition_cost, intake_batch_id, created_by
      ) values(
        v_target_id, v_org, v_transfer.destination_branch_id, v_item.product_id, v_target_barcode,
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
$function$;
