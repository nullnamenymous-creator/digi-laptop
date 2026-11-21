begin;

alter table public.intake_batches add column if not exists bulk_laptop_intake boolean not null default false;

-- Laptop borongan is received before the individual models and unit costs are
-- known. A hidden placeholder keeps the existing stock foreign keys intact
-- until Admin Pusat identifies each barcode during QC.
create or replace function private.receive_bulk_laptop_batch(
  _branch_id uuid, _supplier_name text, _supplier_phone text, _quantity integer
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_supplier_id uuid;
  v_product_id uuid;
  v_batch uuid := gen_random_uuid();
  v_barcode text;
  v_item uuid;
  v_i integer;
  v_supplier text := btrim(coalesce(_supplier_name,''));
begin
  select organization_id into v_org from public.profiles
    where id=v_uid and role in ('owner','central_admin');
  if v_org is null or not private.is_central_branch(_branch_id) or not private.can_access_branch(_branch_id) then
    raise exception 'Penerimaan laptop borongan hanya dapat dicatat Pemilik/Admin Pusat di Cabang Pusat.';
  end if;
  if _quantity is null or _quantity not between 1 and 500 then raise exception 'Jumlah laptop harus antara 1 dan 500.'; end if;
  if v_supplier='' then raise exception 'Nama supplier wajib diisi.'; end if;

  insert into public.suppliers(organization_id,name,initials,phone)
    values(v_org,v_supplier,private.supplier_initials(v_supplier),btrim(coalesce(_supplier_phone,'')))
    on conflict(organization_id,name) do update
      set phone=case when excluded.phone<>'' then excluded.phone else suppliers.phone end
    returning id into v_supplier_id;

  insert into public.products(organization_id,sku,name,brand,model,category,cost_price,retail_price,reseller_price,warranty_months,image_path,specifications,archived_at)
    values(v_org,'DL-BORONGAN-UNASSIGNED','Laptop belum QC','','','Laptop',0,0,0,0,'','{}'::jsonb,now())
    on conflict(organization_id,sku) do update set name=excluded.name
    returning id into v_product_id;

  insert into public.intake_batches(id,organization_id,branch_id,product_id,supplier,supplier_id,invoice_number,unit_count,unit_cost,total_amount,amount_paid,due_date,bulk_laptop_intake,created_by)
    values(v_batch,v_org,_branch_id,v_product_id,v_supplier,v_supplier_id,'',_quantity,0,0,0,null,true,v_uid);

  for v_i in 1.._quantity loop
    v_barcode:='DL-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
    insert into public.stock_items(organization_id,branch_id,product_id,barcode,supplier,supplier_id,quantity,status,intake_batch_id,qc_stage,acquisition_cost,created_by)
      values(v_org,_branch_id,v_product_id,v_barcode,v_supplier,v_supplier_id,1,'pending_qc',v_batch,'initial',0,v_uid)
      returning id into v_item;
    insert into public.stock_movements(organization_id,branch_id,product_id,stock_item_id,movement_type,quantity,reference,note,created_by)
      values(v_org,_branch_id,v_product_id,v_item,'receive',1,v_barcode,'Laptop borongan menunggu QC · batch '||left(v_batch::text,8),v_uid);
  end loop;
  return v_batch;
end;
$$;
revoke all on function private.receive_bulk_laptop_batch(uuid,text,text,integer) from public,anon;
grant execute on function private.receive_bulk_laptop_batch(uuid,text,text,integer) to authenticated;
create or replace function public.receive_bulk_laptop_batch(_branch_id uuid,_supplier_name text,_supplier_phone text,_quantity integer)
returns uuid language sql security invoker set search_path = '' as $$
  select private.receive_bulk_laptop_batch(_branch_id,_supplier_name,_supplier_phone,_quantity);
$$;
revoke all on function public.receive_bulk_laptop_batch(uuid,text,text,integer) from public,anon;
grant execute on function public.receive_bulk_laptop_batch(uuid,text,text,integer) to authenticated;

-- Admin Pusat records each mixed-model unit and its cash cost. The batch's
-- purchase expense is kept as one ledger row and recalculated idempotently.
create or replace function private.record_bulk_laptop_qc(
  _stock_item_id uuid,
  _product_id uuid,
  _new_product jsonb,
  _unit_cost numeric,
  _decision text,
  _notes text,
  _serial_number text default null,
  _supplier_barcode text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.profiles%rowtype;
  v_stock public.stock_items%rowtype;
  v_product_id uuid := _product_id;
  v_batch uuid;
  v_batch_total numeric;
  v_repair_status text;
  v_tx uuid;
  v_name text;
  v_sku text;
  v_image text;
begin
  select * into v_profile from public.profiles where id=v_uid;
  select * into v_stock from public.stock_items where id=_stock_item_id for update;
  if not found or v_profile.organization_id is distinct from v_stock.organization_id
    or v_profile.role not in ('owner','central_admin')
    or not private.is_central_branch(v_stock.branch_id) or not private.can_access_branch(v_stock.branch_id) then
    raise exception 'Hanya Pemilik/Admin Pusat yang boleh melakukan QC barang borongan di Cabang Pusat.';
  end if;
  if v_stock.status<>'pending_qc' then raise exception 'Unit tidak berada dalam antrean QC.'; end if;
  if v_stock.intake_batch_id is null or not exists(select 1 from public.intake_batches b where b.id=v_stock.intake_batch_id and b.bulk_laptop_intake) then
    raise exception 'Unit ini bukan bagian dari penerimaan laptop borongan.';
  end if;
  if _unit_cost is null or _unit_cost<=0 then raise exception 'Modal beli per unit wajib lebih dari nol.'; end if;
  if _decision not in ('available','repair_needed','waiting_parts','not_sellable','scrap') then raise exception 'Keputusan QC tidak valid.'; end if;
  if v_stock.qc_stage='final' and _decision='waiting_parts' then raise exception 'QC akhir harus meluluskan unit, mengembalikannya ke repair, atau mengarantina.'; end if;
  if length(btrim(coalesce(_notes,'')))<3 then raise exception 'Isi spesifikasi ringkas dan kondisi/minus unit.'; end if;

  if _new_product is not null then
    v_name:=btrim(coalesce(_new_product->>'name',''));
    if v_name='' or btrim(coalesce(_new_product->>'brand',''))='' or btrim(coalesce(_new_product->>'model',''))='' then
      raise exception 'Nama, merek, dan model laptop wajib diisi.';
    end if;
    v_image:=btrim(coalesce(_new_product->>'image_path',''));
    if v_image not like v_stock.organization_id::text||'/products/%' then raise exception 'Foto produk model baru wajib diunggah.'; end if;
    v_sku:='DL-QC-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
    insert into public.products(organization_id,sku,name,brand,model,category,cost_price,retail_price,reseller_price,warranty_months,image_path,specifications,is_public)
      values(v_stock.organization_id,v_sku,v_name,btrim(_new_product->>'brand'),btrim(_new_product->>'model'),'Laptop',_unit_cost,0,0,coalesce(nullif(_new_product->>'warranty_months','')::integer,1),v_image,coalesce(_new_product->'specifications','{}'::jsonb),false)
      returning id into v_product_id;
  else
    if v_product_id is null or not exists(select 1 from public.products p where p.id=v_product_id and p.organization_id=v_stock.organization_id and lower(p.category)='laptop' and p.archived_at is null) then
      raise exception 'Pilih model laptop yang terdaftar atau tambahkan model baru.';
    end if;
  end if;

  v_batch:=v_stock.intake_batch_id;
  update public.stock_items set product_id=v_product_id,acquisition_cost=_unit_cost,
    status=_decision,qc_notes=btrim(_notes),qc_by=v_uid,qc_at=now(),
    serial_number=coalesce(nullif(btrim(_serial_number),''),serial_number),
    supplier_barcode=coalesce(nullif(btrim(_supplier_barcode),''),supplier_barcode)
    where id=v_stock.id;
  update public.stock_movements set product_id=v_product_id where stock_item_id=v_stock.id and movement_type='receive';

  if _decision in ('repair_needed','waiting_parts') then
    v_repair_status:=_decision;
    if v_stock.qc_stage='final' then
      update public.stock_repairs set status=v_repair_status,issue=btrim(_notes),resolution='',technician_id=null,updated_at=now()
        where stock_item_id=v_stock.id and status='pending_final_qc';
    else
      insert into public.stock_repairs(organization_id,branch_id,stock_item_id,issue,status,technician_id)
        values(v_stock.organization_id,v_stock.branch_id,v_stock.id,btrim(_notes),v_repair_status,null);
    end if;
  end if;

  select coalesce(sum(acquisition_cost),0) into v_batch_total from public.stock_items where intake_batch_id=v_batch;
  update public.intake_batches set total_amount=v_batch_total,amount_paid=v_batch_total,due_date=null
    where id=v_batch and organization_id=v_stock.organization_id;
  select id into v_tx from public.cash_transactions where organization_id=v_stock.organization_id and source_type='intake_batch' and source_id=v_batch and direction='expense' for update;
  if v_batch_total>0 then
    if v_tx is null then
      insert into public.cash_transactions(organization_id,branch_id,direction,category,amount,description,source_type,source_id,supplier_id,created_by)
        select v_stock.organization_id,v_stock.branch_id,'expense','Pembelian laptop tunai',v_batch_total,
          'Pembelian laptop borongan · batch '||left(v_batch::text,8),'intake_batch',v_batch,b.supplier_id,v_uid
        from public.intake_batches b where b.id=v_batch returning id into v_tx;
    else
      update public.cash_transactions set amount=v_batch_total,category='Pembelian laptop tunai',description='Pembelian laptop borongan · batch '||left(v_batch::text,8) where id=v_tx;
    end if;
  elsif v_tx is not null then
    delete from public.cash_transactions where id=v_tx;
  end if;

  if v_stock.qc_stage='final' and _decision not in ('repair_needed','waiting_parts') then
    update public.stock_repairs set status=case when _decision='available' then 'completed' else 'not_sellable' end,
      resolution=btrim(_notes),updated_at=now()
      where stock_item_id=v_stock.id and status='pending_final_qc';
  end if;
end;
$$;
revoke all on function private.record_bulk_laptop_qc(uuid,uuid,jsonb,numeric,text,text,text,text) from public,anon;
grant execute on function private.record_bulk_laptop_qc(uuid,uuid,jsonb,numeric,text,text,text,text) to authenticated;
create or replace function public.record_bulk_laptop_qc(_stock_item_id uuid,_product_id uuid,_new_product jsonb,_unit_cost numeric,_decision text,_notes text,_serial_number text default null,_supplier_barcode text default null)
returns void language sql security invoker set search_path = '' as $$
  select private.record_bulk_laptop_qc(_stock_item_id,_product_id,_new_product,_unit_cost,_decision,_notes,_serial_number,_supplier_barcode);
$$;
revoke all on function public.record_bulk_laptop_qc(uuid,uuid,jsonb,numeric,text,text,text,text) from public,anon;
grant execute on function public.record_bulk_laptop_qc(uuid,uuid,jsonb,numeric,text,text,text,text) to authenticated;

commit;
