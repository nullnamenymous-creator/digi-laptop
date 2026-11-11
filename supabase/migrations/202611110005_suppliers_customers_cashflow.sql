-- Partner records, supplier-coded labels, purchase terms and branch cash flow.
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  initials text not null default 'SUP',
  phone text not null default '',
  address text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (organization_id, name, phone)
);

create table if not exists public.cash_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  direction text not null check (direction in ('income','expense')),
  category text not null,
  amount numeric(14,2) not null check (amount > 0),
  description text not null default '',
  source_type text not null default 'manual',
  source_id uuid,
  customer_id uuid references public.customers(id),
  supplier_id uuid references public.suppliers(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.stock_items add column if not exists supplier_id uuid references public.suppliers(id);
alter table public.intake_batches add column if not exists supplier_id uuid references public.suppliers(id);
alter table public.intake_batches add column if not exists invoice_number text not null default '';
alter table public.intake_batches add column if not exists total_amount numeric(14,2) not null default 0 check (total_amount >= 0);
alter table public.intake_batches add column if not exists amount_paid numeric(14,2) not null default 0 check (amount_paid >= 0);
alter table public.intake_batches add column if not exists due_date date;
alter table public.sales add column if not exists customer_id uuid references public.customers(id);
alter table public.sales add column if not exists paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0);
alter table public.sales add column if not exists due_date date;

update public.sales set paid_amount = total where paid_amount = 0;

create or replace function private.supplier_initials(_name text)
returns text language sql immutable set search_path = '' as $$
  with words as (select regexp_split_to_array(trim(coalesce(_name,'')), '\s+') as parts)
  select coalesce(nullif(upper(case when cardinality(parts) > 1 then left(parts[1],1)||left(parts[2],1) else left(parts[1],2) end),''),'SUP') from words
$$;
revoke all on function private.supplier_initials(text) from public, anon, authenticated;

