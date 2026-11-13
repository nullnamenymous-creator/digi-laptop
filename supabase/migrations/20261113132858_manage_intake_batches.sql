create or replace function private.manage_intake(_id uuid, _delete boolean, _invoice text, _due date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  b public.intake_batches%rowtype;
begin
  select * into b from public.intake_batches where id = _id for update;
  if not found or not exists (
    select 1 from public.profiles where id = (select auth.uid())
    and organization_id = b.organization_id and role = 'owner'
  ) then raise exception 'Penerimaan tidak ditemukan atau akses ditolak.'; end if;
  if not _delete then
    if b.amount_paid < b.total_amount and _due is null then
      raise exception 'Isi jatuh tempo untuk tagihan yang belum lunas.';
    end if;
    update public.intake_batches set invoice_number = coalesce(trim(_invoice), ''),
      due_date = case when amount_paid < total_amount then _due end where id = b.id;
    return;
  end if;
  perform 1 from public.stock_items where intake_batch_id = b.id order by id for update;
  if b.amount_paid <> 0 or exists (
    select 1 from public.cash_transactions where source_type = 'intake_batch' and source_id = b.id
  ) then raise exception 'Penerimaan sudah memiliki pembayaran dan tidak dapat dihapus.'; end if;
  if exists (
    select 1 from public.stock_items s join public.products p on p.id = s.product_id
    where s.intake_batch_id = b.id and (
      s.branch_id <> b.branch_id or s.qc_at is not null
      or s.status::text <> case when p.category = 'Laptop' then 'pending_qc' else 'available' end
      or exists(select 1 from public.stock_repairs r where r.stock_item_id = s.id)
      or exists(select 1 from public.stock_movements m where m.stock_item_id = s.id and m.movement_type <> 'receive')
    )
  ) then raise exception 'Unit sudah diproses dan penerimaan tidak dapat dihapus.'; end if;
  delete from public.stock_movements m using public.stock_items s
    where m.stock_item_id = s.id and s.intake_batch_id = b.id and m.movement_type = 'receive';
  delete from public.stock_items where intake_batch_id = b.id;
  delete from public.intake_batches where id = b.id;
end;
$$;
revoke all on function private.manage_intake(uuid,boolean,text,date) from public, anon;
grant execute on function private.manage_intake(uuid,boolean,text,date) to authenticated;
create or replace function public.manage_intake(_id uuid, _delete boolean, _invoice text, _due date)
returns void language sql security invoker set search_path = ''
as $$ select private.manage_intake(_id,_delete,_invoice,_due) $$;
revoke all on function public.manage_intake(uuid,boolean,text,date) from public, anon;
grant execute on function public.manage_intake(uuid,boolean,text,date) to authenticated;
