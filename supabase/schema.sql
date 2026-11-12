-- Digi-Laptop shared database. Run once in the SQL Editor of a dedicated Supabase project.
create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null default '',
  address text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  city text not null default '',
  address text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  full_name text not null default '',
  role text not null check (role in ('owner','operator','technician')),
  created_at timestamptz not null default now()
);

create table if not exists public.team_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sku text not null,
  name text not null,
  brand text not null default '',
  model text not null default '',
  category text not null default 'Laptop',
  cost_price numeric(14,2) not null default 0 check (cost_price >= 0),
  retail_price numeric(14,2) not null default 0 check (retail_price >= 0),
  reseller_price numeric(14,2) not null default 0 check (reseller_price >= 0),
  warranty_months integer not null default 12 check (warranty_months >= 0),
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, sku)
);

create table if not exists public.stock_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  product_id uuid not null references public.products(id),
  barcode text not null,
  supplier_barcode text not null default '',
  serial_number text not null default '',
  supplier text not null default '',
  quantity integer not null default 1 check (quantity >= 0),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  warranty_until date,
  status text not null default 'available' check (status in ('available','sold','used_for_service','transferred')),
  created_by uuid references auth.users(id),
  unique (organization_id, barcode)
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  product_id uuid not null references public.products(id),
  stock_item_id uuid references public.stock_items(id),
  movement_type text not null check (movement_type in ('receive','sale','service_use','adjustment','transfer_in','transfer_out')),
  quantity integer not null,
  reference text not null default '',
  note text not null default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  receipt_number text not null,
  customer_name text not null default '',
  customer_type text not null default 'end_user' check (customer_type in ('end_user','reseller')),
  payment_method text not null default 'cash',
  total numeric(14,2) not null check (total >= 0),
  cashier_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, receipt_number)
);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid not null references public.products(id),
  stock_item_id uuid references public.stock_items(id),
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  line_total numeric(14,2) not null check (line_total >= 0)
);

create table if not exists public.service_tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  ticket_number text not null,
  customer_name text not null,
  customer_phone text not null default '',
  device_name text not null,
  serial_number text not null default '',
  complaint text not null,
  intake_photo_path text not null default '',
  handover_photo_path text not null default '',
  status text not null default 'received' check (status in ('received','diagnosing','waiting_approval','waiting_parts','repairing','ready','handed_over','cancelled')),
  estimated_cost numeric(14,2) not null default 0 check (estimated_cost >= 0),
  final_cost numeric(14,2) not null default 0 check (final_cost >= 0),
  technician_name text not null default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, ticket_number)
);

create table if not exists public.service_parts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ticket_id uuid not null references public.service_tickets(id) on delete cascade,
  stock_item_id uuid not null references public.stock_items(id),
  product_name text not null,
  quantity integer not null check (quantity > 0),
  cost numeric(14,2) not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists branches_org_idx on public.branches(organization_id);
create index if not exists profiles_org_branch_idx on public.profiles(organization_id, branch_id);
create index if not exists profiles_branch_id_idx on public.profiles(branch_id);
create index if not exists products_org_idx on public.products(organization_id);
create index if not exists stock_branch_product_idx on public.stock_items(branch_id, product_id, status);
create index if not exists stock_barcode_idx on public.stock_items(organization_id, barcode);
create index if not exists stock_product_id_idx on public.stock_items(product_id);
create index if not exists stock_created_by_idx on public.stock_items(created_by);
create index if not exists stock_movements_branch_id_idx on public.stock_movements(branch_id);
create index if not exists stock_movements_product_id_idx on public.stock_movements(product_id);
create index if not exists stock_movements_stock_item_id_idx on public.stock_movements(stock_item_id);
create index if not exists stock_movements_org_id_idx on public.stock_movements(organization_id);
create index if not exists stock_movements_created_by_idx on public.stock_movements(created_by);
create index if not exists sales_branch_date_idx on public.sales(branch_id, created_at desc);
create index if not exists sales_cashier_id_idx on public.sales(cashier_id);
create index if not exists sale_items_sale_id_idx on public.sale_items(sale_id);
create index if not exists sale_items_product_id_idx on public.sale_items(product_id);
create index if not exists sale_items_stock_item_id_idx on public.sale_items(stock_item_id);
create index if not exists service_branch_date_idx on public.service_tickets(branch_id, created_at desc);
create index if not exists service_tickets_created_by_idx on public.service_tickets(created_by);
create index if not exists team_invites_branch_id_idx on public.team_invites(branch_id);
create index if not exists team_invites_created_by_idx on public.team_invites(created_by);
create index if not exists service_parts_org_id_idx on public.service_parts(organization_id);
create index if not exists service_parts_ticket_id_idx on public.service_parts(ticket_id);
create index if not exists service_parts_stock_item_id_idx on public.service_parts(stock_item_id);
create index if not exists service_parts_created_by_idx on public.service_parts(created_by);

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_org_member(_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.organization_id = _organization_id)
$$;

create or replace function private.is_owner(_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.organization_id = _organization_id and p.role = 'owner')
$$;

create or replace function private.can_access_branch(_branch_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p join public.branches b on b.id = _branch_id
    where p.id = (select auth.uid())
      and b.organization_id = p.organization_id
      and (p.role = 'owner' or p.branch_id = _branch_id)
  )
$$;

revoke all on function private.is_org_member(uuid), private.is_owner(uuid), private.can_access_branch(uuid) from public, anon;
grant execute on function private.is_org_member(uuid), private.is_owner(uuid), private.can_access_branch(uuid) to authenticated;

