alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner','operator','technician','investor','central_admin'));

create function private.is_central_admin(_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    join public.branches b on b.id = p.branch_id and b.organization_id = p.organization_id
    where p.id = (select auth.uid()) and p.organization_id = _org
      and p.role = 'central_admin' and b.is_central and b.is_active
  )
$$;
revoke all on function private.is_central_admin(uuid) from public, anon;
grant execute on function private.is_central_admin(uuid) to authenticated;

create function private.validate_central_admin_branch()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.role = 'central_admin' and not exists (
    select 1 from public.branches b where b.id = new.branch_id
      and b.organization_id = new.organization_id and b.is_central and b.is_active
  ) then raise exception 'Admin Pusat wajib ditugaskan ke Cabang Pusat.'; end if;
  return new;
end;
$$;
create trigger validate_central_admin_branch before insert or update of role, branch_id, organization_id
on public.profiles for each row execute function private.validate_central_admin_branch();

update public.profiles p set role = 'central_admin' from public.branches b
where p.role = 'operator' and p.branch_id = b.id and p.organization_id = b.organization_id
  and b.is_central and b.is_active;

-- Allow viewing destination names while keeping operational data branch-scoped.
alter policy own_branch_directory on public.branches
  using (private.can_access_branch(id) or (is_active and private.is_central_admin(organization_id)));
create policy central_admin_intake_read on public.intake_batches for select to authenticated
  using (private.is_central_admin(organization_id) and private.is_central_branch(branch_id) and private.can_access_branch(branch_id));
create policy central_admin_supplier_read on public.suppliers for select to authenticated
  using (private.is_central_admin(organization_id));
alter policy central_suppliers on public.suppliers
  using (private.is_owner(organization_id) or private.is_central_admin(organization_id))
  with check (private.is_owner(organization_id));
create policy central_admin_transfer_read on public.stock_transfers for select to authenticated
  using (private.is_central_admin(organization_id) and private.is_central_branch(source_branch_id));
create policy central_admin_transfer_items_read on public.stock_transfer_items for select to authenticated
  using (exists (select 1 from public.stock_transfers t where t.id = transfer_id
    and private.is_central_admin(t.organization_id) and private.is_central_branch(t.source_branch_id)));

create policy central_admin_product_insert on public.products for insert to authenticated
  with check (private.is_central_admin(organization_id));
create policy central_admin_product_update on public.products for update to authenticated
  using (private.is_central_admin(organization_id)) with check (private.is_central_admin(organization_id));
create function private.limit_central_admin_product_changes()
returns trigger language plpgsql set search_path = '' as $$
begin
  if private.is_central_admin(new.organization_id) then
    if tg_op = 'INSERT' then
      if new.retail_price <> 0 or new.reseller_price <> 0 or new.is_public then
        raise exception 'Harga jual dan publikasi katalog dikelola Pemilik.';
      end if;
    elsif (to_jsonb(new) - array['name','brand','model','description','specifications','image_path','gallery_paths','warranty_months','updated_at'])
          is distinct from (to_jsonb(old) - array['name','brand','model','description','specifications','image_path','gallery_paths','warranty_months','updated_at']) then
      raise exception 'Admin Pusat hanya dapat memperbarui identitas, spesifikasi, garansi dan foto produk.';
    end if;
  end if;
  return new;
end;
$$;
create trigger limit_central_admin_product_changes before insert or update on public.products
for each row execute function private.limit_central_admin_product_changes();

create policy central_admin_product_photo_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and (storage.foldername(name))[2] = 'products'
    and exists (select 1 from public.profiles p where p.id = (select auth.uid())
      and (storage.foldername(name))[1] = p.organization_id::text
      and private.is_central_admin(p.organization_id)));

