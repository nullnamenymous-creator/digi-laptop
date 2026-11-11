-- Split serialized laptop intake from quantity-based component intake and keep
-- repair cost attached to the exact laptop being prepared for resale.
alter table public.customers add column if not exists customer_type text not null default 'end_user';
alter table public.customers drop constraint if exists customers_customer_type_check;
alter table public.customers add constraint customers_customer_type_check check (customer_type in ('end_user','reseller'));

alter table public.stock_items add column if not exists acquisition_cost numeric(14,2) not null default 0 check (acquisition_cost >= 0);
alter table public.stock_repairs add column if not exists labor_cost numeric(14,2) not null default 0 check (labor_cost >= 0);
alter table public.stock_items drop constraint if exists stock_items_status_check;
alter table public.stock_items add constraint stock_items_status_check check (status in ('pending_qc','repair_needed','repairing','waiting_parts','available','not_sellable','scrap','sold','used_for_service','transferred'));

create or replace function private.copy_intake_unit_cost()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.unit_cost is distinct from old.unit_cost then
    update public.stock_items set acquisition_cost=new.unit_cost where intake_batch_id=new.id;
  end if;
  return new;
end; $$;
drop trigger if exists intake_batches_copy_unit_cost on public.intake_batches;
create trigger intake_batches_copy_unit_cost after update of unit_cost on public.intake_batches
for each row execute function private.copy_intake_unit_cost();

