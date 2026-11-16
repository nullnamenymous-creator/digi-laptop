begin;

alter table public.products add column if not exists catalog_discount numeric(14,2) not null default 0;
alter table public.products drop constraint if exists products_catalog_discount_valid;
alter table public.products add constraint products_catalog_discount_valid
  check (catalog_discount = 0 or (catalog_discount > 0 and catalog_discount < retail_price
    and catalog_discount = trunc(catalog_discount)));

create or replace function private.effective_retail_price(p public.products)
returns numeric language sql immutable set search_path = '' as $price$
  select p.retail_price - case when p.is_public then p.catalog_discount else 0 end
$price$;
revoke all on function private.effective_retail_price(public.products) from public, anon, authenticated;

create or replace function public.customer_catalog_promotions()
returns table(
  name text, brand text, model text, retail_price numeric, image_path text, phone text,
  description text, specifications jsonb, warranty_months integer, gallery_paths text[], catalog_discount numeric
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
    p.warranty_months, p.gallery_paths, p.catalog_discount
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

revoke all on function public.customer_catalog_promotions() from public;
grant execute on function public.customer_catalog_promotions() to anon, authenticated;

create or replace function private.create_sale(_branch_id uuid, _customer_name text, _customer_type text, _payment_method text, _lines jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_org uuid; v_sale uuid := gen_random_uuid(); v_total numeric(14,2) := 0;
  v_receipt text := 'DL-' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD-HH24MISS') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,5));
  v_line jsonb; v_product public.products%rowtype; v_stock public.stock_items%rowtype; v_qty integer; v_price numeric(14,2); v_left integer; v_take integer;
begin
  select organization_id into v_org from public.profiles where id = v_uid;
  if v_org is null or not private.can_access_branch(_branch_id) then raise exception 'Tidak punya akses ke cabang ini.'; end if;
  if _customer_type not in ('end_user','reseller') then raise exception 'Jenis harga tidak valid.'; end if;
  if _payment_method not in ('cash','transfer','qris','debit','other') then raise exception 'Metode pembayaran tidak valid.'; end if;
  if jsonb_typeof(_lines) <> 'array' or jsonb_array_length(_lines) = 0 then raise exception 'Keranjang masih kosong.'; end if;
  for v_line in select value from jsonb_array_elements(_lines) order by value->>'product_id' loop
    v_qty := (v_line->>'quantity')::integer;
    if v_qty < 1 then raise exception 'Jumlah produk tidak valid.'; end if;
    select * into v_product from public.products where id = (v_line->>'product_id')::uuid and organization_id = v_org for share;
    if not found then raise exception 'Produk tidak ditemukan.'; end if;
    v_price := case when _customer_type = 'reseller' then v_product.reseller_price else private.effective_retail_price(v_product) end;
    select coalesce(sum(quantity),0)::integer into v_left from public.stock_items where branch_id = _branch_id and product_id = v_product.id and status = 'available';
    if v_left < v_qty then raise exception 'Stok tidak cukup untuk %.', v_product.name; end if;
    v_total := v_total + v_price * v_qty;
  end loop;
  insert into public.sales(id, organization_id, branch_id, receipt_number, customer_name, customer_type, payment_method, total, cashier_id)
    values (v_sale, v_org, _branch_id, v_receipt, coalesce(_customer_name,''), _customer_type, _payment_method, v_total, v_uid);
  for v_line in select value from jsonb_array_elements(_lines) order by value->>'product_id' loop
    v_qty := (v_line->>'quantity')::integer;
    select * into v_product from public.products where id = (v_line->>'product_id')::uuid and organization_id = v_org;
    v_price := case when _customer_type = 'reseller' then v_product.reseller_price else private.effective_retail_price(v_product) end;
    v_left := v_qty;
    for v_stock in select * from public.stock_items where branch_id = _branch_id and product_id = v_product.id and status = 'available' order by created_at for update loop
      exit when v_left = 0;
      v_take := least(v_left, v_stock.quantity);
      update public.stock_items set quantity = quantity - v_take, status = case when quantity - v_take = 0 then 'sold' else status end,
        warranty_until = case when v_product.warranty_months > 0 then (current_date + make_interval(months => v_product.warranty_months))::date else null end
        where id = v_stock.id;
      insert into public.stock_movements(organization_id, branch_id, product_id, stock_item_id, movement_type, quantity, reference, created_by)
      values (v_org, _branch_id, v_product.id, v_stock.id, 'sale', -v_take, v_receipt, v_uid);
      insert into public.sale_items(sale_id, product_id, stock_item_id, product_name, quantity, unit_price, line_total)
        values (v_sale, v_product.id, v_stock.id, v_product.name, v_take, v_price, v_price * v_take);
      v_left := v_left - v_take;
    end loop;
    if v_left > 0 then raise exception 'Stok berubah saat transaksi diproses. Muat ulang kasir dan coba lagi.'; end if;
  end loop;
  return v_sale;
end;
$$;

revoke all on function private.create_sale(uuid,text,text,text,jsonb) from public, anon, authenticated;

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
  for v_line in select value from jsonb_array_elements(_lines) order by value->>'product_id' loop
    select case when v_type='reseller' then reseller_price else private.effective_retail_price(p) end into v_current from public.products p where p.id=(v_line->>'product_id')::uuid and p.organization_id=v_org for share;
    if not found or v_current is distinct from (v_line->>'expected_price')::numeric then raise exception 'Harga produk berubah. Muat ulang kasir sebelum menyimpan transaksi.'; end if;
  end loop;
  v_sale:=private.create_sale_with_terms(_branch_id,_customer_name,v_type,_payment_method,_lines,_customer_id,_paid_amount,_due_date);
  update public.sales set request_id=_request_id where id=v_sale;
  return v_sale;
end; $$;

revoke all on function private.create_sale_with_request(uuid,uuid,text,text,text,jsonb,uuid,numeric,date) from public, anon, authenticated;
grant execute on function private.create_sale_with_request(uuid,uuid,text,text,text,jsonb,uuid,numeric,date) to authenticated;

notify pgrst, 'reload schema';

commit;
