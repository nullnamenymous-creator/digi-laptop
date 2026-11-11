alter table public.intake_batches add column if not exists unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0);
update public.intake_batches set unit_cost=total_amount/nullif(unit_count,0) where unit_cost=0 and total_amount>0 and unit_count>0;

create or replace function private.receive_stock_batch_financial(
  _branch_id uuid,
  _product_id uuid,
  _new_product jsonb,
  _supplier_name text,
  _supplier_phone text,
  _invoice_number text,
  _quantity integer,
  _total_amount numeric,
  _amount_paid numeric,
  _due_date date
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_product_id uuid := _product_id;
  v_supplier_id uuid;
  v_supplier text := trim(coalesce(_supplier_name,''));
  v_batch uuid;
  v_sku text;
  v_invoice_total numeric := coalesce(_total_amount,0) * coalesce(_quantity,0);
begin
  select organization_id into v_org from public.profiles where id=v_uid and role in ('owner','operator');
  if v_org is null or not private.can_access_branch(_branch_id) then raise exception 'Tidak punya akses penerimaan untuk cabang ini.'; end if;
  if _quantity is null or _quantity < 1 or _quantity > 500 then raise exception 'Jumlah unit harus antara 1 dan 500.'; end if;
  if _total_amount is null or _total_amount < 0 or _amount_paid is null or _amount_paid < 0 or _amount_paid > v_invoice_total then raise exception 'Pembayaran tidak boleh melebihi jumlah unit dikali harga modal.'; end if;
  if _amount_paid < v_invoice_total and v_invoice_total > 0 and _due_date is null then raise exception 'Tanggal jatuh tempo wajib untuk pembelian kredit.'; end if;
  if v_supplier = '' then raise exception 'Supplier wajib dipilih atau dibuat.'; end if;
  insert into public.suppliers(organization_id,name,initials,phone)
  values(v_org,v_supplier,private.supplier_initials(v_supplier),coalesce(trim(_supplier_phone),''))
  on conflict (organization_id,name) do update set phone=case when excluded.phone<>'' then excluded.phone else suppliers.phone end
  returning id into v_supplier_id;
  if v_product_id is null then
    if jsonb_typeof(_new_product)<>'object' or coalesce(trim(_new_product->>'name'),'')='' then raise exception 'Nama barang baru wajib diisi.'; end if;
    v_sku:=coalesce(nullif(trim(_new_product->>'sku'),''),'DL-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)));
    insert into public.products(organization_id,sku,name,brand,model,category,cost_price,retail_price,reseller_price,warranty_months)
    values(v_org,v_sku,trim(_new_product->>'name'),coalesce(trim(_new_product->>'brand'),''),coalesce(trim(_new_product->>'model'),''),coalesce(nullif(trim(_new_product->>'category'),''),'Laptop'),_total_amount,coalesce(nullif(_new_product->>'retail_price','')::numeric,0),coalesce(nullif(_new_product->>'reseller_price','')::numeric,0),coalesce(nullif(_new_product->>'warranty_months','')::integer,12)) returning id into v_product_id;
  end if;
  v_batch:=public.receive_stock_batch(_branch_id,v_product_id,v_supplier,_quantity);
  update public.intake_batches set supplier_id=v_supplier_id,invoice_number=coalesce(trim(_invoice_number),''),unit_cost=_total_amount,total_amount=v_invoice_total,amount_paid=_amount_paid,due_date=case when _amount_paid<v_invoice_total then _due_date else null end where id=v_batch;
  update public.stock_items set supplier_id=v_supplier_id where intake_batch_id=v_batch;
  if _amount_paid>0 then
    insert into public.cash_transactions(organization_id,branch_id,direction,category,amount,description,source_type,source_id,supplier_id,created_by)
    values(v_org,_branch_id,'expense','Pembayaran pembelian',_amount_paid,'Pembayaran awal batch '||left(v_batch::text,8),'intake_batch',v_batch,v_supplier_id,v_uid);
  end if;
  return v_batch;
end;
$$;
revoke all on function private.receive_stock_batch_financial(uuid,uuid,jsonb,text,text,text,integer,numeric,numeric,date) from public,anon;
grant execute on function private.receive_stock_batch_financial(uuid,uuid,jsonb,text,text,text,integer,numeric,numeric,date) to authenticated;
