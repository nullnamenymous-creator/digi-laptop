begin;

-- Reject stale repair buttons after completion, handover or scrap. In particular,
-- a closed repair must never resurrect a scrap unit via the legacy endpoint.
create or replace function private.update_stock_repair(_repair_id uuid,_status text,_resolution text default '')
returns void language plpgsql security definer set search_path='' as $$
declare j public.stock_repairs%rowtype; s public.stock_items%rowtype;
begin
  select * into j from public.stock_repairs where id=_repair_id for update;
  if not found or not private.is_central_branch(j.branch_id) or not exists(select 1 from public.profiles p
    where p.id=auth.uid() and p.organization_id=j.organization_id and p.role in ('owner','technician')
    and (p.role='owner' or p.branch_id=j.branch_id)) then raise exception 'Akses repair ditolak.'; end if;
  select * into s from public.stock_items where id=j.stock_item_id for update;
  if not found or s.organization_id<>j.organization_id or s.branch_id<>j.branch_id
    or j.status not in ('repair_needed','repairing','waiting_parts')
    or s.status not in ('repair_needed','repairing','waiting_parts') then
    raise exception 'Pekerjaan sudah ditutup atau unit tidak dalam pengerjaan aktif.';
  end if;
  if _status not in ('repairing','waiting_parts','pending_final_qc') then raise exception 'Status repair tidak valid.'; end if;
  update public.stock_repairs set status=_status,resolution=btrim(coalesce(_resolution,'')),technician_id=auth.uid(),updated_at=now() where id=j.id;
  update public.stock_items set status=case when _status='pending_final_qc' then 'pending_qc' else _status end,
    qc_stage=case when _status='pending_final_qc' then 'final' else qc_stage end where id=s.id;
end;
$$;