create or replace function private.receive_stock_batch(_branch_id uuid, _product_id uuid, _supplier text, _quantity integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid; v_batch uuid := gen_random_uuid(); v_i integer; v_barcode text; v_qc_required boolean; v_initials text;
begin
  select organization_id into v_org from public.profiles where id = v_uid and role in ('owner','operator');
  if v_org is null then raise exception 'Penerimaan barang hanya dapat dicatat pemilik atau operator.'; end if;
  if not exists (select 1 from public.branches where id = _branch_id and organization_id = v_org) then raise exception 'Cabang tidak ditemukan.'; end if;
  if not exists (select 1 from public.products where id = _product_id and organization_id = v_org) then raise exception 'Produk tidak ditemukan.'; end if;
  if _quantity is null or _quantity < 1 or _quantity > 500 then raise exception 'Jumlah penerimaan harus 1 sampai 500 unit.'; end if;
  select category = 'Laptop' into v_qc_required from public.products where id = _product_id and organization_id = v_org;
  v_initials := private.supplier_initials(_supplier);
  insert into public.intake_batches(id, organization_id, branch_id, product_id, supplier, unit_count, created_by)
    values(v_batch, v_org, _branch_id, _product_id, coalesce(trim(_supplier),''), _quantity, v_uid);
  for v_i in 1.._quantity loop
    v_barcode := v_initials || '-DL-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
    insert into public.stock_items(organization_id, branch_id, product_id, barcode, supplier, quantity, status, intake_batch_id, qc_stage, created_by)
      values(v_org, _branch_id, _product_id, v_barcode, coalesce(trim(_supplier),''), 1, case when v_qc_required then 'pending_qc' else 'available' end, v_batch, 'initial', v_uid);
    insert into public.stock_movements(organization_id, branch_id, product_id, stock_item_id, movement_type, quantity, reference, note, created_by)
      select v_org, _branch_id, _product_id, id, 'receive', 1, v_barcode, 'Batch ' || v_batch::text, v_uid from public.stock_items where organization_id = v_org and barcode = v_barcode;
  end loop;
  return v_batch;
end;
$$;
revoke all on function private.receive_stock_batch(uuid,uuid,text,integer) from public, anon;
grant execute on function private.receive_stock_batch(uuid,uuid,text,integer) to authenticated;

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
declare v_uid uuid := (select auth.uid()); v_org uuid; v_product_id uuid := _product_id; v_supplier_id uuid; v_supplier text := trim(coalesce(_supplier_name,'')); v_batch uuid; v_sku text;
begin
  select organization_id into v_org from public.profiles where id = v_uid and role in ('owner','operator');
  if v_org is null or not private.can_access_branch(_branch_id) then raise exception 'Tidak punya akses penerimaan untuk cabang ini.'; end if;
  if _amount_paid < 0 or _total_amount < 0 or _amount_paid > _total_amount then raise exception 'Jumlah dibayar harus antara nol dan total tagihan.'; end if;
  if _amount_paid < _total_amount and _total_amount > 0 and _due_date is null then raise exception 'Tanggal jatuh tempo wajib untuk pembelian kredit.'; end if;
  if v_supplier <> '' then
    insert into public.suppliers(organization_id,name,initials,phone)
    values(v_org,v_supplier,private.supplier_initials(v_supplier),coalesce(trim(_supplier_phone),''))
    on conflict (organization_id,name) do update set phone = case when excluded.phone <> '' then excluded.phone else suppliers.phone end
    returning id into v_supplier_id;
  end if;
  if v_product_id is null then
    if jsonb_typeof(_new_product) <> 'object' or coalesce(trim(_new_product->>'name'),'') = '' then raise exception 'Nama barang baru wajib diisi.'; end if;
    v_sku := coalesce(nullif(trim(_new_product->>'sku'),''),'DL-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)));
    insert into public.products(organization_id,sku,name,brand,model,category,cost_price,retail_price,reseller_price,warranty_months)
    values(v_org,v_sku,trim(_new_product->>'name'),coalesce(trim(_new_product->>'brand'),''),coalesce(trim(_new_product->>'model'),''),coalesce(nullif(trim(_new_product->>'category'),''),'Laptop'),coalesce(nullif(_new_product->>'cost_price','')::numeric,0),coalesce(nullif(_new_product->>'retail_price','')::numeric,0),coalesce(nullif(_new_product->>'reseller_price','')::numeric,0),coalesce(nullif(_new_product->>'warranty_months','')::integer,12)) returning id into v_product_id;
  end if;
  v_batch := public.receive_stock_batch(_branch_id,v_product_id,v_supplier,_quantity);
  update public.intake_batches set supplier_id=v_supplier_id, invoice_number=coalesce(trim(_invoice_number),''), total_amount=_total_amount, amount_paid=_amount_paid, due_date=case when _amount_paid < _total_amount then _due_date else null end where id=v_batch;
  update public.stock_items set supplier_id=v_supplier_id where intake_batch_id=v_batch;
  if _amount_paid > 0 then
    insert into public.cash_transactions(organization_id,branch_id,direction,category,amount,description,source_type,source_id,supplier_id,created_by)
    values(v_org,_branch_id,'expense','Pembayaran pembelian',_amount_paid,'Pembayaran awal batch '||left(v_batch::text,8),'intake_batch',v_batch,v_supplier_id,v_uid);
  end if;
  return v_batch;
end;
$$;
revoke all on function private.receive_stock_batch_financial(uuid,uuid,jsonb,text,text,text,integer,numeric,numeric,date) from public, anon;
grant execute on function private.receive_stock_batch_financial(uuid,uuid,jsonb,text,text,text,integer,numeric,numeric,date) to authenticated;
create or replace function public.receive_stock_batch_financial(_branch_id uuid,_product_id uuid,_new_product jsonb,_supplier_name text,_supplier_phone text,_invoice_number text,_quantity integer,_total_amount numeric,_amount_paid numeric,_due_date date)
returns uuid language sql security invoker set search_path = '' as $$ select private.receive_stock_batch_financial(_branch_id,_product_id,_new_product,_supplier_name,_supplier_phone,_invoice_number,_quantity,_total_amount,_amount_paid,_due_date) $$;
revoke all on function public.receive_stock_batch_financial(uuid,uuid,jsonb,text,text,text,integer,numeric,numeric,date) from public, anon;
grant execute on function public.receive_stock_batch_financial(uuid,uuid,jsonb,text,text,text,integer,numeric,numeric,date) to authenticated;

create or replace function private.create_sale_with_terms(
  _branch_id uuid,
  _customer_name text,
  _customer_type text,
  _payment_method text,
  _lines jsonb,
  _customer_id uuid,
  _paid_amount numeric,
  _due_date date
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid; v_sale uuid; v_total numeric; v_branch uuid; v_name text := trim(coalesce(_customer_name,''));
begin
  select organization_id into v_org from public.profiles where id=v_uid and role in ('owner','operator');
  if v_org is null or not private.can_operate_branch(_branch_id) then raise exception 'Tidak punya akses kasir cabang ini.'; end if;
  if _payment_method not in ('cash','transfer','qris','debit','other') then raise exception 'Metode pembayaran tidak valid.'; end if;
  if _customer_id is not null then select name into v_name from public.customers where id=_customer_id and organization_id=v_org; if not found then raise exception 'Pelanggan tidak ditemukan.'; end if; end if;
  v_sale := private.create_sale(_branch_id,v_name,_customer_type,_payment_method,_lines);
  select total,branch_id into v_total,v_branch from public.sales where id=v_sale;
  if _paid_amount is null or _paid_amount < 0 or _paid_amount > v_total then raise exception 'Pembayaran harus antara nol dan total transaksi.'; end if;
  if _paid_amount < v_total and _due_date is null then raise exception 'Tanggal jatuh tempo wajib untuk piutang.'; end if;
  update public.sales set customer_id=_customer_id, paid_amount=_paid_amount, due_date=case when _paid_amount < v_total then _due_date else null end where id=v_sale;
  if _paid_amount > 0 then insert into public.cash_transactions(organization_id,branch_id,direction,category,amount,description,source_type,source_id,customer_id,created_by)
    values(v_org,_branch_id,'income','Penjualan',_paid_amount,'Pembayaran awal struk '||left(v_sale::text,8),'sale',v_sale,_customer_id,v_uid); end if;
  return v_sale;
end;
$$;
revoke all on function private.create_sale_with_terms(uuid,text,text,text,jsonb,uuid,numeric,date) from public, anon;
grant execute on function private.create_sale_with_terms(uuid,text,text,text,jsonb,uuid,numeric,date) to authenticated;
create or replace function public.create_sale_with_terms(_branch_id uuid,_customer_name text,_customer_type text,_payment_method text,_lines jsonb,_customer_id uuid,_paid_amount numeric,_due_date date)
returns uuid language sql security invoker set search_path = '' as $$ select private.create_sale_with_terms(_branch_id,_customer_name,_customer_type,_payment_method,_lines,_customer_id,_paid_amount,_due_date) $$;
revoke all on function public.create_sale_with_terms(uuid,text,text,text,jsonb,uuid,numeric,date) from public, anon;
grant execute on function public.create_sale_with_terms(uuid,text,text,text,jsonb,uuid,numeric,date) to authenticated;

create or replace function private.add_manual_cash_transaction(_branch_id uuid,_direction text,_category text,_amount numeric,_description text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid; v_id uuid;
begin
  select organization_id into v_org from public.profiles where id=v_uid and role in ('owner','operator');
  if v_org is null or not private.can_operate_branch(_branch_id) then raise exception 'Tidak punya akses keuangan cabang ini.'; end if;
  if _direction not in ('income','expense') or _category not in ('Pemasukan lain','Operasional toko','Transportasi','Utilitas','Gaji','Perbaikan','Lainnya') or _amount is null or _amount <= 0 then raise exception 'Jenis dan nominal transaksi tidak valid.'; end if;
  insert into public.cash_transactions(organization_id,branch_id,direction,category,amount,description,source_type,created_by)
  values(v_org,_branch_id,_direction,_category,_amount,coalesce(trim(_description),''),'manual',v_uid) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.add_manual_cash_transaction(uuid,text,text,numeric,text) from public, anon;
grant execute on function private.add_manual_cash_transaction(uuid,text,text,numeric,text) to authenticated;
create or replace function public.add_manual_cash_transaction(_branch_id uuid,_direction text,_category text,_amount numeric,_description text)
returns uuid language sql security invoker set search_path = '' as $$ select private.add_manual_cash_transaction(_branch_id,_direction,_category,_amount,_description) $$;
revoke all on function public.add_manual_cash_transaction(uuid,text,text,numeric,text) from public, anon;
grant execute on function public.add_manual_cash_transaction(uuid,text,text,numeric,text) to authenticated;

create or replace function private.record_party_payment(_source_type text,_source_id uuid,_amount numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid; v_branch uuid; v_total numeric; v_paid numeric; v_customer uuid; v_supplier uuid; v_direction text; v_category text; v_desc text;
begin
  select organization_id into v_org from public.profiles where id=v_uid and role in ('owner','operator');
  if v_org is null or _amount is null or _amount <= 0 then raise exception 'Pembayaran tidak valid.'; end if;
  if _source_type='sale' then
    select branch_id,total,paid_amount,customer_id into v_branch,v_total,v_paid,v_customer from public.sales where id=_source_id and organization_id=v_org for update;
    v_direction:='income'; v_category:='Penerimaan piutang'; v_desc:='Pembayaran piutang pelanggan';
  elsif _source_type='intake_batch' then
    select branch_id,total_amount,amount_paid,supplier_id into v_branch,v_total,v_paid,v_supplier from public.intake_batches where id=_source_id and organization_id=v_org for update;
    v_direction:='expense'; v_category:='Pembayaran hutang supplier'; v_desc:='Pembayaran hutang pembelian';
  else raise exception 'Jenis tagihan tidak dikenal.'; end if;
  if v_branch is null or not private.can_operate_branch(v_branch) then raise exception 'Tagihan tidak ditemukan di cabang ini.'; end if;
  if _amount > v_total-v_paid then raise exception 'Pembayaran melebihi sisa tagihan.'; end if;
  if _source_type='sale' then update public.sales set paid_amount=paid_amount+_amount, due_date=case when paid_amount+_amount>=total then null else due_date end where id=_source_id;
  else update public.intake_batches set amount_paid=amount_paid+_amount, due_date=case when amount_paid+_amount>=total_amount then null else due_date end where id=_source_id; end if;
  insert into public.cash_transactions(organization_id,branch_id,direction,category,amount,description,source_type,source_id,customer_id,supplier_id,created_by)
  values(v_org,v_branch,v_direction,v_category,_amount,v_desc,_source_type,_source_id,v_customer,v_supplier,v_uid);
end;
$$;
revoke all on function private.record_party_payment(text,uuid,numeric) from public, anon;
grant execute on function private.record_party_payment(text,uuid,numeric) to authenticated;
create or replace function public.record_party_payment(_source_type text,_source_id uuid,_amount numeric)
returns void language sql security invoker set search_path = '' as $$ select private.record_party_payment(_source_type,_source_id,_amount) $$;
revoke all on function public.record_party_payment(text,uuid,numeric) from public, anon;
grant execute on function public.record_party_payment(text,uuid,numeric) to authenticated;

create index if not exists cash_transactions_branch_date_idx on public.cash_transactions(branch_id,created_at desc);
create index if not exists sales_customer_due_idx on public.sales(customer_id,due_date) where paid_amount < total;
create index if not exists intake_batches_supplier_due_idx on public.intake_batches(supplier_id,due_date) where amount_paid < total_amount;

alter table public.suppliers enable row level security;
alter table public.customers enable row level security;
alter table public.cash_transactions enable row level security;
grant select,insert,update,delete on public.suppliers,public.customers to authenticated;
grant select on public.cash_transactions to authenticated;
drop policy if exists suppliers_read_member on public.suppliers;
create policy suppliers_read_member on public.suppliers for select to authenticated using (private.is_org_member(organization_id) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role in ('owner','operator')));
drop policy if exists suppliers_manage_operator on public.suppliers;
create policy suppliers_manage_operator on public.suppliers for all to authenticated using (private.is_owner(organization_id) or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.organization_id=organization_id and p.role='operator') ) with check (private.is_owner(organization_id) or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.organization_id=organization_id and p.role='operator'));
drop policy if exists customers_read_member on public.customers;
create policy customers_read_member on public.customers for select to authenticated using (private.is_org_member(organization_id) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role in ('owner','operator')));
drop policy if exists customers_manage_operator on public.customers;
create policy customers_manage_operator on public.customers for all to authenticated using (private.is_owner(organization_id) or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.organization_id=organization_id and p.role='operator')) with check (private.is_owner(organization_id) or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.organization_id=organization_id and p.role='operator'));
drop policy if exists cash_transactions_read_branch on public.cash_transactions;
create policy cash_transactions_read_branch on public.cash_transactions for select to authenticated using (private.can_operate_branch(branch_id));
drop policy if exists intake_batches_read_branch on public.intake_batches;
create policy intake_batches_read_branch on public.intake_batches for select to authenticated using (private.can_operate_branch(branch_id));

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='cash_transactions') then
    alter publication supabase_realtime add table public.cash_transactions;
  end if;
end $$;
