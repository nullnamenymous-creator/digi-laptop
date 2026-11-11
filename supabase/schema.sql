-- Digi-Laptop shared database. Run once in the SQL Editor of a dedicated Supabase project.
create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
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
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and (p.role = 'owner' or p.branch_id = _branch_id))
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
  bucket_id = 'service-evidence' and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role = 'owner' or ((storage.foldername(name))[1] = p.organization_id::text and private.can_access_branch(((storage.foldername(name))[2])::uuid))))
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
    foreach v_table in array array['stock_items','stock_repairs','intake_batches'] loop
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
    select 1 from public.profiles p
    where p.id = (select auth.uid())
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
