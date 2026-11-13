alter table public.branches add column is_central boolean not null default false;
update public.branches set is_central=true where is_active and upper(btrim(name))='CABANG PUSAT';
create unique index branches_one_central on public.branches(organization_id) where is_central;
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check(role in ('owner','operator','technician','investor'));
create function private.is_central_branch(_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.branches where id=_id and is_central and is_active)
$$;
revoke all on function private.is_central_branch(uuid) from public,anon;
grant execute on function private.is_central_branch(uuid) to authenticated;
create function private.check_central_stock() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='stock_transfers' then
   if not private.is_owner(new.organization_id) then raise exception 'Hanya Pemilik yang boleh mengirim mutasi.'; end if;
   if not private.is_central_branch(new.source_branch_id) then raise exception 'Mutasi stok hanya boleh berangkat dari Pusat.'; end if;
 elsif not private.is_central_branch(new.branch_id) then
   raise exception 'Penerimaan dan stok awal hanya boleh dicatat di Pusat.';
 end if;
 return new;
end $$;
create trigger intake_central_only before insert on public.intake_batches for each row execute function private.check_central_stock();
create trigger opening_central_only before insert on public.stock_opening_batches for each row execute function private.check_central_stock();
create trigger transfer_central_only before insert on public.stock_transfers for each row execute function private.check_central_stock();
create function private.keep_central_active() returns trigger language plpgsql set search_path='' as $$
begin
 if old.is_central and not new.is_active then raise exception 'Cabang Pusat harus tetap aktif.'; end if;
 return new;
end $$;
create trigger keep_central_active before update of is_active on public.branches for each row execute function private.keep_central_active();
create function private.can_investor_read(_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.branches b on b.id=p.branch_id and b.organization_id=p.organization_id
 where p.id=(select auth.uid()) and p.role='investor' and b.id=_id and b.is_active)