create or replace function private.receive_stock_batch(_branch_id uuid,_product_id uuid,_supplier text,_quantity integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid:=(select auth.uid()); v_org uuid; v_batch uuid:=gen_random_uuid(); v_barcode text; v_product public.products%rowtype; v_item uuid; v_i integer;
begin
  select organization_id into v_org from public.profiles where id=v_uid and role in ('owner','operator');
  if v_org is null or not private.can_access_branch(_branch_id) then raise exception 'Tidak punya akses penerimaan untuk cabang ini.'; end if;
  if _quantity is null or _quantity<1 or _quantity>500 then raise exception 'Jumlah penerimaan harus 1 sampai 500.'; end if;
  select * into v_product from public.products where id=_product_id and organization_id=v_org;
  if not found then raise exception 'Produk tidak ditemukan.'; end if;
  insert into public.intake_batches(id,organization_id,branch_id,product_id,supplier,unit_count,created_by)
    values(v_batch,v_org,_branch_id,_product_id,coalesce(trim(_supplier),''),_quantity,v_uid);
  if lower(v_product.category)='laptop' then
    for v_i in 1.._quantity loop
      v_barcode:='DL-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
      insert into public.stock_items(organization_id,branch_id,product_id,barcode,supplier,quantity,status,intake_batch_id,qc_stage,created_by)
        values(v_org,_branch_id,_product_id,v_barcode,coalesce(trim(_supplier),''),1,'pending_qc',v_batch,'initial',v_uid) returning id into v_item;
      insert into public.stock_movements(organization_id,branch_id,product_id,stock_item_id,movement_type,quantity,reference,note,created_by)
        values(v_org,_branch_id,_product_id,v_item,'receive',1,v_barcode,'Unit laptop batch '||v_batch::text,v_uid);
    end loop;
  else
    v_barcode:='DL-P-'||upper(substr(replace(v_batch::text,'-',''),1,12));
    insert into public.stock_items(organization_id,branch_id,product_id,barcode,supplier,quantity,status,intake_batch_id,qc_stage,created_by)
      values(v_org,_branch_id,_product_id,v_barcode,coalesce(trim(_supplier),''),_quantity,'available',v_batch,'initial',v_uid) returning id into v_item;
    insert into public.stock_movements(organization_id,branch_id,product_id,stock_item_id,movement_type,quantity,reference,note,created_by)
      values(v_org,_branch_id,_product_id,v_item,'receive',_quantity,v_barcode,'Stok kuantitas batch '||v_batch::text,v_uid);
  end if;
  return v_batch;
end; $$;
revoke all on function private.receive_stock_batch(uuid,uuid,text,integer) from public,anon;
grant execute on function private.receive_stock_batch(uuid,uuid,text,integer) to authenticated;

create or replace function private.decide_stock_qc(_stock_item_id uuid,_decision text,_notes text,_serial_number text default null,_supplier_barcode text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid:=(select auth.uid()); v_stock public.stock_items%rowtype; v_role text; v_repair_status text;
begin
  select role into v_role from public.profiles where id=v_uid;
  select * into v_stock from public.stock_items where id=_stock_item_id for update;
  if not found or not private.can_access_branch(v_stock.branch_id) or v_role not in ('owner','technician') then raise exception 'Tidak punya akses teknisi ke unit ini.'; end if;
  if v_stock.status<>'pending_qc' then raise exception 'Unit ini tidak sedang menunggu QC.'; end if;
  if _decision not in ('available','repair_needed','waiting_parts','not_sellable','scrap') then raise exception 'Keputusan QC tidak valid.'; end if;
  if _decision='waiting_parts' and v_stock.qc_stage='final' then raise exception 'QC akhir harus meluluskan, mengembalikan ke repair, atau mengarantina unit.'; end if;
  update public.stock_items set status=_decision,qc_notes=coalesce(trim(_notes),''),qc_by=v_uid,qc_at=now(),
    serial_number=coalesce(nullif(trim(_serial_number),''),serial_number),supplier_barcode=coalesce(nullif(trim(_supplier_barcode),''),supplier_barcode)
    where id=_stock_item_id;
  if _decision in ('repair_needed','waiting_parts') then
    v_repair_status:=_decision;
    if v_stock.qc_stage='final' then
      update public.stock_repairs set status=v_repair_status,issue=coalesce(nullif(trim(_notes),''),'Pemeriksaan lanjutan diperlukan.'),resolution='',technician_id=v_uid,updated_at=now()
        where stock_item_id=_stock_item_id and status='pending_final_qc';
    else
      insert into public.stock_repairs(organization_id,branch_id,stock_item_id,issue,status,technician_id)
        values(v_stock.organization_id,v_stock.branch_id,v_stock.id,coalesce(nullif(trim(_notes),''),'Perlu pemeriksaan teknisi.'),v_repair_status,v_uid);
    end if;
  elsif v_stock.qc_stage='final' then
    update public.stock_repairs set status=case when _decision='available' then 'completed' else 'not_sellable' end,
      resolution=coalesce(nullif(trim(_notes),''),resolution),technician_id=v_uid,updated_at=now()
      where stock_item_id=_stock_item_id and status='pending_final_qc';
  end if;
end; $$;
revoke all on function private.decide_stock_qc(uuid,text,text,text,text) from public,anon;
grant execute on function private.decide_stock_qc(uuid,text,text,text,text) to authenticated;

create or replace function private.use_stock_repair_part(_repair_id uuid,_part_stock_item_id uuid,_quantity integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid:=(select auth.uid()); v_job public.stock_repairs%rowtype; v_part public.stock_items%rowtype; v_role text; v_name text;
begin
  select role into v_role from public.profiles where id=v_uid;
  select * into v_job from public.stock_repairs where id=_repair_id for update;
  if not found or not private.can_access_branch(v_job.branch_id) or v_role not in ('owner','technician') then raise exception 'Tidak punya akses teknisi ke pekerjaan ini.'; end if;
  if v_job.status not in ('repair_needed','repairing','waiting_parts') then raise exception 'Pekerjaan ini tidak menerima sparepart.'; end if;
  select * into v_part from public.stock_items where id=_part_stock_item_id and branch_id=v_job.branch_id and status='available' and quantity>=_quantity for update;
  if not found or _quantity<1 then raise exception 'Stok sparepart tidak cukup di cabang ini.'; end if;
  select p.name into v_name from public.products p where p.id=v_part.product_id and p.organization_id=v_job.organization_id and p.category<>'Laptop';
  if not found then raise exception 'Pilih stok kategori sparepart atau aksesori.'; end if;
  update public.stock_items set quantity=quantity-_quantity,status=case when quantity-_quantity=0 then 'used_for_service' else status end where id=v_part.id;
  insert into public.stock_repair_parts(repair_id,stock_item_id,product_name,quantity,cost,created_by)
    values(_repair_id,v_part.id,v_name,_quantity,v_part.acquisition_cost*_quantity,v_uid);
  insert into public.stock_movements(organization_id,branch_id,product_id,stock_item_id,movement_type,quantity,reference,note,created_by)
    values(v_job.organization_id,v_job.branch_id,v_part.product_id,v_part.id,'service_use',-_quantity,'Repair '||v_job.id::text,'Sparepart untuk laptop '||v_job.stock_item_id::text,v_uid);
end; $$;
revoke all on function private.use_stock_repair_part(uuid,uuid,integer) from public,anon;
grant execute on function private.use_stock_repair_part(uuid,uuid,integer) to authenticated;

create or replace function private.finish_stock_repair(_repair_id uuid,_resolution text,_labor_cost numeric default 0)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid:=(select auth.uid()); v_job public.stock_repairs%rowtype; v_role text;
begin
  select role into v_role from public.profiles where id=v_uid;
  select * into v_job from public.stock_repairs where id=_repair_id for update;
  if not found or not private.can_access_branch(v_job.branch_id) or v_role not in ('owner','technician') then raise exception 'Tidak punya akses teknisi ke pekerjaan ini.'; end if;
  if v_job.status<>'repairing' then raise exception 'Pekerjaan harus berstatus sedang diperbaiki.'; end if;
  if coalesce(_labor_cost,0)<0 then raise exception 'Biaya repair tidak boleh negatif.'; end if;
  update public.stock_repairs set status='pending_final_qc',resolution=coalesce(trim(_resolution),''),labor_cost=labor_cost+coalesce(_labor_cost,0),technician_id=v_uid,updated_at=now() where id=_repair_id;
  update public.stock_items set status='pending_qc',qc_stage='final' where id=v_job.stock_item_id;
  if coalesce(_labor_cost,0)>0 then
    insert into public.cash_transactions(organization_id,branch_id,direction,category,amount,description,source_type,source_id,created_by)
      values(v_job.organization_id,v_job.branch_id,'expense','Biaya repair stok',_labor_cost,'Ongkos perbaikan laptop '||left(v_job.stock_item_id::text,8),'stock_repair',v_job.id,v_uid);
  end if;
end; $$;
revoke all on function private.finish_stock_repair(uuid,text,numeric) from public,anon;
grant execute on function private.finish_stock_repair(uuid,text,numeric) to authenticated;
create or replace function public.finish_stock_repair(_repair_id uuid,_resolution text,_labor_cost numeric default 0)
returns void language sql security invoker set search_path = '' as $$ select private.finish_stock_repair(_repair_id,_resolution,_labor_cost) $$;
revoke all on function public.finish_stock_repair(uuid,text,numeric) from public,anon;
grant execute on function public.finish_stock_repair(uuid,text,numeric) to authenticated;

create or replace function private.create_sale_with_request(_request_id uuid,_branch_id uuid,_customer_name text,_customer_type text,_payment_method text,_lines jsonb,_customer_id uuid,_paid_amount numeric,_due_date date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_sale uuid; v_line jsonb; v_current numeric; v_type text:=_customer_type;
begin
  select organization_id into v_org from public.profiles where id=(select auth.uid()) and role in ('owner','operator');
  if v_org is null or not private.can_operate_branch(_branch_id) then raise exception 'Tidak punya akses kasir cabang ini.'; end if;
  if _request_id is null then raise exception 'ID transaksi wajib diisi.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text||':'||_request_id::text,0));
  select id into v_sale from public.sales where organization_id=v_org and request_id=_request_id;
  if v_sale is not null then return v_sale; end if;
  if _customer_id is not null then
    select customer_type into v_type from public.customers where id=_customer_id and organization_id=v_org;
    if not found then raise exception 'Pelanggan tidak ditemukan.'; end if;
  end if;
  if v_type not in ('end_user','reseller') then raise exception 'Tipe harga pelanggan tidak valid.'; end if;
  for v_line in select value from jsonb_array_elements(_lines) loop
    select case when v_type='reseller' then reseller_price else retail_price end into v_current from public.products where id=(v_line->>'product_id')::uuid and organization_id=v_org;
    if not found or v_current is distinct from (v_line->>'expected_price')::numeric then raise exception 'Harga produk berubah. Muat ulang kasir sebelum menyimpan transaksi.'; end if;
  end loop;
  v_sale:=private.create_sale_with_terms(_branch_id,_customer_name,v_type,_payment_method,_lines,_customer_id,_paid_amount,_due_date);
  update public.sales set request_id=_request_id where id=v_sale;
  return v_sale;
end; $$;
revoke all on function private.create_sale_with_request(uuid,uuid,text,text,text,jsonb,uuid,numeric,date) from public,anon,authenticated;
grant execute on function private.create_sale_with_request(uuid,uuid,text,text,text,jsonb,uuid,numeric,date) to authenticated;