create or replace function private.bootstrap_owner(_store_name text, _branch_names text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_name text;
begin
  if v_uid is null then raise exception 'Login dulu untuk menyiapkan toko.'; end if;
  if coalesce(trim(_store_name), '') = '' then raise exception 'Nama toko wajib diisi.'; end if;
  perform pg_advisory_xact_lock(74291831);
  if exists (select 1 from public.organizations) then raise exception 'Project database ini sudah memiliki toko.'; end if;
  insert into public.organizations(name) values (trim(_store_name)) returning id into v_org;
  foreach v_name in array coalesce(_branch_names, array[]::text[]) loop
    if trim(v_name) <> '' then insert into public.branches(organization_id, name) values (v_org, trim(v_name)); end if;
  end loop;
  if not exists (select 1 from public.branches where organization_id = v_org) then
    insert into public.branches(organization_id, name) values (v_org, 'Cabang Utama');
  end if;
  insert into public.profiles(id, organization_id, full_name, role)
  select v_uid, v_org, coalesce(nullif(trim(raw_user_meta_data->>'full_name'), ''), 'Pemilik Toko'), 'owner'
  from auth.users where id = v_uid;
  return v_org;
end;
$$;
revoke all on function private.bootstrap_owner(text, text[]) from public, anon;
grant execute on function private.bootstrap_owner(text, text[]) to authenticated;
create or replace function public.bootstrap_owner(_store_name text, _branch_names text[])
returns uuid language sql security invoker set search_path = '' as $$ select private.bootstrap_owner(_store_name, _branch_names) $$;
revoke all on function public.bootstrap_owner(text, text[]) from public, anon;
grant execute on function public.bootstrap_owner(text, text[]) to authenticated;

create or replace function private.receive_stock(_branch_id uuid, _product_id uuid, _supplier text, _units jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_org uuid; v_product public.products%rowtype; v_unit jsonb; v_count integer := 0; v_barcode text;
begin
  select organization_id into v_org from public.profiles where id = v_uid and role = 'owner';
  if v_org is null then raise exception 'Hanya pemilik yang dapat mencatat stok masuk.'; end if;
  if not exists (select 1 from public.branches where id = _branch_id and organization_id = v_org) then raise exception 'Cabang tidak ditemukan.'; end if;
  select * into v_product from public.products where id = _product_id and organization_id = v_org;
  if not found then raise exception 'Produk tidak ditemukan.'; end if;
  if jsonb_typeof(_units) <> 'array' or jsonb_array_length(_units) < 1 then raise exception 'Daftar unit kosong.'; end if;
  for v_unit in select value from jsonb_array_elements(_units) loop
    v_barcode := coalesce(nullif(trim(v_unit->>'barcode'), ''), 'DL-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)));
    insert into public.stock_items(organization_id, branch_id, product_id, barcode, supplier_barcode, serial_number, supplier, quantity, warranty_until, created_by)
      values (v_org, _branch_id, _product_id, v_barcode, coalesce(v_unit->>'supplier_barcode',''), coalesce(v_unit->>'serial_number',''), coalesce(_supplier,''), 1,
        null, v_uid);
    insert into public.stock_movements(organization_id, branch_id, product_id, stock_item_id, movement_type, quantity, reference, note, created_by)
      values (v_org, _branch_id, _product_id, (select id from public.stock_items where organization_id=v_org and barcode=v_barcode), 'receive', 1, v_barcode, coalesce(_supplier,''), v_uid);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.receive_stock(uuid,uuid,text,jsonb) from public, anon;
grant execute on function private.receive_stock(uuid,uuid,text,jsonb) to authenticated;
create or replace function public.receive_stock(_branch_id uuid, _product_id uuid, _supplier text, _units jsonb)
returns integer language sql security invoker set search_path = '' as $$ select private.receive_stock(_branch_id, _product_id, _supplier, _units) $$;
revoke all on function public.receive_stock(uuid,uuid,text,jsonb) from public, anon;
grant execute on function public.receive_stock(uuid,uuid,text,jsonb) to authenticated;

create or replace function public.accept_operator_invite()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_invite public.team_invites%rowtype;
begin
  select * into v_invite from public.team_invites where lower(email) = lower(new.email) order by created_at limit 1;
  if found then
    insert into public.profiles(id, organization_id, branch_id, full_name, role)
    values (new.id, v_invite.organization_id, v_invite.branch_id,
      coalesce(nullif(trim(v_invite.full_name), ''), coalesce(new.raw_user_meta_data->>'full_name', 'Operator')), 'operator');
    delete from public.team_invites where id = v_invite.id;
  end if;
  return new;
end;
$$;
drop trigger if exists on_auth_user_accept_operator_invite on auth.users;
create trigger on_auth_user_accept_operator_invite after insert on auth.users for each row execute procedure public.accept_operator_invite();

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
  for v_line in select value from jsonb_array_elements(_lines) loop
    v_qty := (v_line->>'quantity')::integer;
    if v_qty < 1 then raise exception 'Jumlah produk tidak valid.'; end if;
    select * into v_product from public.products where id = (v_line->>'product_id')::uuid and organization_id = v_org;
    if not found then raise exception 'Produk tidak ditemukan.'; end if;
    v_price := case when _customer_type = 'reseller' then v_product.reseller_price else v_product.retail_price end;
    select coalesce(sum(quantity),0)::integer into v_left from public.stock_items where branch_id = _branch_id and product_id = v_product.id and status = 'available';
    if v_left < v_qty then raise exception 'Stok tidak cukup untuk %.', v_product.name; end if;
    v_total := v_total + v_price * v_qty;
  end loop;
  insert into public.sales(id, organization_id, branch_id, receipt_number, customer_name, customer_type, payment_method, total, cashier_id)
    values (v_sale, v_org, _branch_id, v_receipt, coalesce(_customer_name,''), _customer_type, _payment_method, v_total, v_uid);
  for v_line in select value from jsonb_array_elements(_lines) loop
    v_qty := (v_line->>'quantity')::integer;
    select * into v_product from public.products where id = (v_line->>'product_id')::uuid and organization_id = v_org;
    v_price := case when _customer_type = 'reseller' then v_product.reseller_price else v_product.retail_price end;
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
revoke all on function private.create_sale(uuid,text,text,text,jsonb) from public, anon;
grant execute on function private.create_sale(uuid,text,text,text,jsonb) to authenticated;
create or replace function public.create_sale(_branch_id uuid, _customer_name text, _customer_type text, _payment_method text, _lines jsonb)
returns uuid language sql security invoker set search_path = '' as $$ select private.create_sale(_branch_id, _customer_name, _customer_type, _payment_method, _lines) $$;
revoke all on function public.create_sale(uuid,text,text,text,jsonb) from public, anon;
grant execute on function public.create_sale(uuid,text,text,text,jsonb) to authenticated;

create or replace function private.use_service_part(_ticket_id uuid, _stock_item_id uuid, _quantity integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ticket public.service_tickets%rowtype; v_stock public.stock_items%rowtype; v_uid uuid := (select auth.uid()); v_org uuid;
begin
  select organization_id into v_org from public.profiles where id = v_uid;
  select * into v_ticket from public.service_tickets where id = _ticket_id and organization_id = v_org for update;
  if not found or not private.can_access_branch(v_ticket.branch_id) then raise exception 'Tiket servis tidak ditemukan.'; end if;
  select * into v_stock from public.stock_items where id = _stock_item_id and branch_id = v_ticket.branch_id and status = 'available' and quantity >= _quantity for update;
  if not found or _quantity < 1 then raise exception 'Stok sparepart tidak cukup.'; end if;
  update public.stock_items set quantity = quantity - _quantity, status = case when quantity - _quantity = 0 then 'used_for_service' else status end where id = v_stock.id;
  insert into public.service_parts(organization_id, ticket_id, stock_item_id, product_name, quantity, cost, created_by)
    select v_org, _ticket_id, v_stock.id, p.name, _quantity, p.cost_price * _quantity, v_uid from public.products p where p.id = v_stock.product_id;
  insert into public.stock_movements(organization_id, branch_id, product_id, stock_item_id, movement_type, quantity, reference, created_by)
    values(v_org, v_ticket.branch_id, v_stock.product_id, v_stock.id, 'service_use', -_quantity, v_ticket.ticket_number, v_uid);
end;
$$;
revoke all on function private.use_service_part(uuid,uuid,integer) from public, anon;
grant execute on function private.use_service_part(uuid,uuid,integer) to authenticated;
create or replace function public.use_service_part(_ticket_id uuid, _stock_item_id uuid, _quantity integer)
returns void language sql security invoker set search_path = '' as $$ select private.use_service_part(_ticket_id, _stock_item_id, _quantity) $$;
revoke all on function public.use_service_part(uuid,uuid,integer) from public, anon;
grant execute on function public.use_service_part(uuid,uuid,integer) to authenticated;

revoke execute on function public.accept_operator_invite() from public, anon, authenticated;

alter table public.organizations enable row level security;
alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.team_invites enable row level security;
alter table public.products enable row level security;
alter table public.stock_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.service_tickets enable row level security;
alter table public.service_parts enable row level security;

grant select, update on public.organizations to authenticated;
grant select, insert, update, delete on public.branches, public.products to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.team_invites to authenticated;
grant select, insert, update on public.stock_items to authenticated;
grant select on public.stock_movements, public.sales, public.sale_items, public.service_parts to authenticated;
grant select, insert, update, delete on public.service_tickets to authenticated;
grant select (id, organization_id, name, brand, model, category, retail_price, is_public) on public.products to anon;

drop policy if exists organizations_read_member on public.organizations;
create policy organizations_read_member on public.organizations for select to authenticated using (private.is_org_member(id));
drop policy if exists organizations_update_owner on public.organizations;
create policy organizations_update_owner on public.organizations for update to authenticated using (private.is_owner(id)) with check (private.is_owner(id));
drop policy if exists branches_read_member on public.branches;
create policy branches_read_member on public.branches for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists branches_owner_manage on public.branches;
drop policy if exists branches_add_owner on public.branches;
drop policy if exists branches_update_owner on public.branches;
drop policy if exists branches_delete_owner on public.branches;
create policy branches_add_owner on public.branches for insert to authenticated with check (private.is_owner(organization_id));
create policy branches_update_owner on public.branches for update to authenticated using (private.is_owner(organization_id)) with check (private.is_owner(organization_id));
create policy branches_delete_owner on public.branches for delete to authenticated using (private.is_owner(organization_id));
drop policy if exists profiles_read_org on public.profiles;
create policy profiles_read_org on public.profiles for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists invites_owner_manage on public.team_invites;
create policy invites_owner_manage on public.team_invites for all to authenticated using (private.is_owner(organization_id)) with check (private.is_owner(organization_id));
drop policy if exists products_read_org on public.products;
create policy products_read_org on public.products for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists products_public_catalog on public.products;
create policy products_public_catalog on public.products for select to anon using (is_public);
drop policy if exists products_owner_manage on public.products;
drop policy if exists products_add_owner on public.products;
drop policy if exists products_update_owner on public.products;
drop policy if exists products_delete_owner on public.products;
create policy products_add_owner on public.products for insert to authenticated with check (private.is_owner(organization_id));
create policy products_update_owner on public.products for update to authenticated using (private.is_owner(organization_id)) with check (private.is_owner(organization_id));
create policy products_delete_owner on public.products for delete to authenticated using (private.is_owner(organization_id));
drop policy if exists stock_read_branch on public.stock_items;
create policy stock_read_branch on public.stock_items for select to authenticated using (private.can_access_branch(branch_id));
drop policy if exists stock_owner_manage on public.stock_items;
drop policy if exists stock_add_owner on public.stock_items;
drop policy if exists stock_update_owner on public.stock_items;
drop policy if exists stock_delete_owner on public.stock_items;
create policy stock_add_owner on public.stock_items for insert to authenticated with check (private.is_owner(organization_id));
create policy stock_update_owner on public.stock_items for update to authenticated using (private.is_owner(organization_id)) with check (private.is_owner(organization_id));
create policy stock_delete_owner on public.stock_items for delete to authenticated using (private.is_owner(organization_id));
drop policy if exists movements_read_branch on public.stock_movements;
create policy movements_read_branch on public.stock_movements for select to authenticated using (private.can_access_branch(branch_id));
drop policy if exists sales_read_branch on public.sales;
create policy sales_read_branch on public.sales for select to authenticated using (private.can_access_branch(branch_id));
drop policy if exists sale_items_read_branch on public.sale_items;
create policy sale_items_read_branch on public.sale_items for select to authenticated using (exists (select 1 from public.sales s where s.id = sale_id and private.can_access_branch(s.branch_id)));
drop policy if exists services_read_branch on public.service_tickets;
create policy services_read_branch on public.service_tickets for select to authenticated using (private.can_access_branch(branch_id));
drop policy if exists services_add_branch on public.service_tickets;
create policy services_add_branch on public.service_tickets for insert to authenticated with check (private.can_access_branch(branch_id) and private.is_org_member(organization_id));
drop policy if exists services_update_branch on public.service_tickets;
create policy services_update_branch on public.service_tickets for update to authenticated using (private.can_access_branch(branch_id)) with check (private.can_access_branch(branch_id));
drop policy if exists service_parts_read_branch on public.service_parts;
create policy service_parts_read_branch on public.service_parts for select to authenticated using (exists (select 1 from public.service_tickets t where t.id = ticket_id and private.can_access_branch(t.branch_id)));

create or replace view public.public_catalog with (security_invoker = true) as
select id, name, brand, model, category, retail_price
from public.products where is_public;
grant select on public.public_catalog to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('service-evidence', 'service-evidence', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
drop policy if exists service_evidence_read_member on storage.objects;
create policy service_evidence_read_member on storage.objects for select to authenticated using (
  bucket_id = 'service-evidence' and exists (select 1 from public.profiles p where p.id = auth.uid() and (storage.foldername(name))[1] = p.organization_id::text and private.can_access_branch(((storage.foldername(name))[2])::uuid))
);
drop policy if exists service_evidence_upload_member on storage.objects;
create policy service_evidence_upload_member on storage.objects for insert to authenticated with check (
  bucket_id = 'service-evidence' and exists (select 1 from public.profiles p where p.id = auth.uid() and (storage.foldername(name))[1] = p.organization_id::text and private.can_access_branch(((storage.foldername(name))[2])::uuid))
);

drop function if exists public.is_org_member(uuid);
drop function if exists public.is_owner(uuid);
drop function if exists public.can_access_branch(uuid);

-- Separate receiving and technician work while keeping every unit in shared branch stock.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('owner','operator','technician'));
alter table public.team_invites add column if not exists role text not null default 'operator';
alter table public.team_invites drop constraint if exists team_invites_role_check;
alter table public.team_invites add constraint team_invites_role_check check (role in ('operator','technician'));

create table if not exists public.intake_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  product_id uuid not null references public.products(id),
  supplier text not null default '',
  unit_count integer not null check (unit_count > 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.stock_items add column if not exists intake_batch_id uuid references public.intake_batches(id);
alter table public.stock_items add column if not exists qc_stage text not null default 'initial';
alter table public.stock_items add column if not exists qc_notes text not null default '';
alter table public.stock_items add column if not exists qc_by uuid references auth.users(id);
alter table public.stock_items add column if not exists qc_at timestamptz;
alter table public.stock_items drop constraint if exists stock_items_status_check;
alter table public.stock_items add constraint stock_items_status_check check (status in ('pending_qc','repair_needed','repairing','waiting_parts','available','not_sellable','sold','used_for_service','transferred'));
alter table public.stock_items drop constraint if exists stock_items_qc_stage_check;
alter table public.stock_items add constraint stock_items_qc_stage_check check (qc_stage in ('initial','final'));

create table if not exists public.stock_repairs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  stock_item_id uuid not null references public.stock_items(id) on delete cascade,
  issue text not null,
  status text not null default 'repair_needed' check (status in ('repair_needed','repairing','waiting_parts','pending_final_qc','completed','not_sellable')),
  resolution text not null default '',
  technician_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stock_repair_parts (
  id uuid primary key default gen_random_uuid(),
  repair_id uuid not null references public.stock_repairs(id) on delete cascade,
  stock_item_id uuid not null references public.stock_items(id),
  product_name text not null,
  quantity integer not null check (quantity > 0),
  cost numeric(14,2) not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists intake_batches_branch_date_idx on public.intake_batches(branch_id, created_at desc);
create index if not exists stock_items_qc_queue_idx on public.stock_items(branch_id, status, created_at desc);
create index if not exists stock_repairs_item_idx on public.stock_repairs(stock_item_id, created_at desc);

create or replace function public.accept_operator_invite()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_invite public.team_invites%rowtype;
begin
  select * into v_invite from public.team_invites where lower(email) = lower(new.email) order by created_at limit 1;
  if found then
    insert into public.profiles(id, organization_id, branch_id, full_name, role)
    values (new.id, v_invite.organization_id, v_invite.branch_id,
      coalesce(nullif(trim(v_invite.full_name), ''), coalesce(new.raw_user_meta_data->>'full_name', 'Operator')), v_invite.role);
    delete from public.team_invites where id = v_invite.id;
  end if;
  return new;
end;
$$;

create or replace function private.receive_stock_batch(_branch_id uuid, _product_id uuid, _supplier text, _quantity integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid; v_batch uuid := gen_random_uuid(); v_i integer; v_barcode text;
begin
  select organization_id into v_org from public.profiles where id = v_uid and role in ('owner','operator');
  if v_org is null then raise exception 'Penerimaan barang hanya dapat dicatat pemilik atau operator.'; end if;
  if not exists (select 1 from public.branches where id = _branch_id and organization_id = v_org) then raise exception 'Cabang tidak ditemukan.'; end if;
  if not exists (select 1 from public.products where id = _product_id and organization_id = v_org) then raise exception 'Produk tidak ditemukan.'; end if;
  if _quantity < 1 or _quantity > 500 then raise exception 'Jumlah penerimaan harus 1 sampai 500 unit.'; end if;
  insert into public.intake_batches(id, organization_id, branch_id, product_id, supplier, unit_count, created_by)
    values(v_batch, v_org, _branch_id, _product_id, coalesce(trim(_supplier),''), _quantity, v_uid);
  for v_i in 1.._quantity loop
    v_barcode := 'DL-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
    insert into public.stock_items(organization_id, branch_id, product_id, barcode, supplier, quantity, status, intake_batch_id, qc_stage, created_by)
      values(v_org, _branch_id, _product_id, v_barcode, coalesce(trim(_supplier),''), 1, 'pending_qc', v_batch, 'initial', v_uid);
    insert into public.stock_movements(organization_id, branch_id, product_id, stock_item_id, movement_type, quantity, reference, note, created_by)
      select v_org, _branch_id, _product_id, id, 'receive', 1, v_barcode, 'Batch ' || v_batch::text, v_uid from public.stock_items where organization_id = v_org and barcode = v_barcode;
  end loop;
  return v_batch;
end;
$$;
revoke all on function private.receive_stock_batch(uuid,uuid,text,integer) from public, anon;
grant execute on function private.receive_stock_batch(uuid,uuid,text,integer) to authenticated;
create or replace function public.receive_stock_batch(_branch_id uuid, _product_id uuid, _supplier text, _quantity integer)
returns uuid language sql security invoker set search_path = '' as $$ select private.receive_stock_batch(_branch_id,_product_id,_supplier,_quantity) $$;
revoke all on function public.receive_stock_batch(uuid,uuid,text,integer) from public, anon;
grant execute on function public.receive_stock_batch(uuid,uuid,text,integer) to authenticated;

create or replace function private.decide_stock_qc(_stock_item_id uuid, _decision text, _notes text, _serial_number text default null, _supplier_barcode text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_stock public.stock_items%rowtype; v_role text;
begin
  select role into v_role from public.profiles where id = v_uid;
  select * into v_stock from public.stock_items where id = _stock_item_id for update;
  if not found or not private.can_access_branch(v_stock.branch_id) or v_role not in ('owner','technician') then raise exception 'Tidak punya akses teknisi ke unit ini.'; end if;
  if v_stock.status <> 'pending_qc' then raise exception 'Unit ini tidak sedang menunggu QC.'; end if;
  if v_stock.qc_stage = 'initial' and _decision not in ('available','repair_needed','not_sellable') then raise exception 'Keputusan QC awal tidak valid.'; end if;
  if v_stock.qc_stage = 'final' and _decision not in ('available','repair_needed','not_sellable') then raise exception 'Keputusan QC akhir tidak valid.'; end if;
  update public.stock_items set status = _decision, qc_notes = coalesce(trim(_notes),''), qc_by = v_uid, qc_at = now(),
    serial_number = coalesce(nullif(trim(_serial_number),''),serial_number), supplier_barcode = coalesce(nullif(trim(_supplier_barcode),''),supplier_barcode)
    where id = _stock_item_id;
  if _decision = 'repair_needed' then
    if v_stock.qc_stage = 'final' then
      update public.stock_repairs set status = 'repair_needed', issue = coalesce(nullif(trim(_notes),''),'Perlu pemeriksaan lanjutan.'), resolution = '', technician_id = v_uid, updated_at = now()
        where stock_item_id = _stock_item_id and status = 'pending_final_qc';
    else
      insert into public.stock_repairs(organization_id, branch_id, stock_item_id, issue, technician_id)
        values(v_stock.organization_id, v_stock.branch_id, v_stock.id, coalesce(nullif(trim(_notes),''),'Perlu pemeriksaan teknisi.'), v_uid);
    end if;
  elsif v_stock.qc_stage = 'final' and _decision = 'available' then
    update public.stock_repairs set status = 'completed', resolution = coalesce(nullif(trim(_notes),''),resolution), technician_id = v_uid, updated_at = now()
      where stock_item_id = _stock_item_id and status = 'pending_final_qc';
  elsif v_stock.qc_stage = 'final' and _decision = 'not_sellable' then
    update public.stock_repairs set status = 'not_sellable', resolution = coalesce(nullif(trim(_notes),''),resolution), technician_id = v_uid, updated_at = now()
      where stock_item_id = _stock_item_id and status = 'pending_final_qc';
  end if;
end;
$$;
revoke all on function private.decide_stock_qc(uuid,text,text,text,text) from public, anon;
grant execute on function private.decide_stock_qc(uuid,text,text,text,text) to authenticated;
create or replace function public.decide_stock_qc(_stock_item_id uuid, _decision text, _notes text, _serial_number text default null, _supplier_barcode text default null)
returns void language sql security invoker set search_path = '' as $$ select private.decide_stock_qc(_stock_item_id,_decision,_notes,_serial_number,_supplier_barcode) $$;
revoke all on function public.decide_stock_qc(uuid,text,text,text,text) from public, anon;
grant execute on function public.decide_stock_qc(uuid,text,text,text,text) to authenticated;

create or replace function private.update_stock_repair(_repair_id uuid, _status text, _resolution text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_job public.stock_repairs%rowtype; v_role text;
begin
  select role into v_role from public.profiles where id = v_uid;
  select * into v_job from public.stock_repairs where id = _repair_id for update;
  if not found or not private.can_access_branch(v_job.branch_id) or v_role not in ('owner','technician') then raise exception 'Tidak punya akses teknisi ke pekerjaan ini.'; end if;
  if _status not in ('repairing','waiting_parts','pending_final_qc') then raise exception 'Status repair tidak valid.'; end if;
  update public.stock_repairs set status = _status, resolution = coalesce(trim(_resolution),''), technician_id = v_uid, updated_at = now() where id = _repair_id;
  update public.stock_items set status = case when _status = 'pending_final_qc' then 'pending_qc' else _status end,
    qc_stage = case when _status = 'pending_final_qc' then 'final' else qc_stage end where id = v_job.stock_item_id;
end;
$$;
revoke all on function private.update_stock_repair(uuid,text,text) from public, anon;
grant execute on function private.update_stock_repair(uuid,text,text) to authenticated;
create or replace function public.update_stock_repair(_repair_id uuid, _status text, _resolution text default '')
returns void language sql security invoker set search_path = '' as $$ select private.update_stock_repair(_repair_id,_status,_resolution) $$;
revoke all on function public.update_stock_repair(uuid,text,text) from public, anon;
grant execute on function public.update_stock_repair(uuid,text,text) to authenticated;

create or replace function private.use_stock_repair_part(_repair_id uuid, _part_stock_item_id uuid, _quantity integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_job public.stock_repairs%rowtype; v_part public.stock_items%rowtype; v_role text; v_name text; v_cost numeric;
begin
  select role into v_role from public.profiles where id = v_uid;
  select * into v_job from public.stock_repairs where id = _repair_id for update;
  if not found or not private.can_access_branch(v_job.branch_id) or v_role not in ('owner','technician') then raise exception 'Tidak punya akses teknisi ke pekerjaan ini.'; end if;
  if v_job.status not in ('repair_needed','repairing','waiting_parts') then raise exception 'Pekerjaan ini tidak menerima sparepart.'; end if;
  select * into v_part from public.stock_items where id = _part_stock_item_id and branch_id = v_job.branch_id and status = 'available' and quantity >= _quantity for update;
  if not found or _quantity < 1 then raise exception 'Stok sparepart tidak cukup di cabang ini.'; end if;
  select p.name,p.cost_price into v_name,v_cost from public.products p where p.id = v_part.product_id and p.category in ('Sparepart','Aksesori','Lainnya');
  if not found then raise exception 'Pilih barang kategori sparepart atau aksesori.'; end if;
  update public.stock_items set quantity = quantity - _quantity, status = case when quantity - _quantity = 0 then 'used_for_service' else status end where id = v_part.id;
  insert into public.stock_repair_parts(repair_id,stock_item_id,product_name,quantity,cost,created_by) values(_repair_id,v_part.id,v_name,_quantity,v_cost*_quantity,v_uid);
  insert into public.stock_movements(organization_id,branch_id,product_id,stock_item_id,movement_type,quantity,reference,note,created_by)
    values(v_job.organization_id,v_job.branch_id,v_part.product_id,v_part.id,'service_use',-_quantity,'Repair '||v_job.id::text,'Sparepart untuk unit '||v_job.stock_item_id::text,v_uid);
end;
$$;
revoke all on function private.use_stock_repair_part(uuid,uuid,integer) from public, anon;
grant execute on function private.use_stock_repair_part(uuid,uuid,integer) to authenticated;
create or replace function public.use_stock_repair_part(_repair_id uuid, _part_stock_item_id uuid, _quantity integer)
returns void language sql security invoker set search_path = '' as $$ select private.use_stock_repair_part(_repair_id,_part_stock_item_id,_quantity) $$;
revoke all on function public.use_stock_repair_part(uuid,uuid,integer) from public, anon;
grant execute on function public.use_stock_repair_part(uuid,uuid,integer) to authenticated;

alter table public.intake_batches enable row level security;
alter table public.stock_repairs enable row level security;
alter table public.stock_repair_parts enable row level security;
grant select on public.intake_batches, public.stock_repairs, public.stock_repair_parts to authenticated;
drop policy if exists intake_batches_read_branch on public.intake_batches;
create policy intake_batches_read_branch on public.intake_batches for select to authenticated using (private.can_access_branch(branch_id));
drop policy if exists stock_repairs_read_branch on public.stock_repairs;
create policy stock_repairs_read_branch on public.stock_repairs for select to authenticated using (private.can_access_branch(branch_id));
drop policy if exists stock_repair_parts_read_branch on public.stock_repair_parts;
create policy stock_repair_parts_read_branch on public.stock_repair_parts for select to authenticated using (exists(select 1 from public.stock_repairs r where r.id = repair_id and private.can_access_branch(r.branch_id)));

do $$
declare v_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array array['stock_items','stock_repairs','intake_batches','sales','service_tickets','products','suppliers','customers'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
end;
$$;
create or replace function private.can_operate_branch(_branch_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p join public.branches b on b.id = _branch_id
    where p.id = (select auth.uid())
      and b.organization_id = p.organization_id
      and p.role in ('owner','operator')
      and (p.role = 'owner' or p.branch_id = _branch_id)
  )
$$;
revoke all on function private.can_operate_branch(uuid) from public, anon;
grant execute on function private.can_operate_branch(uuid) to authenticated;

drop policy if exists sales_read_branch on public.sales;
create policy sales_read_branch on public.sales for select to authenticated using (private.can_operate_branch(branch_id));
drop policy if exists sale_items_read_branch on public.sale_items;
create policy sale_items_read_branch on public.sale_items for select to authenticated using (exists (select 1 from public.sales s where s.id = sale_id and private.can_operate_branch(s.branch_id)));
drop policy if exists services_read_branch on public.service_tickets;
create policy services_read_branch on public.service_tickets for select to authenticated using (private.can_operate_branch(branch_id));
drop policy if exists services_add_branch on public.service_tickets;
create policy services_add_branch on public.service_tickets for insert to authenticated with check (private.can_operate_branch(branch_id) and private.is_org_member(organization_id));
drop policy if exists services_update_branch on public.service_tickets;
create policy services_update_branch on public.service_tickets for update to authenticated using (private.can_operate_branch(branch_id)) with check (private.can_operate_branch(branch_id));
drop policy if exists service_parts_read_branch on public.service_parts;
create policy service_parts_read_branch on public.service_parts for select to authenticated using (exists (select 1 from public.service_tickets t where t.id = ticket_id and private.can_operate_branch(t.branch_id)));

create or replace function private.require_operator_for_sale()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_operate_branch(new.branch_id) then raise exception 'Hanya pemilik atau operator cabang yang dapat membuat transaksi.'; end if;
  return new;
end;
$$;
revoke all on function private.require_operator_for_sale() from public, anon, authenticated;
drop trigger if exists require_operator_for_sale on public.sales;
create trigger require_operator_for_sale before insert on public.sales for each row execute function private.require_operator_for_sale();

create or replace function private.require_operator_for_service_part()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_branch_id uuid;
begin
  select branch_id into v_branch_id from public.service_tickets where id = new.ticket_id;
  if v_branch_id is null or not private.can_operate_branch(v_branch_id) then raise exception 'Hanya pemilik atau operator cabang yang dapat memakai sparepart untuk servis pelanggan.'; end if;
  return new;
end;
$$;
revoke all on function private.require_operator_for_service_part() from public, anon, authenticated;
drop trigger if exists require_operator_for_service_part on public.service_parts;
create trigger require_operator_for_service_part before insert on public.service_parts for each row execute function private.require_operator_for_service_part();
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
drop policy if exists suppliers_manage_operator on public.suppliers;
create policy suppliers_read_member on public.suppliers for select to authenticated using (private.is_org_member(suppliers.organization_id) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.organization_id=suppliers.organization_id and p.role in ('owner','operator')));
create policy suppliers_add_member on public.suppliers for insert to authenticated with check (private.is_owner(suppliers.organization_id) or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.organization_id=suppliers.organization_id and p.role='operator'));
create policy suppliers_update_member on public.suppliers for update to authenticated using (private.is_owner(suppliers.organization_id) or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.organization_id=suppliers.organization_id and p.role='operator')) with check (private.is_owner(suppliers.organization_id) or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.organization_id=suppliers.organization_id and p.role='operator'));
create policy suppliers_delete_member on public.suppliers for delete to authenticated using (private.is_owner(suppliers.organization_id) or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.organization_id=suppliers.organization_id and p.role='operator'));
drop policy if exists customers_read_member on public.customers;
drop policy if exists customers_manage_operator on public.customers;
create policy customers_read_member on public.customers for select to authenticated using (private.is_org_member(customers.organization_id) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.organization_id=customers.organization_id and p.role in ('owner','operator')));
create policy customers_add_member on public.customers for insert to authenticated with check (private.is_owner(customers.organization_id) or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.organization_id=customers.organization_id and p.role='operator'));
create policy customers_update_member on public.customers for update to authenticated using (private.is_owner(customers.organization_id) or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.organization_id=customers.organization_id and p.role='operator')) with check (private.is_owner(customers.organization_id) or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.organization_id=customers.organization_id and p.role='operator'));
create policy customers_delete_member on public.customers for delete to authenticated using (private.is_owner(customers.organization_id) or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.organization_id=customers.organization_id and p.role='operator'));
drop policy if exists cash_transactions_read_branch on public.cash_transactions;
create policy cash_transactions_read_branch on public.cash_transactions for select to authenticated using (private.can_operate_branch(branch_id));
drop policy if exists intake_batches_read_branch on public.intake_batches;
create policy intake_batches_read_branch on public.intake_batches for select to authenticated using (private.can_operate_branch(branch_id));

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='cash_transactions') then
    alter publication supabase_realtime add table public.cash_transactions;
  end if;