create function private.take_qc_sparepart(_request_id uuid,_repair_id uuid,_stock_id uuid,_quantity integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare j public.stock_repairs%rowtype; s public.stock_items%rowtype; existing public.stock_repair_parts%rowtype; v_name text;
begin
  select * into j from public.stock_repairs where id=_repair_id for update;
  if not found or not private.is_central_branch(j.branch_id) or not exists(select 1 from public.profiles p
    where p.id=auth.uid() and p.organization_id=j.organization_id and p.role in ('owner','technician')
    and (p.role='owner' or p.branch_id=j.branch_id)) then raise exception 'Akses sparepart QC ditolak.'; end if;
  if _request_id is null or _quantity is null or _quantity not between 1 and 500 then raise exception 'Permintaan sparepart tidak valid.'; end if;
  select * into existing from public.stock_repair_parts where id=_request_id;
  if found then
    if existing.repair_id=j.id and existing.stock_item_id=_stock_id and existing.quantity=_quantity then return existing.id; end if;
    raise exception 'Kode permintaan sparepart sudah digunakan.';
  end if;
  if j.status not in ('waiting_parts','repair_needed','repairing') or not exists(select 1 from public.stock_items u
    where u.id=j.stock_item_id and u.organization_id=j.organization_id and u.branch_id=j.branch_id
    and u.status in ('waiting_parts','repair_needed','repairing')) then raise exception 'Unit tidak menerima sparepart pada status ini.'; end if;
  select * into s from public.stock_items where id=_stock_id and organization_id=j.organization_id
    and branch_id=j.branch_id and status='available' and quantity>=_quantity for update;
  if not found then raise exception 'Stok sparepart berubah atau tidak cukup. Muat ulang pilihan.'; end if;
  select name into v_name from public.products where id=s.product_id and organization_id=j.organization_id and lower(category)<>'laptop';
  if not found or s.id=j.stock_item_id then raise exception 'Pilih stok sparepart Pusat, bukan unit laptop.'; end if;
  insert into public.stock_repair_parts(id,repair_id,stock_item_id,product_name,quantity,cost,created_by)
    values(_request_id,j.id,s.id,v_name,_quantity,s.acquisition_cost*_quantity,auth.uid());
  update public.stock_items set quantity=quantity-_quantity,status=case when quantity=_quantity then 'used_for_service' else status end where id=s.id;
  insert into public.stock_movements(organization_id,branch_id,product_id,stock_item_id,movement_type,quantity,reference,note,created_by)
    values(j.organization_id,j.branch_id,s.product_id,s.id,'service_use',-_quantity,'QC part '||_request_id::text,'Sparepart untuk laptop '||j.stock_item_id::text,auth.uid());
  return _request_id;
end;
$$;
revoke all on function private.take_qc_sparepart(uuid,uuid,uuid,integer) from public,anon;
grant execute on function private.take_qc_sparepart(uuid,uuid,uuid,integer) to authenticated;
create function public.take_qc_sparepart(_request_id uuid,_repair_id uuid,_stock_id uuid,_quantity integer)
returns uuid language sql security invoker set search_path='' as $$ select private.take_qc_sparepart(_request_id,_repair_id,_stock_id,_quantity) $$;
revoke all on function public.take_qc_sparepart(uuid,uuid,uuid,integer) from public,anon;
grant execute on function public.take_qc_sparepart(uuid,uuid,uuid,integer) to authenticated;

create function private.complete_qc_repair(_repair_id uuid,_resolution text,_labor_cost numeric,_final_check boolean)
returns void language plpgsql security definer set search_path='' as $$
declare j public.stock_repairs%rowtype; s public.stock_items%rowtype;
begin
  select * into j from public.stock_repairs where id=_repair_id for update;
  if not found or not private.is_central_branch(j.branch_id) or not exists(select 1 from public.profiles p
    where p.id=auth.uid() and p.organization_id=j.organization_id and p.role in ('owner','technician')
    and (p.role='owner' or p.branch_id=j.branch_id)) then raise exception 'Akses penyelesaian repair ditolak.'; end if;
  if _final_check is distinct from true or length(btrim(coalesce(_resolution,''))) not between 5 and 2000
    or _labor_cost is null or _labor_cost not between 0 and 1000000000 then raise exception 'Isi hasil perbaikan dan konfirmasi uji fungsi akhir.'; end if;
  select * into s from public.stock_items where id=j.stock_item_id for update;
  if not found or s.organization_id<>j.organization_id or s.branch_id<>j.branch_id then raise exception 'Lokasi unit berubah.'; end if;
  if j.status='completed' then return; end if;
  if j.status not in ('waiting_parts','repair_needed','repairing') or s.status not in ('waiting_parts','repair_needed','repairing') then
    raise exception 'Unit tidak berada pada tahap pengerjaan aktif.';
  end if;
  if j.status='waiting_parts' and not exists(select 1 from public.stock_repair_parts where repair_id=j.id) then
    raise exception 'Catat sparepart yang dipasang sebelum menyelesaikan unit menunggu sparepart.';
  end if;
  if j.status<>'repairing' then perform private.update_stock_repair(j.id,'repairing',_resolution); end if;
  perform private.finish_stock_repair(j.id,_resolution,_labor_cost);
  perform private.decide_stock_qc(s.id,'available',_resolution,null,null);
  -- require_qc_physical_handover intercepts approval and holds the unit out of ready stock.
end;
$$;
revoke all on function private.complete_qc_repair(uuid,text,numeric,boolean) from public,anon;
grant execute on function private.complete_qc_repair(uuid,text,numeric,boolean) to authenticated;
create function public.complete_qc_repair(_repair_id uuid,_resolution text,_labor_cost numeric,_final_check boolean)
returns void language sql security invoker set search_path='' as $$ select private.complete_qc_repair(_repair_id,_resolution,_labor_cost,_final_check) $$;
revoke all on function public.complete_qc_repair(uuid,text,numeric,boolean) from public,anon;
grant execute on function public.complete_qc_repair(uuid,text,numeric,boolean) to authenticated;

create function private.scrap_qc_unit(_unit_id uuid,_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare s public.stock_items%rowtype;
begin
  select * into s from public.stock_items where id=_unit_id for update;
  if not found or not private.is_central_branch(s.branch_id) or not exists(select 1 from public.profiles p
    where p.id=auth.uid() and p.organization_id=s.organization_id and p.role in ('owner','technician')
    and (p.role='owner' or p.branch_id=s.branch_id)) then raise exception 'Akses scrap ditolak.'; end if;
  if length(btrim(coalesce(_reason,''))) not between 5 and 2000 then raise exception 'Isi alasan scrap, minimal 5 karakter.'; end if;
  if s.status='scrap' then return; end if;
  if s.status not in ('pending_qc','waiting_parts','repair_needed','repairing','not_sellable') then raise exception 'Unit pada status ini tidak dapat dipindahkan ke scrap oleh teknisi.'; end if;
  perform 1 from public.stock_repairs where stock_item_id=s.id order by id for update;
  update public.stock_repairs set status='not_sellable',resolution=btrim(_reason),technician_id=auth.uid(),updated_at=now()
    where stock_item_id=s.id and status in ('repair_needed','repairing','waiting_parts','pending_final_qc');
  update public.stock_items set status='scrap',qc_notes=btrim(_reason),qc_by=auth.uid(),qc_at=now() where id=s.id;
end;
$$;
revoke all on function private.scrap_qc_unit(uuid,text) from public,anon;
grant execute on function private.scrap_qc_unit(uuid,text) to authenticated;
create function public.scrap_qc_unit(_unit_id uuid,_reason text)
returns void language sql security invoker set search_path='' as $$ select private.scrap_qc_unit(_unit_id,_reason) $$;
revoke all on function public.scrap_qc_unit(uuid,text) from public,anon;
grant execute on function public.scrap_qc_unit(uuid,text) to authenticated;

-- Installed store parts are capital moved from a parts lot to the repaired laptop,
-- not a new cash expense. Count those costs once even while the laptop is in transit.
create or replace function public.report_stock_value(_organization_id uuid,_branch_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
with owned_store as (select _organization_id id where private.is_owner(_organization_id)),
repair_costs as (
  select r.stock_item_id,sum(coalesce(r.labor_cost,0)+coalesce((select sum(p.cost) from public.stock_repair_parts p where p.repair_id=r.id),0)) as cost
  from public.stock_repairs r join owned_store o on o.id=r.organization_id group by r.stock_item_id
), units as (
  select s.quantity,s.acquisition_cost as unit_cost,coalesce(r.cost,0) as repair_cost,s.status='available' as ready,
    false as in_transit,p.retail_price-case when p.is_public then p.catalog_discount else 0 end as unit_price
  from owned_store o join public.stock_items s on s.organization_id=o.id
  join public.products p on p.id=s.product_id and p.organization_id=o.id
  left join repair_costs r on r.stock_item_id=s.id
  where s.quantity>0 and s.status not in ('sold','used_for_service','withdrawn','transferred')
    and (_branch_id is null or s.branch_id=_branch_id)
  union all
  select i.quantity,i.unit_cost,coalesce(r.cost,0),false,true,null::numeric
  from owned_store o join public.stock_transfers t on t.organization_id=o.id
  join public.stock_transfer_items i on i.transfer_id=t.id and i.organization_id=o.id
  left join repair_costs r on r.stock_item_id=i.source_stock_item_id
  where t.status='in_transit' and (_branch_id is null or t.source_branch_id=_branch_id)
)
select jsonb_build_object(
  'units',coalesce(sum(quantity),0),'cost',coalesce(sum(quantity*unit_cost),0)+coalesce(sum(repair_cost),0),
  'purchaseCost',coalesce(sum(quantity*unit_cost),0),'repairCost',coalesce(sum(repair_cost),0),
  'retail',coalesce(sum(quantity*unit_price) filter(where ready and unit_price>0),0),
  'readyUnits',coalesce(sum(quantity) filter(where ready),0),'transitUnits',coalesce(sum(quantity) filter(where in_transit),0),
  'missingCost',coalesce(sum(quantity) filter(where coalesce(unit_cost,0)<=0),0),
  'missingPrice',coalesce(sum(quantity) filter(where ready and coalesce(unit_price,0)<=0),0))
from units having exists(select 1 from owned_store)
$$;

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
    and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='stock_repair_parts') then
    alter publication supabase_realtime add table public.stock_repair_parts;
  end if;
end;
$$;

notify pgrst,'reload schema';
commit;
