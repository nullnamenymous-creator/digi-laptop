alter table public.sales add column if not exists request_id uuid;
create unique index if not exists sales_org_request_id_unique on public.sales(organization_id,request_id) where request_id is not null;
create or replace function private.create_sale_with_request(_request_id uuid,_branch_id uuid,_customer_name text,_customer_type text,_payment_method text,_lines jsonb,_customer_id uuid,_paid_amount numeric,_due_date date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_existing uuid; v_sale uuid; v_line jsonb; v_expected numeric; v_current numeric;
begin
 if _request_id is null then raise exception 'ID transaksi tidak valid.'; end if;
 select organization_id into v_org from public.profiles where id=(select auth.uid()) and role in ('owner','operator');
 if v_org is null or not private.can_operate_branch(_branch_id) then raise exception 'Tidak punya akses kasir cabang ini.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_org::text||':'||_request_id::text,0));
 select id into v_existing from public.sales where organization_id=v_org and request_id=_request_id;
 if v_existing is not null then return v_existing; end if;
 if jsonb_typeof(_lines)<>'array' or jsonb_array_length(_lines)=0 then raise exception 'Keranjang masih kosong.'; end if;
 for v_line in select value from jsonb_array_elements(_lines) loop
  v_expected:=nullif(v_line->>'expected_price','')::numeric;
  if v_expected is not null then
   select case when _customer_type='reseller' then reseller_price else retail_price end into v_current from public.products where id=(v_line->>'product_id')::uuid and organization_id=v_org;
   if v_current is null or v_current<>v_expected then raise exception 'Harga produk berubah saat perangkat offline. Periksa ulang harga sebelum mengirim transaksi.'; end if;
  end if;
 end loop;
 v_sale:=private.create_sale_with_terms(_branch_id,_customer_name,_customer_type,_payment_method,_lines,_customer_id,_paid_amount,_due_date);
 update public.sales set request_id=_request_id where id=v_sale;
 return v_sale;
end; $$;
revoke all on function private.create_sale_with_request(uuid,uuid,text,text,text,jsonb,uuid,numeric,date) from public,anon,authenticated;
grant execute on function private.create_sale_with_request(uuid,uuid,text,text,text,jsonb,uuid,numeric,date) to authenticated;
create or replace function public.create_sale_with_request(_request_id uuid,_branch_id uuid,_customer_name text,_customer_type text,_payment_method text,_lines jsonb,_customer_id uuid,_paid_amount numeric,_due_date date)
returns uuid language sql security invoker set search_path = '' as $$ select private.create_sale_with_request(_request_id,_branch_id,_customer_name,_customer_type,_payment_method,_lines,_customer_id,_paid_amount,_due_date) $$;
revoke all on function public.create_sale_with_request(uuid,uuid,text,text,text,jsonb,uuid,numeric,date) from public,anon;
grant execute on function public.create_sale_with_request(uuid,uuid,text,text,text,jsonb,uuid,numeric,date) to authenticated;

create table if not exists public.warranty_claims (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 branch_id uuid not null references public.branches(id), stock_item_id uuid not null references public.stock_items(id), claim_number text not null,
 customer_name text not null, customer_phone text not null, customer_email text not null default '', issue text not null,
 status text not null default 'submitted' check(status in ('submitted','reviewing','approved','rejected','resolved')),
 staff_note text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,claim_number)
);
create index if not exists warranty_claims_branch_date_idx on public.warranty_claims(branch_id,created_at desc);
create index if not exists warranty_claims_stock_item_idx on public.warranty_claims(stock_item_id,created_at desc);
alter table public.warranty_claims enable row level security;
grant select,update on public.warranty_claims to authenticated;
drop policy if exists warranty_claims_read_team on public.warranty_claims;
create policy warranty_claims_read_team on public.warranty_claims for select to authenticated using(private.can_operate_branch(branch_id));
drop policy if exists warranty_claims_update_team on public.warranty_claims;
create policy warranty_claims_update_team on public.warranty_claims for update to authenticated using(private.can_operate_branch(branch_id)) with check(private.can_operate_branch(branch_id));
create or replace function public.submit_warranty_claim(_code text,_customer_name text,_customer_phone text,_customer_email text,_issue text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_item public.stock_items%rowtype; v_claim text; v_phone text:=regexp_replace(coalesce(_customer_phone,''),'[^0-9+]','','g');
begin
 if length(btrim(coalesce(_customer_name,'')))<2 or length(btrim(coalesce(_customer_name,'')))>120 then raise exception 'Nama pelanggan harus 2–120 karakter.'; end if;
 if length(v_phone)<8 or length(v_phone)>24 then raise exception 'Nomor telepon tidak valid.'; end if;
 if length(btrim(coalesce(_issue,'')))<10 or length(btrim(coalesce(_issue,'')))>1200 then raise exception 'Jelaskan masalah dalam 10–1200 karakter.'; end if;
 if length(btrim(coalesce(_code,'')))<3 or length(btrim(_code))>100 then raise exception 'Barcode atau nomor seri tidak valid.'; end if;
 select id into v_org from public.organizations order by created_at limit 1;
 if v_org is null then raise exception 'Data toko tidak tersedia.'; end if;
 select * into v_item from public.stock_items where organization_id=v_org and (lower(barcode)=lower(btrim(_code)) or lower(supplier_barcode)=lower(btrim(_code)) or lower(serial_number)=lower(btrim(_code))) order by case when lower(barcode)=lower(btrim(_code)) then 0 else 1 end limit 1;
 if not found or v_item.status<>'sold' or v_item.warranty_until is null or v_item.warranty_until<current_date then raise exception 'Unit tidak ditemukan, belum terjual, atau masa garansinya sudah berakhir.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_item.id::text||':'||v_phone,0));
 if exists(select 1 from public.warranty_claims where stock_item_id=v_item.id and customer_phone=v_phone and created_at>now()-interval '12 hours') then raise exception 'Klaim untuk unit ini baru saja diterima. Hubungi toko untuk menanyakan statusnya.'; end if;
 v_claim:='WG-'||to_char(now() at time zone 'Asia/Jakarta','YYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
 insert into public.warranty_claims(organization_id,branch_id,stock_item_id,claim_number,customer_name,customer_phone,customer_email,issue) values(v_org,v_item.branch_id,v_item.id,v_claim,btrim(_customer_name),v_phone,left(btrim(coalesce(_customer_email,'')),254),btrim(_issue));
 return v_claim;
end; $$;
revoke all on function public.submit_warranty_claim(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_warranty_claim(text,text,text,text,text) to anon,authenticated;

create table if not exists public.promotions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 title text not null check(length(btrim(title)) between 2 and 120), description text not null default '', cta_label text not null default 'Lihat katalog',
 cta_url text not null default '/catalog', starts_at date, ends_at date, is_active boolean not null default true, display_order integer not null default 0,
 created_at timestamptz not null default now(), check(ends_at is null or starts_at is null or ends_at>=starts_at)
);
create index if not exists promotions_public_order_idx on public.promotions(organization_id,is_active,display_order);
alter table public.promotions enable row level security;
grant select,insert,update,delete on public.promotions to authenticated;
grant select on public.promotions to anon;
drop policy if exists promotions_public_active on public.promotions;
create policy promotions_public_active on public.promotions for select to anon,authenticated using(is_active and (starts_at is null or starts_at<=current_date) and (ends_at is null or ends_at>=current_date));
drop policy if exists promotions_owner_manage on public.promotions;
create policy promotions_owner_manage on public.promotions for all to authenticated using(private.is_owner(organization_id)) with check(private.is_owner(organization_id));