end $$;
-- Seed cash receipts for pre-ledger sales, and close legacy direct RPC paths.
insert into public.cash_transactions(organization_id,branch_id,direction,category,amount,description,source_type,source_id,customer_id,created_by,created_at)
select s.organization_id,s.branch_id,'income','Penjualan historis',s.paid_amount,'Penerimaan penjualan '||s.receipt_number,'sale',s.id,s.customer_id,s.cashier_id,s.created_at
from public.sales s
where s.paid_amount > 0
  and not exists (select 1 from public.cash_transactions c where c.source_type='sale' and c.source_id=s.id);

revoke execute on function public.create_sale(uuid,text,text,text,jsonb) from public, anon, authenticated;
revoke execute on function private.create_sale(uuid,text,text,text,jsonb) from public, anon, authenticated;
revoke execute on function public.receive_stock_batch(uuid,uuid,text,integer) from public, anon, authenticated;
revoke execute on function private.receive_stock_batch(uuid,uuid,text,integer) from public, anon, authenticated;
alter table public.service_tickets add column if not exists paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0);
alter table public.service_tickets add column if not exists due_date date;
update public.service_tickets set paid_amount=final_cost where status='handed_over' and paid_amount=0;

insert into public.cash_transactions(organization_id,branch_id,direction,category,amount,description,source_type,source_id,created_by,created_at)
select t.organization_id,t.branch_id,'income','Penerimaan servis historis',t.paid_amount,'Penerimaan tiket servis '||t.ticket_number,'service_ticket',t.id,t.created_by,t.updated_at
from public.service_tickets t
where t.status='handed_over' and t.paid_amount>0
  and not exists(select 1 from public.cash_transactions c where c.source_type='service_ticket' and c.source_id=t.id);

