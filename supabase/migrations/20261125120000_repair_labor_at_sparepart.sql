begin;

alter table public.stock_repair_parts
  add column if not exists labor_cost numeric(14,2) not null default 0 check (labor_cost >= 0),
  add column if not exists labor_recorded_at timestamptz;

create function private.record_qc_repair_labor(_request_id uuid,_repair_id uuid,_labor_cost numeric)
returns void language plpgsql security definer set search_path='' as $$
declare j public.stock_repairs%rowtype; p public.stock_repair_parts%rowtype; s public.stock_items%rowtype; actor text;
begin
  if _labor_cost is null or _labor_cost not between 0 and 1000000000 then raise exception 'Ongkos jasa tidak valid.'; end if;
  select * into j from public.stock_repairs where id=_repair_id for update;
  if not found or not private.is_central_branch(j.branch_id) then raise exception 'Pekerjaan repair tidak ditemukan di Pusat.'; end if;
  select role into actor from public.profiles where id=auth.uid() and organization_id=j.organization_id;
  if actor is null or actor not in ('owner','technician') or (actor='technician' and not private.can_access_branch(j.branch_id)) then raise exception 'Akses pencatatan ongkos jasa ditolak.'; end if;
  select * into p from public.stock_repair_parts where id=_request_id and repair_id=j.id for update;
  if not found then raise exception 'Sparepart belum berhasil dicatat.'; end if;
  if p.labor_recorded_at is not null then
    if p.labor_cost=_labor_cost then return; end if;
    raise exception 'Ongkos jasa untuk sparepart ini sudah tercatat dengan nominal berbeda.';
  end if;
  if j.status not in ('repair_needed','repairing','waiting_parts') then raise exception 'Repair ini sudah ditutup dan tidak menerima ongkos jasa baru.'; end if;
  select * into s from public.stock_items where id=j.stock_item_id for update;
  if not found or s.status not in ('repair_needed','repairing','waiting_parts') then raise exception 'Status laptop tidak lagi dalam tahap repair.'; end if;
  update public.stock_repair_parts set labor_cost=_labor_cost,labor_recorded_at=now() where id=p.id;
  update public.stock_repairs set status='repairing',labor_cost=labor_cost+_labor_cost,technician_id=auth.uid(),updated_at=now() where id=j.id;
  update public.stock_items set status='repairing' where id=s.id;
  if _labor_cost>0 then
    insert into public.cash_transactions(organization_id,branch_id,direction,category,amount,description,source_type,source_id,created_by)
      values(j.organization_id,j.branch_id,'expense','Biaya repair stok',_labor_cost,'Ongkos pemasangan sparepart '||p.product_name||' pada laptop '||left(j.stock_item_id::text,8),'stock_repair_labor',p.id,auth.uid());
  end if;
end;
$$;
revoke all on function private.record_qc_repair_labor(uuid,uuid,numeric) from public,anon;
grant execute on function private.record_qc_repair_labor(uuid,uuid,numeric) to authenticated;
create function public.record_qc_repair_labor(_request_id uuid,_repair_id uuid,_labor_cost numeric)
returns void language sql security invoker set search_path='' as $$ select private.record_qc_repair_labor(_request_id,_repair_id,_labor_cost) $$;
revoke all on function public.record_qc_repair_labor(uuid,uuid,numeric) from public,anon;
grant execute on function public.record_qc_repair_labor(uuid,uuid,numeric) to authenticated;

notify pgrst,'reload schema';
commit;