$$;
revoke all on function private.can_investor_read(uuid) from public,anon;
grant execute on function private.can_investor_read(uuid) to authenticated;
create policy investor_sales on public.sales for select to authenticated using(private.can_investor_read(branch_id));
create policy investor_sale_items on public.sale_items for select to authenticated using(exists(select 1 from public.sales s where s.id=sale_id and private.can_investor_read(s.branch_id)));
create policy investor_cash on public.cash_transactions for select to authenticated using(private.can_investor_read(branch_id));
create policy investor_service on public.service_tickets for select to authenticated using(private.can_investor_read(branch_id));
create policy investor_service_parts on public.service_parts for select to authenticated using(exists(select 1 from public.service_tickets t where t.id=ticket_id and private.can_investor_read(t.branch_id)));
create policy own_branch_directory on public.branches as restrictive for select to authenticated using(private.can_access_branch(id));
create policy own_branch_profiles on public.profiles as restrictive for select to authenticated using(private.is_owner(organization_id) or id=(select auth.uid()) or (role='technician' and private.can_operate_branch(branch_id)));
revoke insert, update, delete on public.stock_items from authenticated,anon,public;
create policy scoped_stock_repair on public.stock_repairs as restrictive for select to authenticated using(
 private.is_owner(organization_id) or private.can_investor_read(branch_id) or
 (private.is_central_branch(branch_id) and private.can_access_branch(branch_id))
);
CREATE OR REPLACE FUNCTION private.update_stock_repair(_repair_id uuid, _status text, _resolution text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := (select auth.uid()); v_job public.stock_repairs%rowtype; v_role text;
begin
  select role into v_role from public.profiles where id = v_uid;
  select * into v_job from public.stock_repairs where id = _repair_id for update;
  if not found or not private.can_access_branch(v_job.branch_id) or not private.is_central_branch(v_job.branch_id) or v_role not in ('owner','technician') then raise exception 'Tidak punya akses teknisi ke pekerjaan ini.'; end if;
  if _status not in ('repairing','waiting_parts','pending_final_qc') then raise exception 'Status repair tidak valid.'; end if;
  update public.stock_repairs set status = _status, resolution = coalesce(trim(_resolution),''), technician_id = v_uid, updated_at = now() where id = _repair_id;
  update public.stock_items set status = case when _status = 'pending_final_qc' then 'pending_qc' else _status end,
    qc_stage = case when _status = 'pending_final_qc' then 'final' else qc_stage end where id = v_job.stock_item_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.use_stock_repair_part(_repair_id uuid, _part_stock_item_id uuid, _quantity integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid:=(select auth.uid()); v_job public.stock_repairs%rowtype; v_part public.stock_items%rowtype; v_role text; v_name text;
begin
  select role into v_role from public.profiles where id=v_uid;
  select * into v_job from public.stock_repairs where id=_repair_id for update;
  if not found or not private.can_access_branch(v_job.branch_id) or not private.is_central_branch(v_job.branch_id) or v_role not in ('owner','technician') then raise exception 'Tidak punya akses teknisi ke pekerjaan ini.'; end if;
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
end; $function$
;
CREATE OR REPLACE FUNCTION private.decide_stock_qc(_stock_item_id uuid, _decision text, _notes text, _serial_number text DEFAULT NULL::text, _supplier_barcode text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid:=(select auth.uid()); v_stock public.stock_items%rowtype; v_role text; v_repair_status text;
begin
  select role into v_role from public.profiles where id=v_uid;
  select * into v_stock from public.stock_items where id=_stock_item_id for update;
  if not found or not private.can_access_branch(v_stock.branch_id) or not private.is_central_branch(v_stock.branch_id) or v_role not in ('owner','technician') then raise exception 'Tidak punya akses teknisi ke unit ini.'; end if;
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
end; $function$
;
CREATE OR REPLACE FUNCTION private.finish_stock_repair(_repair_id uuid, _resolution text, _labor_cost numeric DEFAULT 0)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid:=(select auth.uid()); v_job public.stock_repairs%rowtype; v_role text;
begin
  select role into v_role from public.profiles where id=v_uid;
  select * into v_job from public.stock_repairs where id=_repair_id for update;
  if not found or not private.can_access_branch(v_job.branch_id) or not private.is_central_branch(v_job.branch_id) or v_role not in ('owner','technician') then raise exception 'Tidak punya akses teknisi ke pekerjaan ini.'; end if;
  if v_job.status<>'repairing' then raise exception 'Pekerjaan harus berstatus sedang diperbaiki.'; end if;
  if coalesce(_labor_cost,0)<0 then raise exception 'Biaya repair tidak boleh negatif.'; end if;
  update public.stock_repairs set status='pending_final_qc',resolution=coalesce(trim(_resolution),''),labor_cost=labor_cost+coalesce(_labor_cost,0),technician_id=v_uid,updated_at=now() where id=_repair_id;
  update public.stock_items set status='pending_qc',qc_stage='final' where id=v_job.stock_item_id;
  if coalesce(_labor_cost,0)>0 then
    insert into public.cash_transactions(organization_id,branch_id,direction,category,amount,description,source_type,source_id,created_by)
      values(v_job.organization_id,v_job.branch_id,'expense','Biaya repair stok',_labor_cost,'Ongkos perbaikan laptop '||left(v_job.stock_item_id::text,8),'stock_repair',v_job.id,v_uid);
  end if;
end; $function$
;
CREATE OR REPLACE FUNCTION private.receive_stock_batch_financial(_branch_id uuid, _product_id uuid, _new_product jsonb, _supplier_name text, _supplier_phone text, _invoice_number text, _quantity integer, _total_amount numeric, _amount_paid numeric, _due_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid()); v_org uuid; v_product_id uuid := _product_id; v_supplier_id uuid;
  v_supplier text := trim(coalesce(_supplier_name,'')); v_batch uuid; v_sku text; v_product_image text;
  v_invoice_total numeric := coalesce(_total_amount,0)*coalesce(_quantity,0);
begin
  select organization_id into v_org from public.profiles where id=v_uid and role in ('owner','operator');
  if v_org is null or not private.can_access_branch(_branch_id) then raise exception 'Tidak punya akses penerimaan untuk cabang ini.'; end if;
  if _quantity is null or _quantity<1 or _quantity>500 then raise exception 'Jumlah unit harus antara 1 dan 500.'; end if;
  if _total_amount is null or _total_amount<0 or _amount_paid is null or _amount_paid<0 or _amount_paid>v_invoice_total then raise exception 'Pembayaran tidak boleh melebihi jumlah unit dikali harga modal.'; end if;
  if _amount_paid<v_invoice_total and v_invoice_total>0 and _due_date is null then raise exception 'Tanggal jatuh tempo wajib untuk pembelian kredit.'; end if;
  if v_supplier='' then raise exception 'Supplier wajib dipilih atau dibuat.'; end if;
  insert into public.suppliers(organization_id,name,initials,phone)
  values(v_org,v_supplier,private.supplier_initials(v_supplier),coalesce(trim(_supplier_phone),''))
  on conflict(organization_id,name) do update set phone=case when excluded.phone<>'' then excluded.phone else suppliers.phone end
  returning id into v_supplier_id;
  if v_product_id is null then
    if jsonb_typeof(_new_product)<>'object' or coalesce(trim(_new_product->>'name'),'')='' then raise exception 'Nama barang baru wajib diisi.'; end if;
    v_product_image:=coalesce(trim(_new_product->>'image_path'),'');
    if v_product_image <> '' and v_product_image not like v_org::text||'/products/%' then raise exception 'Foto produk baru wajib diunggah.'; end if;
    v_sku:=coalesce(nullif(trim(_new_product->>'sku'),''),'DL-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)));
    insert into public.products(organization_id,sku,name,brand,model,category,cost_price,retail_price,reseller_price,warranty_months,image_path)
    values(v_org,v_sku,trim(_new_product->>'name'),coalesce(trim(_new_product->>'brand'),''),coalesce(trim(_new_product->>'model'),''),coalesce(nullif(trim(_new_product->>'category'),''),'Laptop'),_total_amount,coalesce(nullif(_new_product->>'retail_price','')::numeric,0),coalesce(nullif(_new_product->>'reseller_price','')::numeric,0),coalesce(nullif(_new_product->>'warranty_months','')::integer,12),v_product_image)
    returning id into v_product_id;
  else
    select image_path into v_product_image from public.products where id=v_product_id and organization_id=v_org;

  end if;
  v_batch:=public.receive_stock_batch(_branch_id,v_product_id,v_supplier,_quantity);
  update public.intake_batches set supplier_id=v_supplier_id,invoice_number=coalesce(trim(_invoice_number),''),unit_cost=_total_amount,total_amount=v_invoice_total,amount_paid=_amount_paid,due_date=case when _amount_paid<v_invoice_total then _due_date else null end where id=v_batch;
  update public.stock_items set supplier_id=v_supplier_id where intake_batch_id=v_batch;
  if _amount_paid>0 then insert into public.cash_transactions(organization_id,branch_id,direction,category,amount,description,source_type,source_id,supplier_id,created_by)
    values(v_org,_branch_id,'expense','Pembayaran pembelian',_amount_paid,'Pembayaran awal batch '||left(v_batch::text,8),'intake_batch',v_batch,v_supplier_id,v_uid); end if;
  return v_batch;
end;
$function$
;
create policy central_suppliers on public.suppliers as restrictive to authenticated using(private.is_owner(organization_id)) with check(private.is_owner(organization_id));
CREATE OR REPLACE FUNCTION private.set_product_image(_product_id uuid, _image_path text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_org uuid; v_user_org uuid; v_role text;
begin
  select organization_id into v_org from public.products where id=_product_id;
  select organization_id,role into v_user_org,v_role from public.profiles where id=auth.uid();
  if v_org is null or v_org<>v_user_org or v_role not in ('owner','operator') then raise exception 'Tidak punya akses untuk mengubah foto produk.'; end if;
  if _image_path is null or _image_path not like v_org::text||'/products/%' then raise exception 'Lokasi foto produk tidak valid.'; end if;
  if v_role = 'operator' and not exists (
    select 1 from public.stock_items s join public.profiles p on p.branch_id=s.branch_id and p.organization_id=s.organization_id
    where p.id=(select auth.uid()) and s.product_id=_product_id
  ) then raise exception 'Produk belum tercatat di cabang Anda.'; end if;
  update public.products set image_path=_image_path where id=_product_id and organization_id=v_org;
end;
$function$
;