create or replace function private.complete_service_handover(_ticket_id uuid,_final_cost numeric,_paid_amount numeric,_due_date date,_handover_photo_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid; v_branch uuid; v_number text; v_customer text;
begin
  select organization_id,branch_id,ticket_number,customer_name into v_org,v_branch,v_number,v_customer from public.service_tickets where id=_ticket_id for update;
  if v_org is null or not private.can_operate_branch(v_branch) then raise exception 'Tiket tidak ditemukan untuk cabang ini.'; end if;
  if _final_cost is null or _final_cost<0 or _paid_amount is null or _paid_amount<0 or _paid_amount>_final_cost then raise exception 'Biaya dan pembayaran servis tidak valid.'; end if;
  if _paid_amount<_final_cost and _due_date is null then raise exception 'Tanggal jatuh tempo wajib untuk piutang servis.'; end if;
  update public.service_tickets set status='handed_over',final_cost=_final_cost,paid_amount=_paid_amount,due_date=case when _paid_amount<_final_cost then _due_date else null end,handover_photo_path=coalesce(_handover_photo_path,''),updated_at=now() where id=_ticket_id;
  if _paid_amount>0 then insert into public.cash_transactions(organization_id,branch_id,direction,category,amount,description,source_type,source_id,created_by)
    values(v_org,v_branch,'income','Penerimaan servis',_paid_amount,'Pembayaran servis '||v_number||' · '||v_customer,'service_ticket',_ticket_id,v_uid); end if;
end;
$$;
revoke all on function private.complete_service_handover(uuid,numeric,numeric,date,text) from public,anon;
grant execute on function private.complete_service_handover(uuid,numeric,numeric,date,text) to authenticated;
create or replace function public.complete_service_handover(_ticket_id uuid,_final_cost numeric,_paid_amount numeric,_due_date date,_handover_photo_path text)
returns void language sql security invoker set search_path = '' as $$ select private.complete_service_handover(_ticket_id,_final_cost,_paid_amount,_due_date,_handover_photo_path) $$;
revoke all on function public.complete_service_handover(uuid,numeric,numeric,date,text) from public,anon;
grant execute on function public.complete_service_handover(uuid,numeric,numeric,date,text) to authenticated;

create or replace function private.record_party_payment(_source_type text,_source_id uuid,_amount numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid; v_branch uuid; v_total numeric; v_paid numeric; v_customer uuid; v_supplier uuid; v_direction text; v_category text; v_desc text;
begin
  select organization_id into v_org from public.profiles where id=v_uid and role in ('owner','operator');
  if v_org is null or _amount is null or _amount <= 0 then raise exception 'Pembayaran tidak valid.'; end if;
  if _source_type='sale' then
    select branch_id,total,paid_amount,customer_id into v_branch,v_total,v_paid,v_customer from public.sales where id=_source_id and organization_id=v_org for update;
    v_direction:='income'; v_category:='Penerimaan piutang penjualan'; v_desc:='Pembayaran piutang pelanggan';
  elsif _source_type='service_ticket' then
    select branch_id,final_cost,paid_amount into v_branch,v_total,v_paid from public.service_tickets where id=_source_id and organization_id=v_org and status='handed_over' for update;
    v_direction:='income'; v_category:='Penerimaan piutang servis'; v_desc:='Pembayaran piutang servis';
  elsif _source_type='intake_batch' then
    select branch_id,total_amount,amount_paid,supplier_id into v_branch,v_total,v_paid,v_supplier from public.intake_batches where id=_source_id and organization_id=v_org for update;
    v_direction:='expense'; v_category:='Pembayaran hutang supplier'; v_desc:='Pembayaran hutang pembelian';
  else raise exception 'Jenis tagihan tidak dikenal.'; end if;
  if v_branch is null or not private.can_operate_branch(v_branch) then raise exception 'Tagihan tidak ditemukan di cabang ini.'; end if;
  if _amount > v_total-v_paid then raise exception 'Pembayaran melebihi sisa tagihan.'; end if;
  if _source_type='sale' then update public.sales set paid_amount=paid_amount+_amount,due_date=case when paid_amount+_amount>=total then null else due_date end where id=_source_id;
  elsif _source_type='service_ticket' then update public.service_tickets set paid_amount=paid_amount+_amount,due_date=case when paid_amount+_amount>=final_cost then null else due_date end,updated_at=now() where id=_source_id;
  else update public.intake_batches set amount_paid=amount_paid+_amount,due_date=case when amount_paid+_amount>=total_amount then null else due_date end where id=_source_id; end if;
  insert into public.cash_transactions(organization_id,branch_id,direction,category,amount,description,source_type,source_id,customer_id,supplier_id,created_by)
  values(v_org,v_branch,v_direction,v_category,_amount,v_desc,_source_type,_source_id,v_customer,v_supplier,v_uid);
end;
$$;
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
alter table public.products add column if not exists image_path text not null default '';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('product-images','product-images',true,8388608,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=true,file_size_limit=8388608,allowed_mime_types=array['image/jpeg','image/png','image/webp'];

drop policy if exists product_images_upload on storage.objects;
create policy product_images_upload on storage.objects for insert to authenticated with check (
  bucket_id='product-images' and exists (
    select 1 from public.profiles p where p.id=auth.uid() and p.role in ('owner','operator')
      and (storage.foldername(name))[1]=p.organization_id::text and (storage.foldername(name))[2]='products'
  )
);
drop policy if exists product_images_read_for_upsert on storage.objects;
create policy product_images_read_for_upsert on storage.objects for select to authenticated using (
  bucket_id='product-images' and exists (
    select 1 from public.profiles p where p.id=auth.uid() and p.role in ('owner','operator')
      and (storage.foldername(name))[1]=p.organization_id::text and (storage.foldername(name))[2]='products'
  )
);
drop policy if exists product_images_update on storage.objects;
create policy product_images_update on storage.objects for update to authenticated using (
  bucket_id='product-images' and exists (
    select 1 from public.profiles p where p.id=auth.uid() and p.role in ('owner','operator')
      and (storage.foldername(name))[1]=p.organization_id::text and (storage.foldername(name))[2]='products'
  )
) with check (
  bucket_id='product-images' and exists (
    select 1 from public.profiles p where p.id=auth.uid() and p.role in ('owner','operator')
      and (storage.foldername(name))[1]=p.organization_id::text and (storage.foldername(name))[2]='products'
  )
);
drop policy if exists product_images_delete on storage.objects;
create policy product_images_delete on storage.objects for delete to authenticated using (
  bucket_id='product-images' and exists (
    select 1 from public.profiles p where p.id=auth.uid() and p.role in ('owner','operator')
      and (storage.foldername(name))[1]=p.organization_id::text and (storage.foldername(name))[2]='products'
  )
);
drop policy if exists service_evidence_update_member on storage.objects;
create policy service_evidence_update_member on storage.objects for update to authenticated using (
  bucket_id='service-evidence' and exists (
    select 1 from public.profiles p where p.id=auth.uid()
      and (storage.foldername(name))[1]=p.organization_id::text
      and private.can_operate_branch(((storage.foldername(name))[2])::uuid)
  )
) with check (
  bucket_id='service-evidence' and exists (
    select 1 from public.profiles p where p.id=auth.uid()
      and (storage.foldername(name))[1]=p.organization_id::text
      and private.can_operate_branch(((storage.foldername(name))[2])::uuid)
  )
);

create or replace function private.set_product_image(_product_id uuid,_image_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_user_org uuid; v_role text;
begin
  select organization_id into v_org from public.products where id=_product_id;
  select organization_id,role into v_user_org,v_role from public.profiles where id=auth.uid();
  if v_org is null or v_org<>v_user_org or v_role not in ('owner','operator') then raise exception 'Tidak punya akses untuk mengubah foto produk.'; end if;
  if _image_path is null or _image_path not like v_org::text||'/products/%' then raise exception 'Lokasi foto produk tidak valid.'; end if;
  update public.products set image_path=_image_path where id=_product_id and organization_id=v_org;
end;
$$;
revoke all on function private.set_product_image(uuid,text) from public,anon;
grant execute on function private.set_product_image(uuid,text) to authenticated;
create or replace function public.set_product_image(_product_id uuid,_image_path text)
returns void language sql security invoker set search_path = '' as $$ select private.set_product_image(_product_id,_image_path) $$;
revoke all on function public.set_product_image(uuid,text) from public,anon;
grant execute on function public.set_product_image(uuid,text) to authenticated;

drop view if exists public.public_catalog;
create view public.public_catalog with (security_invoker=true) as
select id,name,brand,model,category,retail_price,image_path
from public.products where is_public;
grant select on public.public_catalog to anon,authenticated;
grant select (id,organization_id,name,brand,model,category,retail_price,is_public,image_path) on public.products to anon;

create or replace function private.receive_stock_batch_financial(
  _branch_id uuid,_product_id uuid,_new_product jsonb,_supplier_name text,_supplier_phone text,
  _invoice_number text,_quantity integer,_total_amount numeric,_amount_paid numeric,_due_date date
)
returns uuid language plpgsql security definer set search_path = '' as $$
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
    if v_product_image not like v_org::text||'/products/%' then raise exception 'Foto produk baru wajib diunggah.'; end if;
    v_sku:=coalesce(nullif(trim(_new_product->>'sku'),''),'DL-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)));
    insert into public.products(organization_id,sku,name,brand,model,category,cost_price,retail_price,reseller_price,warranty_months,image_path)
    values(v_org,v_sku,trim(_new_product->>'name'),coalesce(trim(_new_product->>'brand'),''),coalesce(trim(_new_product->>'model'),''),coalesce(nullif(trim(_new_product->>'category'),''),'Laptop'),_total_amount,coalesce(nullif(_new_product->>'retail_price','')::numeric,0),coalesce(nullif(_new_product->>'reseller_price','')::numeric,0),coalesce(nullif(_new_product->>'warranty_months','')::integer,12),v_product_image)
    returning id into v_product_id;
  else
    select image_path into v_product_image from public.products where id=v_product_id and organization_id=v_org;
    if coalesce(v_product_image,'')='' then raise exception 'Unggah foto produk di halaman Produk & stok sebelum penerimaan.'; end if;
  end if;
  v_batch:=public.receive_stock_batch(_branch_id,v_product_id,v_supplier,_quantity);
  update public.intake_batches set supplier_id=v_supplier_id,invoice_number=coalesce(trim(_invoice_number),''),unit_cost=_total_amount,total_amount=v_invoice_total,amount_paid=_amount_paid,due_date=case when _amount_paid<v_invoice_total then _due_date else null end where id=v_batch;
  update public.stock_items set supplier_id=v_supplier_id where intake_batch_id=v_batch;
  if _amount_paid>0 then insert into public.cash_transactions(organization_id,branch_id,direction,category,amount,description,source_type,source_id,supplier_id,created_by)
    values(v_org,_branch_id,'expense','Pembayaran pembelian',_amount_paid,'Pembayaran awal batch '||left(v_batch::text,8),'intake_batch',v_batch,v_supplier_id,v_uid); end if;
  return v_batch;
end;
$$;


-- Warranty claims, portal promotions, and idempotent offline sale synchronization.
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


-- Keep the customer-facing claim endpoint as a public invoker wrapper.
create or replace function private.submit_warranty_claim(_code text,_customer_name text,_customer_phone text,_customer_email text,_issue text)
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
revoke all on function private.submit_warranty_claim(text,text,text,text,text) from public,anon,authenticated;
grant usage on schema private to anon,authenticated;
grant execute on function private.submit_warranty_claim(text,text,text,text,text) to anon,authenticated;
create or replace function public.submit_warranty_claim(_code text,_customer_name text,_customer_phone text,_customer_email text,_issue text)
returns text language sql security invoker set search_path = '' as $$ select private.submit_warranty_claim(_code,_customer_name,_customer_phone,_customer_email,_issue) $$;
revoke all on function public.submit_warranty_claim(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_warranty_claim(text,text,text,text,text) to anon,authenticated;

drop policy if exists promotions_public_active on public.promotions;
drop policy if exists promotions_owner_manage on public.promotions;
drop policy if exists promotions_owner_read on public.promotions;
create policy promotions_public_active on public.promotions for select to anon using(is_active and (starts_at is null or starts_at<=current_date) and (ends_at is null or ends_at>=current_date));
create policy promotions_owner_read on public.promotions for select to authenticated using(private.is_owner(organization_id) or (is_active and (starts_at is null or starts_at<=current_date) and (ends_at is null or ends_at>=current_date)));
create policy promotions_owner_insert on public.promotions for insert to authenticated with check(private.is_owner(organization_id));
create policy promotions_owner_update on public.promotions for update to authenticated using(private.is_owner(organization_id)) with check(private.is_owner(organization_id));
create policy promotions_owner_delete on public.promotions for delete to authenticated using(private.is_owner(organization_id));

-- Serialized laptops, bulk sparepart lots, repair costs, and customer pricing type.
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

-- Serialized laptops, bulk sparepart lots, repair costs, and customer pricing type.
-- Restore per-unit acquisition cost from the historical supplier batch ledger.
update public.stock_items si
set acquisition_cost=ib.unit_cost
from public.intake_batches ib
where si.intake_batch_id=ib.id and si.acquisition_cost=0 and ib.unit_cost>0;

-- Let an owner remove a team login while preserving the operational records
-- created by that user. Historical actor references become NULL.
alter table public.team_invites drop constraint if exists team_invites_created_by_fkey;
alter table public.team_invites add constraint team_invites_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete cascade;

alter table public.stock_items drop constraint if exists stock_items_created_by_fkey;
alter table public.stock_items add constraint stock_items_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;
alter table public.stock_items drop constraint if exists stock_items_qc_by_fkey;
alter table public.stock_items add constraint stock_items_qc_by_fkey
  foreign key (qc_by) references auth.users(id) on delete set null;
alter table public.stock_movements drop constraint if exists stock_movements_created_by_fkey;
alter table public.stock_movements add constraint stock_movements_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;
alter table public.sales drop constraint if exists sales_cashier_id_fkey;
alter table public.sales add constraint sales_cashier_id_fkey
  foreign key (cashier_id) references auth.users(id) on delete set null;
alter table public.service_tickets drop constraint if exists service_tickets_created_by_fkey;
alter table public.service_tickets add constraint service_tickets_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;
alter table public.service_parts drop constraint if exists service_parts_created_by_fkey;
alter table public.service_parts add constraint service_parts_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;
alter table public.intake_batches drop constraint if exists intake_batches_created_by_fkey;
alter table public.intake_batches add constraint intake_batches_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;
alter table public.stock_repairs drop constraint if exists stock_repairs_technician_id_fkey;
alter table public.stock_repairs add constraint stock_repairs_technician_id_fkey
  foreign key (technician_id) references auth.users(id) on delete set null;
alter table public.stock_repair_parts drop constraint if exists stock_repair_parts_created_by_fkey;
alter table public.stock_repair_parts add constraint stock_repair_parts_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;
alter table public.cash_transactions drop constraint if exists cash_transactions_created_by_fkey;
alter table public.cash_transactions add constraint cash_transactions_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

-- Disable the public catalog, promotion feed, and anonymous warranty-claim
-- endpoint while retaining their historic records for possible later use.
drop view if exists public.public_catalog;
drop policy if exists products_public_catalog on public.products;
revoke select on public.products from anon;
revoke select (id,organization_id,name,brand,model,category,retail_price,is_public,image_path)
  on public.products from anon;

revoke all on public.promotions from anon,authenticated;
drop policy if exists promotions_public_active on public.promotions;
drop policy if exists promotions_owner_manage on public.promotions;
drop policy if exists promotions_owner_read on public.promotions;
drop policy if exists promotions_owner_insert on public.promotions;
drop policy if exists promotions_owner_update on public.promotions;
drop policy if exists promotions_owner_delete on public.promotions;

revoke execute on function public.submit_warranty_claim(text,text,text,text,text) from anon;
revoke execute on function private.submit_warranty_claim(text,text,text,text,text) from anon;

-- Internal warranty QR is separate from the intake barcode and starts when a
-- warrantied laptop is sold.
alter table public.stock_items add column if not exists warranty_code text;
update public.stock_items as item
set warranty_code = 'DLW-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))
where item.status = 'sold' and item.warranty_until is not null and item.warranty_code is null
  and exists (select 1 from public.products as product where product.id = item.product_id and product.category = 'Laptop');
create unique index if not exists stock_items_warranty_code_uidx on public.stock_items (warranty_code) where warranty_code is not null;
create or replace function private.assign_sold_laptop_warranty_code()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_category text;
begin
  if new.status = 'sold' and new.warranty_until is not null and new.warranty_code is null then
    select product.category into v_category from public.products as product where product.id = new.product_id;
    if v_category = 'Laptop' then new.warranty_code := 'DLW-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)); end if;
  end if;
  return new;
end;
$$;
revoke all on function private.assign_sold_laptop_warranty_code() from public, anon, authenticated;
drop trigger if exists assign_sold_laptop_warranty_code on public.stock_items;
create trigger assign_sold_laptop_warranty_code before insert or update on public.stock_items for each row execute function private.assign_sold_laptop_warranty_code();

create or replace function private.submit_warranty_claim(_code text,_customer_name text,_customer_phone text,_customer_email text,_issue text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_item public.stock_items%rowtype; v_claim text; v_phone text:=regexp_replace(coalesce(_customer_phone,''),'[^0-9+]','','g');
begin
  select organization_id into v_org from public.profiles where id=(select auth.uid()) and role in ('owner','operator');
  if v_org is null then raise exception 'Akun ini tidak dapat mencatat klaim garansi.'; end if;
  if length(btrim(coalesce(_customer_name,'')))<2 or length(btrim(coalesce(_customer_name,'')))>120 then raise exception 'Nama pelanggan harus 2–120 karakter.'; end if;
  if length(v_phone)<8 or length(v_phone)>24 then raise exception 'Nomor telepon tidak valid.'; end if;
  if length(btrim(coalesce(_issue,'')))<10 or length(btrim(coalesce(_issue,'')))>1200 then raise exception 'Jelaskan masalah dalam 10–1200 karakter.'; end if;
  if btrim(coalesce(_code,'')) !~* '^DLW-[A-Z0-9_-]{8,80}$' then raise exception 'Kode QR garansi tidak valid. Barcode stok tidak dapat dipakai untuk klaim.'; end if;
  select * into v_item from public.stock_items where organization_id=v_org and lower(warranty_code)=lower(btrim(_code)) limit 1;
  if not found or not private.can_operate_branch(v_item.branch_id) or v_item.status<>'sold' or v_item.warranty_until is null or v_item.warranty_until<current_date then raise exception 'Unit tidak ditemukan, belum terjual, atau masa garansinya sudah berakhir.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_item.id::text||':'||v_phone,0));
  if exists(select 1 from public.warranty_claims where stock_item_id=v_item.id and customer_phone=v_phone and created_at>now()-interval '12 hours') then raise exception 'Klaim untuk unit ini baru saja diterima. Hubungi toko untuk menanyakan statusnya.'; end if;
  v_claim:='WG-'||to_char(now() at time zone 'Asia/Jakarta','YYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  insert into public.warranty_claims(organization_id,branch_id,stock_item_id,claim_number,customer_name,customer_phone,customer_email,issue) values(v_org,v_item.branch_id,v_item.id,v_claim,btrim(_customer_name),v_phone,left(btrim(coalesce(_customer_email,'')),254),btrim(_issue));
  return v_claim;
end;
$$;
revoke all on function private.submit_warranty_claim(text,text,text,text,text) from public,anon,authenticated;
grant execute on function private.submit_warranty_claim(text,text,text,text,text) to authenticated;
grant usage on schema private to authenticated;
create or replace function public.submit_warranty_claim(_code text,_customer_name text,_customer_phone text,_customer_email text,_issue text)
returns text language sql security invoker set search_path = '' as $$ select private.submit_warranty_claim(_code,_customer_name,_customer_phone,_customer_email,_issue) $$;
revoke all on function public.submit_warranty_claim(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_warranty_claim(text,text,text,text,text) to authenticated;

-- Record goods already owned by a branch when Digi-Laptop is first introduced.
-- Opening stock is not a supplier invoice and does not create payable balances.
create table if not exists public.stock_opening_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  product_id uuid not null references public.products(id),
  unit_count integer not null check (unit_count between 1 and 500),
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  notes text not null default '',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.stock_items
  add column if not exists opening_batch_id uuid references public.stock_opening_batches(id);

create index if not exists stock_opening_batches_branch_created_idx
  on public.stock_opening_batches(branch_id, created_at desc);
create index if not exists stock_items_opening_batch_idx
  on public.stock_items(opening_batch_id) where opening_batch_id is not null;

alter table public.stock_opening_batches enable row level security;
grant select on public.stock_opening_batches to authenticated;
drop policy if exists stock_opening_batches_owner_read on public.stock_opening_batches;
create policy stock_opening_batches_owner_read on public.stock_opening_batches
  for select to authenticated using (private.is_owner(organization_id));

create or replace function private.record_opening_stock(
  _branch_id uuid,
  _product_id uuid,
  _quantity integer,
  _unit_cost numeric,
  _unit_details jsonb default '[]'::jsonb,
  _notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_batch uuid := gen_random_uuid();
  v_product public.products%rowtype;
  v_barcode text;
  v_serial text;
  v_item uuid;
  v_i integer;
  v_details jsonb := coalesce(_unit_details, '[]'::jsonb);
  v_items jsonb := '[]'::jsonb;
begin
  select organization_id into v_org
  from public.profiles
  where id = v_uid and role = 'owner';
  if v_org is null then raise exception 'Hanya pemilik yang dapat mencatat stok awal.'; end if;
  if not exists(select 1 from public.branches where id = _branch_id and organization_id = v_org and is_active) then
    raise exception 'Cabang tidak aktif atau bukan milik toko ini.';
  end if;
  if _quantity is null or _quantity < 1 or _quantity > 500 then raise exception 'Jumlah stok awal harus 1 sampai 500.'; end if;
  if _unit_cost is null or _unit_cost < 0 then raise exception 'Modal per unit tidak boleh negatif.'; end if;
  if jsonb_typeof(v_details) <> 'array' then raise exception 'Data unit tidak valid.'; end if;

  select * into v_product from public.products where id = _product_id and organization_id = v_org;
  if not found then raise exception 'Produk tidak ditemukan di toko ini. Buat produk terlebih dahulu.'; end if;
  if lower(v_product.category) = 'laptop' and jsonb_array_length(v_details) not in (0, _quantity) then
    raise exception 'Isi nomor seri untuk semua unit atau kosongkan semuanya.';
  end if;
  if lower(v_product.category) <> 'laptop' and jsonb_array_length(v_details) > 0 then
    raise exception 'Nomor seri per unit hanya berlaku untuk laptop.';
  end if;

  insert into public.stock_opening_batches(id, organization_id, branch_id, product_id, unit_count, unit_cost, notes, created_by)
  values(v_batch, v_org, _branch_id, _product_id, _quantity, _unit_cost, left(btrim(coalesce(_notes, '')), 1000), v_uid);

  if lower(v_product.category) = 'laptop' then
    for v_i in 1.._quantity loop
      v_barcode := 'DL-O-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
      v_serial := case when jsonb_array_length(v_details) = 0 then '' else left(btrim(coalesce(v_details->(v_i - 1)->>'serial_number', '')), 120) end;
      insert into public.stock_items(organization_id, branch_id, product_id, barcode, serial_number, quantity, status, qc_stage, acquisition_cost, opening_batch_id, created_by)
      values(v_org, _branch_id, _product_id, v_barcode, v_serial, 1, 'available', 'initial', _unit_cost, v_batch, v_uid)
      returning id into v_item;
      insert into public.stock_movements(organization_id, branch_id, product_id, stock_item_id, movement_type, quantity, reference, note, created_by)
      values(v_org, _branch_id, _product_id, v_item, 'receive', 1, 'OPENING-' || v_batch::text, 'Stok awal · sudah tersedia sebelum Digi-Laptop', v_uid);
      v_items := v_items || jsonb_build_array(jsonb_build_object('id', v_item, 'barcode', v_barcode, 'serial_number', v_serial, 'quantity', 1));
    end loop;
  else
    v_barcode := 'DL-O-P-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    insert into public.stock_items(organization_id, branch_id, product_id, barcode, quantity, status, qc_stage, acquisition_cost, opening_batch_id, created_by)
    values(v_org, _branch_id, _product_id, v_barcode, _quantity, 'available', 'initial', _unit_cost, v_batch, v_uid)
    returning id into v_item;
    insert into public.stock_movements(organization_id, branch_id, product_id, stock_item_id, movement_type, quantity, reference, note, created_by)
    values(v_org, _branch_id, _product_id, v_item, 'receive', _quantity, 'OPENING-' || v_batch::text, 'Stok awal · sudah tersedia sebelum Digi-Laptop', v_uid);
    v_items := jsonb_build_array(jsonb_build_object('id', v_item, 'barcode', v_barcode, 'serial_number', '', 'quantity', _quantity));
  end if;

  return jsonb_build_object('batch_id', v_batch, 'items', v_items);
end;
$$;

revoke all on function private.record_opening_stock(uuid, uuid, integer, numeric, jsonb, text) from public, anon, authenticated;
grant execute on function private.record_opening_stock(uuid, uuid, integer, numeric, jsonb, text) to authenticated;
grant usage on schema private to authenticated;

create or replace function public.record_opening_stock(
  _branch_id uuid,
  _product_id uuid,
  _quantity integer,
  _unit_cost numeric,
  _unit_details jsonb default '[]'::jsonb,
  _notes text default ''
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.record_opening_stock(_branch_id, _product_id, _quantity, _unit_cost, _unit_details, _notes)
$$;
revoke all on function public.record_opening_stock(uuid, uuid, integer, numeric, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_opening_stock(uuid, uuid, integer, numeric, jsonb, text) to authenticated;


-- Customer service tickets are worked by the branch technician and handed back to the operator.
alter table public.service_tickets
  add column if not exists assigned_technician_id uuid references auth.users(id) on delete set null,
  add column if not exists technician_note text not null default '';

create index if not exists service_tickets_assignee_status_idx
  on public.service_tickets(branch_id, assigned_technician_id, status, created_at desc);

create or replace function private.can_work_service_ticket(_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.service_tickets t on t.id = _ticket_id
    where p.id = (select auth.uid())
      and p.organization_id = t.organization_id
      and p.branch_id = t.branch_id
      and p.role = 'technician'
      and (t.assigned_technician_id is null or t.assigned_technician_id = p.id)
  )
$$;

revoke all on function private.can_work_service_ticket(uuid) from public, anon;
grant execute on function private.can_work_service_ticket(uuid) to authenticated;
grant usage on schema private to authenticated;

drop policy if exists services_read_branch on public.service_tickets;
create policy services_read_branch on public.service_tickets
for select to authenticated
using (private.can_operate_branch(branch_id) or private.can_work_service_ticket(id));

drop policy if exists services_add_branch on public.service_tickets;
create policy services_add_branch on public.service_tickets
for insert to authenticated
with check (
  private.can_operate_branch(branch_id)
  and private.is_org_member(organization_id)
  and (
    assigned_technician_id is null
    or exists (
      select 1 from public.profiles p
      where p.id = assigned_technician_id
        and p.organization_id = service_tickets.organization_id
        and p.branch_id = service_tickets.branch_id
        and p.role = 'technician'
    )
  )
);

drop policy if exists services_update_branch on public.service_tickets;
revoke update on public.service_tickets from anon, authenticated;

drop policy if exists service_parts_read_branch on public.service_parts;
create policy service_parts_read_branch on public.service_parts
for select to authenticated
using (
  exists (
    select 1 from public.service_tickets t
    where t.id = ticket_id
      and (private.can_operate_branch(t.branch_id) or private.can_work_service_ticket(t.id))
  )
);

create or replace function private.update_customer_service(
  _ticket_id uuid,
  _status text,
  _technician_note text,
  _estimated_cost numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_ticket public.service_tickets%rowtype;
  v_technician_name text;
begin
  select role, full_name into v_role, v_technician_name
  from public.profiles where id = v_uid;
  if v_role is null then raise exception 'Akun tidak ditemukan.'; end if;

  select * into v_ticket from public.service_tickets
  where id = _ticket_id for update;
  if not found then raise exception 'Tiket servis tidak ditemukan.'; end if;
  if _estimated_cost is null or _estimated_cost < 0 then
    raise exception 'Estimasi biaya tidak valid.';
  end if;

  if v_role = 'technician' then
    if not private.can_work_service_ticket(_ticket_id) then
      raise exception 'Tiket ini bukan antrean teknisi cabang lo.';
    end if;
    if _status not in ('diagnosing','waiting_approval','waiting_parts','repairing','ready') then
      raise exception 'Status tersebut hanya dapat diubah oleh operator.';
    end if;
    if v_ticket.status in ('handed_over','cancelled') then
      raise exception 'Tiket yang sudah ditutup tidak dapat diubah.';
    end if;
    if (v_ticket.status = 'received' and _status <> 'diagnosing')
      or (v_ticket.status = 'diagnosing' and _status not in ('waiting_approval','waiting_parts','repairing'))
      or (v_ticket.status = 'waiting_approval' and _status not in ('waiting_parts','repairing'))
      or (v_ticket.status = 'waiting_parts' and _status <> 'repairing')
      or (v_ticket.status = 'repairing' and _status not in ('waiting_parts','ready'))
      or (v_ticket.status = 'ready' and _status <> 'repairing') then
      raise exception 'Urutan status pekerjaan tidak sesuai. Periksa status tiket saat ini.';
    end if;
    update public.service_tickets
    set status = _status,
        assigned_technician_id = coalesce(assigned_technician_id, v_uid),
        technician_name = v_technician_name,
        technician_note = left(btrim(coalesce(_technician_note,'')), 4000),
        estimated_cost = _estimated_cost,
        updated_at = now()
    where id = _ticket_id;
  elsif v_role in ('owner','operator') then
    if not private.can_operate_branch(v_ticket.branch_id) then
      raise exception 'Tiket servis tidak ditemukan untuk cabang ini.';
    end if;
    if _status <> 'cancelled' or v_ticket.status in ('handed_over','cancelled','ready') then
      raise exception 'Operator hanya dapat membatalkan tiket yang belum siap diserahkan.';
    end if;
    if exists (select 1 from public.service_parts where ticket_id = _ticket_id) then
      raise exception 'Tiket dengan sparepart terpakai tidak dapat dibatalkan.';
    end if;
    update public.service_tickets set status = 'cancelled', updated_at = now()
    where id = _ticket_id;
  else
    raise exception 'Role ini tidak dapat mengelola tiket servis pelanggan.';
  end if;
end;
$$;

revoke all on function private.update_customer_service(uuid,text,text,numeric) from public, anon, authenticated;
grant execute on function private.update_customer_service(uuid,text,text,numeric) to authenticated;

create or replace function public.update_customer_service(
  _ticket_id uuid,
  _status text,
  _technician_note text default '',
  _estimated_cost numeric default 0
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.update_customer_service(_ticket_id, _status, _technician_note, _estimated_cost)
$$;
revoke all on function public.update_customer_service(uuid,text,text,numeric) from public, anon, authenticated;
grant execute on function public.update_customer_service(uuid,text,text,numeric) to authenticated;

create or replace function private.use_service_part(_ticket_id uuid, _stock_item_id uuid, _quantity integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.service_tickets%rowtype;
  v_stock public.stock_items%rowtype;
  v_uid uuid := (select auth.uid());
  v_role text;
begin
  select role into v_role from public.profiles where id = v_uid;
  select * into v_ticket from public.service_tickets where id = _ticket_id for update;
  if not found then raise exception 'Tiket servis tidak ditemukan.'; end if;
  if v_role in ('owner','operator') then
    if not private.can_operate_branch(v_ticket.branch_id) then raise exception 'Tiket servis tidak ditemukan untuk cabang ini.'; end if;
  elsif v_role = 'technician' then
    if not private.can_work_service_ticket(_ticket_id) or v_ticket.status <> 'repairing' then
      raise exception 'Sparepart hanya dapat dicatat oleh teknisi yang mengerjakan tiket.';
    end if;
  else
    raise exception 'Role ini tidak dapat memakai sparepart servis.';
  end if;
  if v_ticket.status in ('handed_over','cancelled') then raise exception 'Tiket sudah ditutup.'; end if;
  if _quantity is null or _quantity < 1 then raise exception 'Jumlah sparepart tidak valid.'; end if;

  select * into v_stock from public.stock_items
  where id = _stock_item_id and branch_id = v_ticket.branch_id
    and status = 'available' and quantity >= _quantity for update;
  if not found then raise exception 'Stok sparepart tidak cukup di cabang tiket.'; end if;

  update public.stock_items
  set quantity = quantity - _quantity,
      status = case when quantity - _quantity = 0 then 'used_for_service' else status end
  where id = v_stock.id;
  insert into public.service_parts(organization_id, ticket_id, stock_item_id, product_name, quantity, cost, created_by)
  select v_ticket.organization_id, _ticket_id, v_stock.id, p.name, _quantity,
         v_stock.acquisition_cost * _quantity, v_uid
  from public.products p where p.id = v_stock.product_id;
  insert into public.stock_movements(organization_id, branch_id, product_id, stock_item_id, movement_type, quantity, reference, created_by)
  values(v_ticket.organization_id, v_ticket.branch_id, v_stock.product_id, v_stock.id, 'service_use', -_quantity, v_ticket.ticket_number, v_uid);
  update public.service_tickets set updated_at = now() where id = _ticket_id;
end;
$$;
revoke all on function private.use_service_part(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function private.use_service_part(uuid,uuid,integer) to authenticated;

create or replace function private.complete_service_handover(
  _ticket_id uuid, _final_cost numeric, _paid_amount numeric, _due_date date, _handover_photo_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_branch uuid;
  v_number text;
  v_customer text;
  v_status text;
begin
  select organization_id, branch_id, ticket_number, customer_name, status
  into v_org, v_branch, v_number, v_customer, v_status
  from public.service_tickets where id = _ticket_id for update;
  if v_org is null or not private.can_operate_branch(v_branch) then raise exception 'Tiket servis tidak ditemukan untuk cabang ini.'; end if;
  if v_status <> 'ready' then raise exception 'Teknisi harus menandai tiket siap diambil sebelum serah terima.'; end if;
  if _final_cost is null or _final_cost < 0 or _paid_amount is null or _paid_amount < 0 or _paid_amount > _final_cost then
    raise exception 'Biaya dan pembayaran servis tidak valid.';
  end if;
  if _paid_amount < _final_cost and _due_date is null then raise exception 'Tanggal jatuh tempo wajib untuk piutang servis.'; end if;
  if _handover_photo_path !~ ('^' || v_org::text || '/' || v_branch::text || '/' || _ticket_id::text || '/handover[.]jpg$') then
    raise exception 'Lokasi foto serah terima tidak sesuai tiket.';
  end if;
  update public.service_tickets
  set status = 'handed_over', final_cost = _final_cost, paid_amount = _paid_amount,
      due_date = case when _paid_amount < _final_cost then _due_date else null end,
      handover_photo_path = _handover_photo_path, updated_at = now()
  where id = _ticket_id;
  if _paid_amount > 0 then
    insert into public.cash_transactions(organization_id, branch_id, direction, category, amount, description, source_type, source_id, created_by)
    values(v_org, v_branch, 'income', 'Penerimaan servis', _paid_amount,
      'Pembayaran servis ' || v_number || ' · ' || v_customer, 'service_ticket', _ticket_id, v_uid);
  end if;
end;
$$;
revoke all on function private.complete_service_handover(uuid,numeric,numeric,date,text) from public, anon, authenticated;
grant execute on function private.complete_service_handover(uuid,numeric,numeric,date,text) to authenticated;

drop policy if exists service_evidence_read_member on storage.objects;
create policy service_evidence_read_member on storage.objects
for select to authenticated
using (
  bucket_id = 'service-evidence'
  and (storage.foldername(name))[1] = (select p.organization_id::text from public.profiles p where p.id = (select auth.uid()))
  and (
    private.can_operate_branch(((storage.foldername(name))[2])::uuid)
    or (
      (storage.foldername(name))[2] = (select p.branch_id::text from public.profiles p where p.id = (select auth.uid()))
      and private.can_work_service_ticket(((storage.foldername(name))[3])::uuid)
    )
  )
);
alter table public.service_tickets
  add column if not exists customer_id uuid references public.customers(id) on delete set null;

create index if not exists service_tickets_customer_branch_idx
  on public.service_tickets(customer_id, branch_id, created_at desc);

-- Link only existing tickets whose normalized name maps to one contact in the organization.
update public.service_tickets t
set customer_id = c.id
from public.customers c
where t.customer_id is null
  and c.organization_id = t.organization_id
  and lower(btrim(c.name)) = lower(btrim(t.customer_name))
  and (
    select count(*)
    from public.customers c2
    where c2.organization_id = t.organization_id
      and lower(btrim(c2.name)) = lower(btrim(t.customer_name))
  ) = 1;

create or replace function private.validate_service_ticket_customer_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.customer_id is not null and not exists (
    select 1 from public.customers c
    where c.id = new.customer_id and c.organization_id = new.organization_id
  ) then
    raise exception 'Pelanggan harus berasal dari organisasi toko yang sama.';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_service_ticket_customer_scope() from public, anon, authenticated;

drop trigger if exists service_tickets_customer_scope on public.service_tickets;
create trigger service_tickets_customer_scope
before insert or update of customer_id, organization_id on public.service_tickets
for each row execute function private.validate_service_ticket_customer_scope();

create or replace function private.create_customer_service_ticket(
  _ticket_id uuid,
  _branch_id uuid,
  _ticket_number text,
  _customer_id uuid,
  _customer_name text,
  _customer_phone text,
  _device_name text,
  _serial_number text,
  _complaint text,
  _estimated_cost numeric,
  _assigned_technician_id uuid,
  _intake_photo_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_role text;
  v_customer_id uuid := _customer_id;
  v_customer_name text;
  v_customer_phone text;
begin
  select organization_id, role into v_org, v_role
  from public.profiles where id = v_uid;
  if v_org is null or v_role not in ('owner','operator') then
    raise exception 'Hanya pemilik atau operator yang dapat menerima servis pelanggan.';
  end if;
  if not private.can_operate_branch(_branch_id) or not exists (
    select 1 from public.branches b where b.id = _branch_id and b.organization_id = v_org and b.is_active
  ) then
    raise exception 'Cabang tidak aktif atau bukan cabang toko ini.';
  end if;
  if _ticket_id is null or nullif(btrim(coalesce(_ticket_number,'')), '') is null then
    raise exception 'Nomor tiket tidak valid.';
  end if;
  if nullif(btrim(coalesce(_device_name,'')), '') is null
     or nullif(btrim(coalesce(_complaint,'')), '') is null then
    raise exception 'Unit dan keluhan pelanggan wajib diisi.';
  end if;
  if _estimated_cost is null or _estimated_cost < 0 then
    raise exception 'Estimasi biaya servis tidak valid.';
  end if;
  if _intake_photo_path !~ ('^' || v_org::text || '/' || _branch_id::text || '/' || _ticket_id::text || '/intake[.]jpg$') then
    raise exception 'Lokasi foto kondisi awal tidak sesuai tiket.';
  end if;
  if _assigned_technician_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = _assigned_technician_id
      and p.organization_id = v_org and p.branch_id = _branch_id and p.role = 'technician'
  ) then
    raise exception 'Teknisi harus berasal dari cabang tiket ini.';
  end if;

  if v_customer_id is null then
    v_customer_name := left(btrim(coalesce(_customer_name,'')), 160);
    v_customer_phone := left(btrim(coalesce(_customer_phone,'')), 40);
    if v_customer_name = '' then raise exception 'Nama pelanggan wajib diisi.'; end if;
    insert into public.customers(organization_id, name, phone, customer_type)
    values(v_org, v_customer_name, v_customer_phone, 'end_user')
    returning id into v_customer_id;
  else
    select c.name, c.phone into v_customer_name, v_customer_phone
    from public.customers c where c.id = v_customer_id and c.organization_id = v_org;
    if not found then raise exception 'Pelanggan tidak ditemukan di data toko.'; end if;
  end if;

  insert into public.service_tickets(
    id, organization_id, branch_id, ticket_number, customer_id, customer_name, customer_phone,
    device_name, serial_number, complaint, estimated_cost, assigned_technician_id,
    technician_name, created_by, intake_photo_path
  )
  values(
    _ticket_id, v_org, _branch_id, left(btrim(_ticket_number), 60), v_customer_id,
    v_customer_name, v_customer_phone, left(btrim(_device_name), 160),
    left(btrim(coalesce(_serial_number,'')), 120), left(btrim(_complaint), 4000),
    _estimated_cost, _assigned_technician_id,
    coalesce((select p.full_name from public.profiles p where p.id = _assigned_technician_id), ''),
    v_uid, _intake_photo_path
  );
  return _ticket_id;
end;
$$;
revoke all on function private.create_customer_service_ticket(uuid,uuid,text,uuid,text,text,text,text,text,numeric,uuid,text) from public, anon, authenticated;
grant execute on function private.create_customer_service_ticket(uuid,uuid,text,uuid,text,text,text,text,text,numeric,uuid,text) to authenticated;

create or replace function public.create_customer_service_ticket(
  _ticket_id uuid,
  _branch_id uuid,
  _ticket_number text,
  _customer_id uuid,
  _customer_name text,
  _customer_phone text,
  _device_name text,
  _serial_number text,
  _complaint text,
  _estimated_cost numeric,
  _assigned_technician_id uuid,
  _intake_photo_path text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_customer_service_ticket(
    _ticket_id, _branch_id, _ticket_number, _customer_id, _customer_name, _customer_phone,
    _device_name, _serial_number, _complaint, _estimated_cost, _assigned_technician_id, _intake_photo_path
  )
$$;
revoke all on function public.create_customer_service_ticket(uuid,uuid,text,uuid,text,text,text,text,text,numeric,uuid,text) from public, anon, authenticated;
grant execute on function public.create_customer_service_ticket(uuid,uuid,text,uuid,text,text,text,text,text,numeric,uuid,text) to authenticated;

create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  transfer_number text not null,
  source_branch_id uuid not null references public.branches(id),
  destination_branch_id uuid not null references public.branches(id),
  status text not null default 'in_transit' check (status in ('in_transit','received')),
  note text not null default '',
  created_by uuid references auth.users(id),
  received_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  shipped_at timestamptz not null default now(),
  received_at timestamptz,
  unique (organization_id, transfer_number),
  check (source_branch_id <> destination_branch_id),
  check ((status = 'in_transit' and received_at is null and received_by is null)
      or (status = 'received' and received_at is not null and received_by is not null))
);

create table if not exists public.stock_transfer_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  transfer_id uuid not null references public.stock_transfers(id),
  product_id uuid not null references public.products(id),
  source_stock_item_id uuid not null references public.stock_items(id),
  received_stock_item_id uuid references public.stock_items(id),
  source_barcode text not null,
  target_barcode text,
  quantity integer not null check (quantity > 0),
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  split_lot boolean not null default false,
  created_at timestamptz not null default now(),
  unique (transfer_id, source_stock_item_id)
);

create index if not exists stock_transfers_source_created_idx
  on public.stock_transfers(source_branch_id, created_at desc);
create index if not exists stock_transfers_destination_created_idx
  on public.stock_transfers(destination_branch_id, created_at desc);
create index if not exists stock_transfer_items_transfer_idx
  on public.stock_transfer_items(transfer_id, created_at);
create index if not exists stock_transfer_items_source_stock_idx
  on public.stock_transfer_items(source_stock_item_id);

alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_items enable row level security;
revoke all on public.stock_transfers, public.stock_transfer_items from anon, authenticated;
grant select on public.stock_transfers, public.stock_transfer_items to authenticated;

drop policy if exists stock_transfers_read_member on public.stock_transfers;
create policy stock_transfers_read_member on public.stock_transfers
for select to authenticated
using (
  private.is_owner(organization_id)
  or private.can_operate_branch(source_branch_id)
  or private.can_operate_branch(destination_branch_id)
);

drop policy if exists stock_transfer_items_read_member on public.stock_transfer_items;
create policy stock_transfer_items_read_member on public.stock_transfer_items
for select to authenticated
using (
  exists (
    select 1 from public.stock_transfers t
    where t.id = transfer_id
      and (
        private.is_owner(t.organization_id)
        or private.can_operate_branch(t.source_branch_id)
        or private.can_operate_branch(t.destination_branch_id)
      )
  )
);

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
  if v_org is null or v_role not in ('owner','operator') then
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
revoke all on function private.create_stock_transfer(uuid,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function private.create_stock_transfer(uuid,uuid,jsonb,text) to authenticated;

create or replace function public.create_stock_transfer(
  _source_branch_id uuid,
  _destination_branch_id uuid,
  _items jsonb,
  _note text default ''
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.create_stock_transfer(_source_branch_id, _destination_branch_id, _items, _note) $$;
revoke all on function public.create_stock_transfer(uuid,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.create_stock_transfer(uuid,uuid,jsonb,text) to authenticated;

create or replace function private.receive_stock_transfer(_transfer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_role text;
  v_transfer public.stock_transfers%rowtype;
  v_item public.stock_transfer_items%rowtype;
  v_source public.stock_items%rowtype;
  v_target_id uuid;
  v_target_barcode text;
  v_count integer := 0;
  v_result jsonb := '[]'::jsonb;
begin
  select organization_id, role into v_org, v_role from public.profiles where id = v_uid;
  if v_org is null or v_role not in ('owner','operator') then
    raise exception 'Hanya pemilik atau operator yang dapat menerima mutasi stok.';
  end if;
  select * into v_transfer from public.stock_transfers where id = _transfer_id and organization_id = v_org for update;
  if not found then raise exception 'Mutasi tidak ditemukan.'; end if;
  if v_transfer.status <> 'in_transit' then raise exception 'Mutasi ini sudah pernah diterima.'; end if;
  if v_role = 'operator' and not private.can_operate_branch(v_transfer.destination_branch_id) then
    raise exception 'Operator hanya dapat menerima mutasi untuk cabangnya sendiri.';
  end if;

  for v_item in select * from public.stock_transfer_items where transfer_id = v_transfer.id order by created_at for update
  loop
    select * into v_source from public.stock_items where id = v_item.source_stock_item_id for update;
    if not found then raise exception 'Asal stok untuk % tidak ditemukan.', v_item.source_barcode; end if;
    if v_item.split_lot then
      v_target_id := gen_random_uuid();
      v_target_barcode := 'DL-M-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
      insert into public.stock_items(
        organization_id, branch_id, product_id, barcode, supplier_barcode, serial_number,
        supplier, supplier_id, quantity, status, qc_stage, qc_notes, qc_by, qc_at,
        acquisition_cost, intake_batch_id, created_by
      ) values(
        v_org, v_transfer.destination_branch_id, v_item.product_id, v_target_barcode,
        v_source.supplier_barcode, '', v_source.supplier, v_source.supplier_id,
        v_item.quantity, 'available', v_source.qc_stage, v_source.qc_notes,
        v_source.qc_by, v_source.qc_at, v_item.unit_cost, v_source.intake_batch_id, v_uid
      );
    else
      if v_source.status <> 'transferred' or v_source.quantity <> 0 then
        raise exception 'Stok % tidak berada dalam status perjalanan.', v_item.source_barcode;
      end if;
      v_target_id := v_source.id;
      v_target_barcode := v_source.barcode;
      update public.stock_items
      set branch_id = v_transfer.destination_branch_id, quantity = v_item.quantity, status = 'available'
      where id = v_source.id;
    end if;

    update public.stock_transfer_items
    set received_stock_item_id = v_target_id, target_barcode = v_target_barcode
    where id = v_item.id;
    insert into public.stock_movements(organization_id, branch_id, product_id, stock_item_id, movement_type, quantity, reference, note, created_by)
    values(v_org, v_transfer.destination_branch_id, v_item.product_id, v_target_id, 'transfer_in', v_item.quantity,
      v_transfer.transfer_number, 'Mutasi dari ' || (select b.name from public.branches b where b.id = v_transfer.source_branch_id), v_uid);
    v_result := v_result || jsonb_build_array(jsonb_build_object('product_id', v_item.product_id, 'quantity', v_item.quantity, 'source_barcode', v_item.source_barcode, 'target_barcode', v_target_barcode));
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then raise exception 'Mutasi tidak memiliki baris barang.'; end if;
  update public.stock_transfers
  set status = 'received', received_by = v_uid, received_at = now()
  where id = v_transfer.id;
  return jsonb_build_object('transfer_number', v_transfer.transfer_number, 'item_count', v_count, 'items', v_result, 'status', 'received');
end;
$$;
revoke all on function private.receive_stock_transfer(uuid) from public, anon, authenticated;
grant execute on function private.receive_stock_transfer(uuid) to authenticated;

create or replace function public.receive_stock_transfer(_transfer_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.receive_stock_transfer(_transfer_id) $$;
revoke all on function public.receive_stock_transfer(uuid) from public, anon, authenticated;
grant execute on function public.receive_stock_transfer(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stock_transfers') then
    alter publication supabase_realtime add table public.stock_transfers;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stock_transfer_items') then
    alter publication supabase_realtime add table public.stock_transfer_items;
  end if;
end;
$$;

create index if not exists stock_transfers_org_idx on public.stock_transfers(organization_id);
create index if not exists stock_transfers_created_by_idx on public.stock_transfers(created_by);
create index if not exists stock_transfers_received_by_idx on public.stock_transfers(received_by);
create index if not exists stock_transfer_items_org_idx on public.stock_transfer_items(organization_id);
create index if not exists stock_transfer_items_product_idx on public.stock_transfer_items(product_id);
create index if not exists stock_transfer_items_received_stock_idx on public.stock_transfer_items(received_stock_item_id);

alter table public.service_tickets
  add column if not exists handed_over_at timestamptz;

update public.service_tickets
set handed_over_at = updated_at
where status = 'handed_over' and handed_over_at is null;

create or replace function private.complete_service_handover(
  _ticket_id uuid, _final_cost numeric, _paid_amount numeric, _due_date date, _handover_photo_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_branch uuid;
  v_number text;
  v_customer text;
  v_status text;
begin
  select organization_id, branch_id, ticket_number, customer_name, status
  into v_org, v_branch, v_number, v_customer, v_status
  from public.service_tickets where id = _ticket_id for update;
  if v_org is null or not private.can_operate_branch(v_branch) then
    raise exception 'Tiket servis tidak ditemukan untuk cabang ini.';
  end if;
  if v_status <> 'ready' then
    raise exception 'Teknisi harus menandai tiket siap diambil sebelum serah terima.';
  end if;
  if _final_cost is null or _final_cost < 0 or _paid_amount is null or _paid_amount < 0 or _paid_amount > _final_cost then
    raise exception 'Biaya dan pembayaran servis tidak valid.';
  end if;
  if _paid_amount < _final_cost and _due_date is null then
    raise exception 'Tanggal jatuh tempo wajib untuk piutang servis.';
  end if;
  if _handover_photo_path !~ ('^' || v_org::text || '/' || v_branch::text || '/' || _ticket_id::text || '/handover[.]jpg$') then
    raise exception 'Lokasi foto serah terima tidak sesuai tiket.';
  end if;

  update public.service_tickets
  set status = 'handed_over', final_cost = _final_cost, paid_amount = _paid_amount,
      due_date = case when _paid_amount < _final_cost then _due_date else null end,
      handover_photo_path = _handover_photo_path, handed_over_at = now(), updated_at = now()
  where id = _ticket_id;
  if _paid_amount > 0 then
    insert into public.cash_transactions(organization_id, branch_id, direction, category, amount, description, source_type, source_id, created_by)
    values(v_org, v_branch, 'income', 'Penerimaan servis', _paid_amount,
      'Pembayaran servis ' || v_number || ' · ' || v_customer, 'service_ticket', _ticket_id, v_uid);
  end if;
end;
$$;

revoke all on function private.complete_service_handover(uuid,numeric,numeric,date,text) from public, anon, authenticated;
grant execute on function private.complete_service_handover(uuid,numeric,numeric,date,text) to authenticated;
create or replace function public.restore_digi_laptop_backup(_backup jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_table text;
  v_keys text[];
  v_columns text;
  v_updates text;
  v_total integer := 0;
  v_count integer;
  v_identity jsonb;
  v_allowed constant text[] := array[
    'branches','products','suppliers','customers','intake_batches','stock_opening_batches',
    'stock_items','stock_transfers','stock_transfer_items','stock_repairs','stock_repair_parts',
    'sales','sale_items','service_tickets','service_parts','cash_transactions','stock_movements','warranty_claims'
  ];
begin
  select organization_id into v_org from public.profiles where id = v_uid and role = 'owner';
  if v_org is null then raise exception 'Pemulihan cadangan hanya dapat dilakukan oleh pemilik toko.'; end if;
  if jsonb_typeof(_backup) <> 'object'
    or _backup->>'format' <> 'digi-laptop-backup'
    or (_backup->>'version') not in ('1','2')
    or (_backup->>'organization_id')::uuid is distinct from v_org
    or jsonb_typeof(_backup->'tables') <> 'object' then
    raise exception 'Cadangan tidak valid atau bukan milik organisasi ini.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(_backup #> '{tables,sale_items}', '[]'::jsonb)) item
    where not exists (
      select 1 from jsonb_array_elements(coalesce(_backup #> '{tables,sales}', '[]'::jsonb)) parent
      where parent->>'id' = item->>'sale_id'
    )
  ) then raise exception 'Item penjualan merujuk nota yang tidak ada dalam cadangan.'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(_backup #> '{tables,stock_repair_parts}', '[]'::jsonb)) item
    where not exists (
      select 1 from jsonb_array_elements(coalesce(_backup #> '{tables,stock_repairs}', '[]'::jsonb)) parent
      where parent->>'id' = item->>'repair_id'
    )
  ) then raise exception 'Sparepart repair merujuk repair yang tidak ada dalam cadangan.'; end if;

  foreach v_table in array v_allowed loop
    if _backup->'tables' ? v_table then
      if jsonb_typeof(_backup->'tables'->v_table) <> 'array' then
        raise exception 'Bagian % pada cadangan bukan daftar data.', v_table;
      end if;
      if v_table not in ('sale_items','stock_repair_parts') and exists (
        select 1 from jsonb_array_elements(_backup->'tables'->v_table) row_data
        where (row_data->>'organization_id')::uuid is distinct from v_org
      ) then raise exception 'Data % berasal dari organisasi lain.', v_table; end if;
    end if;
  end loop;

  foreach v_table in array v_allowed loop
    if jsonb_array_length(coalesce(_backup->'tables'->v_table, '[]'::jsonb)) = 0 then continue; end if;
    select array_agg(key) into v_keys from jsonb_object_keys((_backup->'tables'->v_table)->0) key;
    if not ('id' = any(coalesce(v_keys, array[]::text[]))) then
      raise exception 'Data % tidak memiliki ID.', v_table;
    end if;
    select string_agg(format('%I', a.attname), ', ' order by a.attnum),
           string_agg(format('%I = excluded.%I', a.attname, a.attname), ', ' order by a.attnum)
      into v_columns, v_updates
    from pg_attribute a
    where a.attrelid = format('public.%I', v_table)::regclass
      and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
      and a.attname = any(v_keys);
    if v_columns is null then raise exception 'Kolom cadangan % tidak dikenali.', v_table; end if;
    v_updates := (select string_agg(format('%I = excluded.%I', a.attname, a.attname), ', ' order by a.attnum)
      from pg_attribute a where a.attrelid = format('public.%I', v_table)::regclass
        and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
        and a.attname = any(v_keys) and a.attname <> 'id');
    execute format(
      'insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) on conflict (id) %s',
      v_table, v_columns, v_columns, v_table,
      case when v_updates is null then 'do nothing' else 'do update set ' || v_updates end
    ) using _backup->'tables'->v_table;
    get diagnostics v_count = row_count;
    v_total := v_total + v_count;
  end loop;

  v_identity := coalesce(_backup->'organization', '{}'::jsonb);
  update public.organizations
  set name = coalesce(nullif(v_identity->>'name',''), name),
      phone = coalesce(v_identity->>'phone', phone),
      address = coalesce(v_identity->>'address', address)
  where id = v_org;
  return v_total;
end;
$$;

revoke all on function public.restore_digi_laptop_backup(jsonb) from public, anon;
grant execute on function public.restore_digi_laptop_backup(jsonb) to authenticated;

-- Final API privileges: internal helpers are not exposed to anonymous users.
revoke usage on schema private from public, anon;
grant usage on schema private to authenticated, service_role;
revoke all on function private.copy_intake_unit_cost() from public, anon, authenticated;
alter function public.restore_digi_laptop_backup(jsonb) set schema private;

create or replace function public.restore_digi_laptop_backup(_backup jsonb)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.restore_digi_laptop_backup(_backup)
$$;

revoke all on function private.restore_digi_laptop_backup(jsonb) from public, anon;
grant execute on function private.restore_digi_laptop_backup(jsonb) to authenticated;
revoke all on function public.restore_digi_laptop_backup(jsonb) from public, anon;
grant execute on function public.restore_digi_laptop_backup(jsonb) to authenticated;
