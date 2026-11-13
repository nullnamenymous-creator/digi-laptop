create function private.manage_pending_intake_unit(_id uuid, _remove boolean, _serial text, _supplier_barcode text)
returns void language plpgsql security definer set search_path='' as $$
declare b public.intake_batches%rowtype; s public.stock_items%rowtype;
begin
 select b1.* into b from public.intake_batches b1 join public.stock_items s1 on s1.intake_batch_id=b1.id
 where s1.id=_id and private.is_owner(b1.organization_id) and private.is_central_branch(b1.branch_id) for update of b1;
 if not found then raise exception 'Unit penerimaan Pusat tidak ditemukan atau akses ditolak.'; end if;
 select * into s from public.stock_items where id=_id and intake_batch_id=b.id and branch_id=b.branch_id and organization_id=b.organization_id for update;
 if not found or s.status <> 'pending_qc' or s.qc_at is not null then raise exception 'Aksi hanya tersedia untuk unit yang belum diperiksa.'; end if;
 if not _remove then
   update public.stock_items set serial_number=left(btrim(coalesce(_serial,'')),160), supplier_barcode=left(btrim(coalesce(_supplier_barcode,'')),160) where id=s.id;
   return;
 end if;
 if b.amount_paid <> 0 or exists(select 1 from public.cash_transactions where source_type='intake_batch' and source_id=b.id) then
   raise exception 'Penerimaan sudah memiliki pembayaran. Unit tidak dapat dihapus.';
 end if;
 if s.quantity <> 1 or exists(select 1 from public.stock_movements where stock_item_id=s.id and movement_type <> 'receive') or exists(select 1 from public.stock_repairs where stock_item_id=s.id) then
   raise exception 'Unit sudah memiliki riwayat pemrosesan.';
 end if;
 delete from public.stock_movements where stock_item_id=s.id and movement_type='receive';
 delete from public.stock_items where id=s.id;
 if b.unit_count = 1 then
   delete from public.intake_batches where id=b.id;
 else
   update public.intake_batches set unit_count=b.unit_count-1, total_amount=(b.unit_count-1)*b.unit_cost,
     due_date=case when b.unit_cost>0 then b.due_date end where id=b.id;
 end if;
end $$;
revoke all on function private.manage_pending_intake_unit(uuid,boolean,text,text) from public,anon;
grant execute on function private.manage_pending_intake_unit(uuid,boolean,text,text) to authenticated;
create function public.manage_pending_intake_unit(_id uuid, _remove boolean, _serial text, _supplier_barcode text)
returns void language sql security invoker set search_path='' as $$
 select private.manage_pending_intake_unit(_id,_remove,_serial,_supplier_barcode)
$$;
revoke all on function public.manage_pending_intake_unit(uuid,boolean,text,text) from public,anon;
grant execute on function public.manage_pending_intake_unit(uuid,boolean,text,text) to authenticated;