create or replace function private.check_central_stock()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'stock_transfers' then
    if not (private.is_owner(new.organization_id) or private.is_central_admin(new.organization_id)) then
      raise exception 'Hanya Pemilik atau Admin Pusat yang boleh mengirim mutasi.';
    end if;
    if not private.is_central_branch(new.source_branch_id) then
      raise exception 'Mutasi stok hanya boleh berangkat dari Pusat.';
    end if;
  elsif not private.is_central_branch(new.branch_id) then
    raise exception 'Penerimaan dan stok awal hanya boleh dicatat di Pusat.';
  end if;
  return new;
end;
$$;

create or replace function private.check_sale_actor()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is not null then
    if private.is_central_branch(new.branch_id) then
      raise exception 'Cabang Pusat tidak melayani penjualan. Kirim stok ke cabang penjualan.';
    end if;
    if not private.can_operate_branch(new.branch_id) then
      raise exception 'Penjualan hanya dapat dicatat Pemilik atau Operator cabang.';
    end if;
  end if;
  return new;
end;
$$;
create or replace function private.receive_stock_batch(_branch_id uuid,_product_id uuid,_supplier text,_quantity integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid:=(select auth.uid()); v_org uuid; v_batch uuid:=gen_random_uuid(); v_barcode text; v_product public.products%rowtype; v_item uuid; v_i integer;
begin
  select organization_id into v_org from public.profiles where id=v_uid and (role in ('owner','operator') or private.is_central_admin(organization_id));
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
  select organization_id into v_org from public.profiles where id=v_uid and (role in ('owner','operator') or private.is_central_admin(organization_id));
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
    values(v_org,v_sku,trim(_new_product->>'name'),coalesce(trim(_new_product->>'brand'),''),coalesce(trim(_new_product->>'model'),''),coalesce(nullif(trim(_new_product->>'category'),''),'Laptop'),_total_amount,coalesce(nullif(_new_product->>'retail_price','')::numeric,0),coalesce(nullif(_new_product->>'reseller_price','')::numeric,0),coalesce(nullif(_new_product->>'warranty_months','')::integer,1),v_product_image)
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
create or replace function private.create_stock_transfer(
  _source_branch_id uuid,
  _destination_branch_id uuid,
  _items jsonb,
  _note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_role text;
  v_transfer_id uuid := gen_random_uuid();
  v_transfer_number text := 'MUT-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  v_line jsonb;
  v_stock public.stock_items%rowtype;
  v_product_category text;
  v_quantity integer;
  v_split boolean;
  v_count integer := 0;
  v_note text := left(btrim(coalesce(_note, '')), 1000);
begin
  select organization_id, role into v_org, v_role from public.profiles where id = v_uid;
  if v_org is null or (v_role <> 'owner' and not private.is_central_admin(v_org)) then
    raise exception 'Hanya pemilik atau operator yang dapat mengirim mutasi stok.';
  end if;
  if _source_branch_id is null or _destination_branch_id is null or _source_branch_id = _destination_branch_id then
    raise exception 'Pilih dua cabang yang berbeda.';
  end if;
  if not exists(select 1 from public.branches b where b.id = _source_branch_id and b.organization_id = v_org and b.is_active)
     or not exists(select 1 from public.branches b where b.id = _destination_branch_id and b.organization_id = v_org and b.is_active) then
    raise exception 'Cabang asal atau tujuan tidak aktif atau bukan milik toko ini.';
  end if;
  if v_role = 'operator' and not private.can_operate_branch(_source_branch_id) then
    raise exception 'Operator hanya dapat mengirim stok dari cabangnya sendiri.';
  end if;
  if _items is null or jsonb_typeof(_items) <> 'array' then
    raise exception 'Pilih 1 sampai 100 baris stok untuk dikirim.';
  end if;
  if jsonb_array_length(_items) < 1 or jsonb_array_length(_items) > 100 then
    raise exception 'Pilih 1 sampai 100 baris stok untuk dikirim.';
  end if;

  insert into public.stock_transfers(id, organization_id, transfer_number, source_branch_id, destination_branch_id, note, created_by)
  values(v_transfer_id, v_org, v_transfer_number, _source_branch_id, _destination_branch_id, v_note, v_uid);

  for v_line in select value from jsonb_array_elements(_items)
  loop
    if nullif(v_line->>'stock_item_id', '') is null or coalesce(v_line->>'quantity', '') !~ '^[0-9]+$' then
      raise exception 'Baris stok mutasi tidak valid.';
    end if;
    v_quantity := (v_line->>'quantity')::integer;
    if v_quantity < 1 then raise exception 'Jumlah mutasi minimal satu.'; end if;

    select si.* into v_stock
    from public.stock_items si
    join public.products p on p.id = si.product_id and p.organization_id = v_org
    where si.id = (v_line->>'stock_item_id')::uuid
      and si.organization_id = v_org and si.branch_id = _source_branch_id
      and si.status = 'available' and si.quantity >= v_quantity
    for update of si;
    if not found then raise exception 'Stok berubah atau jumlahnya tidak cukup. Muat ulang daftar stok.'; end if;
    select p.category into v_product_category from public.products p where p.id = v_stock.product_id;
    if lower(v_product_category) = 'laptop' and (v_quantity <> 1 or v_stock.quantity <> 1) then
      raise exception 'Laptop dimutasi satu unit per barcode.';
    end if;
    v_split := lower(v_product_category) <> 'laptop' and v_quantity < v_stock.quantity;

    insert into public.stock_transfer_items(
      organization_id, transfer_id, product_id, source_stock_item_id,
      source_barcode, quantity, unit_cost, split_lot
    ) values(
      v_org, v_transfer_id, v_stock.product_id, v_stock.id,
      v_stock.barcode, v_quantity, v_stock.acquisition_cost, v_split
    );

    update public.stock_items
    set quantity = case when lower(v_product_category) = 'laptop' or v_quantity = v_stock.quantity then 0 else quantity - v_quantity end,
        status = case when lower(v_product_category) = 'laptop' or v_quantity = v_stock.quantity then 'transferred' else status end
    where id = v_stock.id;

    insert into public.stock_movements(organization_id, branch_id, product_id, stock_item_id, movement_type, quantity, reference, note, created_by)
    values(v_org, _source_branch_id, v_stock.product_id, v_stock.id, 'transfer_out', -v_quantity,
      v_transfer_number, 'Mutasi ke ' || (select b.name from public.branches b where b.id = _destination_branch_id), v_uid);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('id', v_transfer_id, 'transfer_number', v_transfer_number, 'item_count', v_count, 'status', 'in_transit');
end;
$$;
create or replace function private.set_product_gallery(
  _product_id uuid, _cover text, _gallery text[], _previous_cover text, _previous_gallery text[]
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_product public.products%rowtype;
  v_org uuid;
  v_role text;
  v_branch uuid;
begin
  select organization_id, role, branch_id into v_org, v_role, v_branch
  from public.profiles where id = (select auth.uid());
  if v_org is null or (v_role not in ('owner', 'operator') and not private.is_central_admin(v_org)) then
    raise exception 'Tidak punya akses untuk mengubah foto produk.';
  end if;
  select * into v_product from public.products
  where id = _product_id and organization_id = v_org for update;
  if not found or (v_role = 'operator' and not exists (
    select 1 from public.stock_items s
    where s.organization_id = v_org and s.branch_id = v_branch and s.product_id = _product_id
  )) then
    raise exception 'Produk tidak tersedia untuk cabang Anda.';
  end if;
  if v_product.image_path is distinct from _previous_cover
     or v_product.gallery_paths is distinct from _previous_gallery then
    raise exception 'Foto sudah berubah. Muat ulang produk dan coba lagi.';
  end if;
  if _cover is null or _cover not like v_org::text || '/products/%'
     or _gallery is null or cardinality(_gallery) > 3 or exists (
       select 1 from unnest(_gallery) as photo(path)
       where path is null or path not like v_org::text || '/products/%'
     ) then
    raise exception 'Lokasi atau jumlah foto tidak valid.';
  end if;
  update public.products set image_path = _cover, gallery_paths = _gallery where id = _product_id;
end;
$$;
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
  if v_org is null or v_org<>v_user_org or (v_role not in ('owner','operator') and not private.is_central_admin(v_org)) then raise exception 'Tidak punya akses untuk mengubah foto produk.'; end if;
  if _image_path is null or _image_path not like v_org::text||'/products/%' then raise exception 'Lokasi foto produk tidak valid.'; end if;
  if v_role = 'operator' and not exists (
    select 1 from public.stock_items s join public.profiles p on p.branch_id=s.branch_id and p.organization_id=s.organization_id
    where p.id=(select auth.uid()) and s.product_id=_product_id
  ) then raise exception 'Produk belum tercatat di cabang Anda.'; end if;
  update public.products set image_path=_image_path where id=_product_id and organization_id=v_org;
end;
$function$
;
create or replace function public.customer_catalog()
returns table(name text,brand text,model text,retail_price numeric,image_path text,phone text)
language sql stable security definer set search_path='' as $portal$
 select p.name,p.brand,p.model,p.retail_price,p.image_path,o.phone
 from public.products p join public.organizations o on o.id=p.organization_id
 where o.id='1f232ccc-ec3a-425c-83fe-2ab3cc27a029' and p.is_public and p.retail_price>0
 and exists(select 1 from public.stock_items s join public.branches b on b.id=s.branch_id
 where s.product_id=p.id and s.organization_id=p.organization_id and b.is_active and not b.is_central and s.status='available' and s.quantity>0)
 order by p.name
$portal$;
create or replace function public.customer_catalog_details()
returns table(
  name text, brand text, model text, retail_price numeric, image_path text, phone text,
  description text, specifications jsonb, warranty_months integer
)
language sql stable security definer set search_path = '' as $catalog$
  select p.name, p.brand, p.model, p.retail_price, p.image_path, o.phone,
    p.description,
    jsonb_strip_nulls(jsonb_build_object(
      'processor', p.specifications ->> 'processor',
      'ram', p.specifications ->> 'ram',
      'storage', p.specifications ->> 'storage',
      'display', p.specifications ->> 'display',
      'graphics', p.specifications ->> 'graphics',
      'os', p.specifications ->> 'os'
    )),
    p.warranty_months
  from public.products p
  join public.organizations o on o.id = p.organization_id
  where o.id = '1f232ccc-ec3a-425c-83fe-2ab3cc27a029'
    and p.is_public and p.retail_price > 0
    and exists (
      select 1 from public.stock_items s
      join public.branches b on b.id = s.branch_id and b.organization_id = s.organization_id
      where s.product_id = p.id and s.organization_id = p.organization_id
        and b.is_active and not b.is_central and s.status = 'available' and s.quantity > 0
    )
  order by p.name
$catalog$;
create or replace function public.customer_catalog_gallery()
returns table(
  name text, brand text, model text, retail_price numeric, image_path text, phone text,
  description text, specifications jsonb, warranty_months integer, gallery_paths text[]
)
language sql stable security definer set search_path = '' as $catalog$
  select p.name, p.brand, p.model, p.retail_price, p.image_path, o.phone,
    p.description,
    jsonb_strip_nulls(jsonb_build_object(
      'processor', p.specifications ->> 'processor',
      'ram', p.specifications ->> 'ram',
      'storage', p.specifications ->> 'storage',
      'display', p.specifications ->> 'display',
      'graphics', p.specifications ->> 'graphics',
      'os', p.specifications ->> 'os'
    )),
    p.warranty_months, p.gallery_paths
  from public.products p
  join public.organizations o on o.id = p.organization_id
  where o.id = '1f232ccc-ec3a-425c-83fe-2ab3cc27a029'
    and p.is_public and p.retail_price > 0
    and exists (
      select 1 from public.stock_items s
      join public.branches b on b.id = s.branch_id and b.organization_id = s.organization_id
      where s.product_id = p.id and s.organization_id = p.organization_id
        and b.is_active and not b.is_central and s.status = 'available' and s.quantity > 0
    )
  order by p.name
$catalog$;
