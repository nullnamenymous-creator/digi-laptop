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
  role text not null check (role in ('owner','operator')),
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

create or replace function public.is_org_member(_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.organization_id = _organization_id)
$$;

create or replace function public.is_owner(_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.organization_id = _organization_id and p.role = 'owner')
$$;

create or replace function public.can_access_branch(_branch_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and (p.role = 'owner' or p.branch_id = _branch_id))
$$;

revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.is_owner(uuid) from public;
revoke all on function public.can_access_branch(uuid) from public;
grant execute on function public.is_org_member(uuid), public.is_owner(uuid), public.can_access_branch(uuid) to authenticated;

create or replace function public.bootstrap_owner(_store_name text, _branch_names text[])
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
revoke all on function public.bootstrap_owner(text, text[]) from public;
grant execute on function public.bootstrap_owner(text, text[]) to authenticated;

create or replace function public.receive_stock(_branch_id uuid, _product_id uuid, _supplier text, _units jsonb)
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
revoke all on function public.receive_stock(uuid,uuid,text,jsonb) from public;
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

create or replace function public.create_sale(_branch_id uuid, _customer_name text, _customer_type text, _payment_method text, _lines jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_org uuid; v_sale uuid := gen_random_uuid(); v_total numeric(14,2) := 0;
  v_receipt text := 'DL-' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD-HH24MISS') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,5));
  v_line jsonb; v_product public.products%rowtype; v_stock public.stock_items%rowtype; v_qty integer; v_price numeric(14,2); v_left integer; v_take integer;
begin
  select organization_id into v_org from public.profiles where id = v_uid;
  if v_org is null or not public.can_access_branch(_branch_id) then raise exception 'Tidak punya akses ke cabang ini.'; end if;
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
revoke all on function public.create_sale(uuid,text,text,text,jsonb) from public;
grant execute on function public.create_sale(uuid,text,text,text,jsonb) to authenticated;

create or replace function public.use_service_part(_ticket_id uuid, _stock_item_id uuid, _quantity integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ticket public.service_tickets%rowtype; v_stock public.stock_items%rowtype; v_uid uuid := (select auth.uid()); v_org uuid;
begin
  select organization_id into v_org from public.profiles where id = v_uid;
  select * into v_ticket from public.service_tickets where id = _ticket_id and organization_id = v_org for update;
  if not found or not public.can_access_branch(v_ticket.branch_id) then raise exception 'Tiket servis tidak ditemukan.'; end if;
  select * into v_stock from public.stock_items where id = _stock_item_id and branch_id = v_ticket.branch_id and status = 'available' and quantity >= _quantity for update;
  if not found or _quantity < 1 then raise exception 'Stok sparepart tidak cukup.'; end if;
  update public.stock_items set quantity = quantity - _quantity, status = case when quantity - _quantity = 0 then 'used_for_service' else status end where id = v_stock.id;
  insert into public.service_parts(organization_id, ticket_id, stock_item_id, product_name, quantity, cost, created_by)
    select v_org, _ticket_id, v_stock.id, p.name, _quantity, p.cost_price * _quantity, v_uid from public.products p where p.id = v_stock.product_id;
  insert into public.stock_movements(organization_id, branch_id, product_id, stock_item_id, movement_type, quantity, reference, created_by)
    values(v_org, v_ticket.branch_id, v_stock.product_id, v_stock.id, 'service_use', -_quantity, v_ticket.ticket_number, v_uid);
end;
$$;
revoke all on function public.use_service_part(uuid,uuid,integer) from public;
grant execute on function public.use_service_part(uuid,uuid,integer) to authenticated;

revoke execute on function public.accept_operator_invite() from public, anon, authenticated;
revoke execute on function public.bootstrap_owner(text,text[]) from public, anon;
revoke execute on function public.is_org_member(uuid) from public, anon;
revoke execute on function public.is_owner(uuid) from public, anon;
revoke execute on function public.can_access_branch(uuid) from public, anon;
revoke execute on function public.receive_stock(uuid,uuid,text,jsonb) from public, anon;
revoke execute on function public.create_sale(uuid,text,text,text,jsonb) from public, anon;
revoke execute on function public.use_service_part(uuid,uuid,integer) from public, anon;

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
create policy organizations_read_member on public.organizations for select to authenticated using (public.is_org_member(id));
drop policy if exists organizations_update_owner on public.organizations;
create policy organizations_update_owner on public.organizations for update to authenticated using (public.is_owner(id)) with check (public.is_owner(id));
drop policy if exists branches_read_member on public.branches;
create policy branches_read_member on public.branches for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists branches_owner_manage on public.branches;
create policy branches_add_owner on public.branches for insert to authenticated with check (public.is_owner(organization_id));
create policy branches_update_owner on public.branches for update to authenticated using (public.is_owner(organization_id)) with check (public.is_owner(organization_id));
create policy branches_delete_owner on public.branches for delete to authenticated using (public.is_owner(organization_id));
drop policy if exists profiles_read_org on public.profiles;
create policy profiles_read_org on public.profiles for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists invites_owner_manage on public.team_invites;
create policy invites_owner_manage on public.team_invites for all to authenticated using (public.is_owner(organization_id)) with check (public.is_owner(organization_id));
drop policy if exists products_read_org on public.products;
create policy products_read_org on public.products for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists products_public_catalog on public.products;
create policy products_public_catalog on public.products for select to anon using (is_public);
drop policy if exists products_owner_manage on public.products;
create policy products_add_owner on public.products for insert to authenticated with check (public.is_owner(organization_id));
create policy products_update_owner on public.products for update to authenticated using (public.is_owner(organization_id)) with check (public.is_owner(organization_id));
create policy products_delete_owner on public.products for delete to authenticated using (public.is_owner(organization_id));
drop policy if exists stock_read_branch on public.stock_items;
create policy stock_read_branch on public.stock_items for select to authenticated using (public.can_access_branch(branch_id));
drop policy if exists stock_owner_manage on public.stock_items;
create policy stock_add_owner on public.stock_items for insert to authenticated with check (public.is_owner(organization_id));
create policy stock_update_owner on public.stock_items for update to authenticated using (public.is_owner(organization_id)) with check (public.is_owner(organization_id));
create policy stock_delete_owner on public.stock_items for delete to authenticated using (public.is_owner(organization_id));
drop policy if exists movements_read_branch on public.stock_movements;
create policy movements_read_branch on public.stock_movements for select to authenticated using (public.can_access_branch(branch_id));
drop policy if exists sales_read_branch on public.sales;
create policy sales_read_branch on public.sales for select to authenticated using (public.can_access_branch(branch_id));
drop policy if exists sale_items_read_branch on public.sale_items;
create policy sale_items_read_branch on public.sale_items for select to authenticated using (exists (select 1 from public.sales s where s.id = sale_id and public.can_access_branch(s.branch_id)));
drop policy if exists services_read_branch on public.service_tickets;
create policy services_read_branch on public.service_tickets for select to authenticated using (public.can_access_branch(branch_id));
drop policy if exists services_add_branch on public.service_tickets;
create policy services_add_branch on public.service_tickets for insert to authenticated with check (public.can_access_branch(branch_id) and public.is_org_member(organization_id));
drop policy if exists services_update_branch on public.service_tickets;
create policy services_update_branch on public.service_tickets for update to authenticated using (public.can_access_branch(branch_id)) with check (public.can_access_branch(branch_id));
drop policy if exists service_parts_read_branch on public.service_parts;
create policy service_parts_read_branch on public.service_parts for select to authenticated using (exists (select 1 from public.service_tickets t where t.id = ticket_id and public.can_access_branch(t.branch_id)));

create or replace view public.public_catalog with (security_invoker = true) as
select id, name, brand, model, category, retail_price
from public.products where is_public;
grant select on public.public_catalog to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('service-evidence', 'service-evidence', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
drop policy if exists service_evidence_read_member on storage.objects;
create policy service_evidence_read_member on storage.objects for select to authenticated using (
  bucket_id = 'service-evidence' and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role = 'owner' or ((storage.foldername(name))[1] = p.organization_id::text and public.can_access_branch(((storage.foldername(name))[2])::uuid))))
);
drop policy if exists service_evidence_upload_member on storage.objects;
create policy service_evidence_upload_member on storage.objects for insert to authenticated with check (
  bucket_id = 'service-evidence' and exists (select 1 from public.profiles p where p.id = auth.uid() and (storage.foldername(name))[1] = p.organization_id::text and public.can_access_branch(((storage.foldername(name))[2])::uuid))
);
