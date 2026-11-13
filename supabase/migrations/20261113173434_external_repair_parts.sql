alter table public.stock_repair_parts
 alter column stock_item_id drop not null,
 add column external_supplier text,
 add column purchased_on date,
 add column invoice_number text,
 add column paid_at timestamptz,
 add constraint repair_part_origin_check check (
 (stock_item_id is not null and external_supplier is null) or
 (stock_item_id is null and external_supplier is not null and purchased_on is not null)
 );
create function private.record_external_repair_part(_id uuid,_repair uuid,_name text,_quantity integer,_unit_cost numeric,_supplier text,_date date,_invoice text,_paid boolean)
returns void language plpgsql security definer set search_path='' as $$
declare j public.stock_repairs%rowtype; p public.stock_repair_parts%rowtype; actor text;
begin
 select role into actor from public.profiles where id=(select auth.uid());
 select * into j from public.stock_repairs where id=_repair for update;
 if not found or actor is null or actor not in ('owner','technician') or not private.can_access_branch(j.branch_id) or not private.is_central_branch(j.branch_id) then raise exception 'Akses repair ditolak.'; end if;
 select * into p from public.stock_repair_parts where id=_id and repair_id=j.id and stock_item_id is null for update;
 if not found then
   if j.status not in ('repair_needed','repairing','waiting_parts') then raise exception 'Repair tidak menerima sparepart baru.'; end if;
   if nullif(btrim(_name),'') is null or nullif(btrim(_supplier),'') is null or _date is null or _quantity is null or _quantity not between 1 and 500 or _unit_cost is null or _unit_cost not between 0.01 and 1000000000 then raise exception 'Lengkapi detail pembelian sparepart.'; end if;
   insert into public.stock_repair_parts(id,repair_id,product_name,quantity,cost,created_by,external_supplier,purchased_on,invoice_number)
   values(_id,j.id,left(btrim(_name),200),_quantity,round(_unit_cost*_quantity,2),(select auth.uid()),left(btrim(_supplier),160),_date,left(coalesce(_invoice,''),100)) returning * into p;
 end if;
 if _paid and p.paid_at is null then
   insert into public.cash_transactions(organization_id,branch_id,direction,category,amount,description,source_type,source_id,created_by)
   values(j.organization_id,j.branch_id,'expense','Sparepart repair luar',p.cost,p.product_name||' · '||p.external_supplier,'stock_repair_external_part',p.id,(select auth.uid()));
   update public.stock_repair_parts set paid_at=now() where id=p.id;
 end if;
end $$;
revoke all on function private.record_external_repair_part(uuid,uuid,text,integer,numeric,text,date,text,boolean) from public,anon;
grant execute on function private.record_external_repair_part(uuid,uuid,text,integer,numeric,text,date,text,boolean) to authenticated;
create function public.record_external_repair_part(_id uuid,_repair uuid,_name text,_quantity integer,_unit_cost numeric,_supplier text,_date date,_invoice text,_paid boolean)
returns void language sql security invoker set search_path='' as $$
select private.record_external_repair_part(_id,_repair,_name,_quantity,_unit_cost,_supplier,_date,_invoice,_paid)
$$;
revoke all on function public.record_external_repair_part(uuid,uuid,text,integer,numeric,text,date,text,boolean) from public,anon;
grant execute on function public.record_external_repair_part(uuid,uuid,text,integer,numeric,text,date,text,boolean) to authenticated;
