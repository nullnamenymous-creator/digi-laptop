begin;

create extension if not exists pg_cron;

alter table public.stock_items drop constraint stock_items_status_check;
alter table public.stock_items add constraint stock_items_status_check check (status in (
  'pending_qc','repair_needed','repairing','waiting_parts','available','not_sellable',
  'scrap','sold','used_for_service','transferred','withdrawn','reserved_online'
));

create table private.catalog_orders (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique,
  organization_id uuid not null references public.organizations(id),
  branch_id uuid not null references public.branches(id),
  stock_item_id uuid not null references public.stock_items(id),
  product_id uuid not null references public.products(id),
  product_name text not null,
  customer_name text not null,
  phone text not null,
  amount numeric(14,2) not null check (amount > 0),
  status text not null default 'awaiting_payment' check (status in (
    'awaiting_payment','review','expired','late','paid','rejected'
  )),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '20 minutes'),
  proof bytea,
  payment_reference text,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_note text,
  sale_id uuid unique references public.sales(id)
);

alter table private.catalog_orders enable row level security;
revoke all on private.catalog_orders from public, anon, authenticated;
create unique index catalog_orders_held_unit on private.catalog_orders(stock_item_id)
  where status in ('awaiting_payment','review');
create unique index catalog_orders_payment_reference on private.catalog_orders(organization_id, lower(payment_reference))
  where payment_reference is not null;
create index catalog_orders_expiry on private.catalog_orders(expires_at) where status = 'awaiting_payment';
create index catalog_orders_branch on private.catalog_orders(organization_id, branch_id, created_at desc);
create index catalog_orders_phone on private.catalog_orders(phone, created_at desc);

create function private.expire_catalog_orders()
returns void language sql set search_path = '' as $$
  with expired as (
    update private.catalog_orders set status = 'expired'
    where id in (
      select id from private.catalog_orders
      where status = 'awaiting_payment' and expires_at <= now()
      order by expires_at limit 100 for update skip locked
    ) returning stock_item_id
  )
  update public.stock_items s set status = 'available' from expired e
  where s.id = e.stock_item_id and s.status = 'reserved_online';
$$;
revoke all on function private.expire_catalog_orders() from public, anon, authenticated;
select cron.schedule('digi-catalog-order-expiry', '* * * * *', 'select private.expire_catalog_orders()');

create function private.catalog_order_status(_token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('number', 'WEB-' || upper(replace(o.id::text, '-', '')),
    'status', case when o.status = 'awaiting_payment' and o.expires_at <= now() then 'expired' else o.status end,
    'amount', o.amount, 'product', o.product_name, 'branch', b.name, 'expires_at', o.expires_at,
    'note', o.review_note)
  from private.catalog_orders o join public.branches b on b.id = o.branch_id where o.token = _token
$$;

create function private.create_catalog_order(_token uuid, _product uuid, _branch text, _name text, _phone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_product public.products%rowtype;
  v_branch uuid;
  v_unit uuid;
  v_total numeric;
  v_phone text := regexp_replace(coalesce(_phone,''), '[^0-9]', '', 'g');
  v_name text := btrim(coalesce(_name,''));
begin
  if _token is null or char_length(v_name) not between 2 and 100 or char_length(v_phone) not between 8 and 16 then
    raise exception 'Isi nama dan nomor WhatsApp yang valid.';
  end if;
  if v_phone like '0%' then v_phone := '62' || substr(v_phone, 2); end if;
  perform pg_advisory_xact_lock(hashtextextended('catalog-order:' || v_phone, 0));
  if exists (select 1 from private.catalog_orders where token = _token) then
    return private.catalog_order_status(_token);
  end if;
  perform private.expire_catalog_orders();
  if (select count(*) from private.catalog_orders where phone = v_phone and created_at > now() - interval '1 hour') >= 5
    or exists (select 1 from private.catalog_orders where phone = v_phone and status = 'awaiting_payment' and expires_at > now()) then
    raise exception 'Masih ada pesanan menunggu bayar, atau batas pemesanan sementara tercapai.';
  end if;

  select p.* into v_product from public.products p
  where p.id = _product and p.organization_id = '1f232ccc-ec3a-425c-83fe-2ab3cc27a029'
    and p.is_public and p.archived_at is null and lower(p.category) = 'laptop'
  for share;
  if not found then raise exception 'Laptop ini tidak tersedia di katalog.'; end if;
  v_total := private.effective_retail_price(v_product);
  if v_total is null or v_total <= 0 then raise exception 'Harga produk belum tersedia.'; end if;
  if v_total > 10000000 then raise exception 'Total melebihi batas satu pembayaran QRIS. Hubungi toko.'; end if;
  select b.id into v_branch from public.branches b where b.organization_id = v_product.organization_id
    and b.name = _branch and b.is_active and not b.is_central
    order by b.id limit 1;
  if not found then raise exception 'Pilih cabang penjualan yang tersedia.'; end if;
  select s.id into v_unit from public.stock_items s
  where s.organization_id = v_product.organization_id and s.product_id = v_product.id
    and s.branch_id = v_branch and s.status = 'available' and s.quantity = 1
  order by s.created_at, s.id limit 1 for update skip locked;
  if not found then raise exception 'Unit siap jual di cabang tersebut habis. Muat ulang katalog.'; end if;
  update public.stock_items set status = 'reserved_online' where id = v_unit;
  insert into private.catalog_orders(token, organization_id, branch_id, product_id, stock_item_id, product_name, customer_name, phone, amount)
  values (_token,v_product.organization_id,v_branch,v_product.id,v_unit,v_product.name,v_name,v_phone,v_total);
  return private.catalog_order_status(_token);
end;
$$;

create function private.submit_catalog_proof(_token uuid, _proof text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_order private.catalog_orders%rowtype;
  v_proof bytea;
begin
  select * into v_order from private.catalog_orders where token = _token for update;
  if not found then raise exception 'Pesanan tidak ditemukan.'; end if;
  if v_order.status in ('review','late','paid') then return private.catalog_order_status(_token); end if;
  if v_order.status not in ('awaiting_payment','expired') then raise exception 'Pesanan ini sudah ditutup.'; end if;
  if _proof is null or char_length(_proof) not between 16 and 480000 then
    raise exception 'Ukuran bukti pembayaran tidak valid.';
  end if;
  v_proof := decode(_proof,'base64');
  if substring(v_proof from 1 for 3) <> decode('ffd8ff','hex') then
    raise exception 'Bukti pembayaran harus berupa gambar JPEG.';
  end if;
  if v_order.status = 'awaiting_payment' and v_order.expires_at <= now() then
    update public.stock_items set status = 'available' where id = v_order.stock_item_id and status = 'reserved_online';
    v_order.status := 'expired';
  end if;
  update private.catalog_orders set proof = v_proof,
    status = case when v_order.status = 'expired' then 'late' else 'review' end where id = v_order.id;
  return private.catalog_order_status(_token);
end;
$$;

create function private.catalog_orders_dashboard()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(o) order by o.priority, o.created_at desc), '[]'::jsonb)
  from (
    select x.id, 'WEB-' || upper(replace(x.id::text, '-', '')) as number,
      x.branch_id, b.name as branch, x.product_name, x.customer_name, x.phone, x.amount, x.status,
      x.created_at, x.proof is not null as has_proof, x.review_note, x.payment_reference,
      case when x.status = 'paid' then s.barcode end as barcode,
      case when x.status in ('review','late') then 0 else 1 end as priority
    from private.catalog_orders x join public.branches b on b.id = x.branch_id
    join public.stock_items s on s.id = x.stock_item_id
    where private.is_owner(x.organization_id) or private.is_central_admin(x.organization_id)
      or private.can_operate_branch(x.branch_id)
    order by priority, x.created_at desc limit 100
  ) o
$$;

create function private.catalog_order_proof(_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select encode(o.proof,'base64') from private.catalog_orders o
  where o.id = _id and (private.is_owner(o.organization_id) or private.is_central_admin(o.organization_id)
    or private.can_operate_branch(o.branch_id))
$$;

create function private.review_catalog_order(_id uuid, _approve boolean, _value text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_order private.catalog_orders%rowtype;
  v_unit public.stock_items%rowtype;
  v_value text := btrim(coalesce(_value,''));
  v_sale uuid;
  v_uid uuid := (select auth.uid());
  v_receipt text;
begin
  select * into v_order from private.catalog_orders o where o.id = _id
    and (private.is_owner(o.organization_id) or private.is_central_admin(o.organization_id)) for update;
  if not found then raise exception 'Akses verifikasi ditolak.'; end if;
  if _approve is null or char_length(v_value) not between 3 and 250 then raise exception 'Lengkapi data verifikasi.'; end if;
  if v_order.status in ('paid','rejected') then return; end if;
  if v_order.status not in ('review','late') then raise exception 'Bukti pembayaran belum tersedia.'; end if;
  if not _approve then
    if v_order.status = 'review' then
      update public.stock_items set status = 'available' where id = v_order.stock_item_id and status = 'reserved_online';
    end if;
    update private.catalog_orders set status = 'rejected', reviewed_at = now(), reviewed_by = v_uid,
      review_note = v_value where id = _id;
    return;
  end if;
  if v_order.status = 'late' then raise exception 'Reservasi sudah berakhir. Hubungi pelanggan untuk penanganan pembayaran.'; end if;
  select * into v_unit from public.stock_items where id = v_order.stock_item_id
    and organization_id = v_order.organization_id and branch_id = v_order.branch_id
    and product_id = v_order.product_id and status = 'reserved_online' and quantity = 1 for update;
  if not found then raise exception 'Unit pesanan sudah tidak tersedia.'; end if;

  v_receipt := 'WEB-' || upper(replace(v_order.id::text, '-', ''));
  insert into public.sales(organization_id,branch_id,receipt_number,customer_name,customer_type,payment_method,total,paid_amount,cashier_id)
  values(v_order.organization_id,v_order.branch_id,v_receipt,v_order.customer_name,'end_user','qris',v_order.amount,v_order.amount,v_uid)
  returning id into v_sale;
  update public.stock_items s set quantity = 0, status = 'sold',
    warranty_until = case when p.warranty_months > 0 then (current_date + make_interval(months => p.warranty_months))::date end
    from public.products p where s.id = v_unit.id and p.id = v_unit.product_id;
  insert into public.sale_items(sale_id,product_id,stock_item_id,product_name,quantity,unit_price,line_total)
  values(v_sale,v_order.product_id,v_unit.id,v_order.product_name,1,v_order.amount,v_order.amount);
  insert into public.stock_movements(organization_id,branch_id,product_id,stock_item_id,movement_type,quantity,reference,created_by)
  values(v_order.organization_id,v_order.branch_id,v_order.product_id,v_unit.id,'sale',-1,v_receipt,v_uid);
  insert into public.cash_transactions(organization_id,branch_id,direction,category,amount,description,source_type,source_id,created_by)
  values(v_order.organization_id,v_order.branch_id,'income','Penjualan',v_order.amount,'Pembayaran QRIS ' || v_receipt,'sale',v_sale,v_uid);
  update private.catalog_orders set status = 'paid', sale_id = v_sale, payment_reference = lower(v_value),
    reviewed_at = now(), reviewed_by = v_uid where id = _id;
exception when unique_violation then
  raise exception 'Referensi pembayaran sudah dipakai. Periksa kembali transaksi merchant.';
end;
$$;

create function public.create_catalog_order(_token uuid, _product uuid, _branch text, _name text, _phone text)
returns jsonb language sql security definer set search_path = '' as $$
  select private.create_catalog_order(_token,_product,_branch,_name,_phone)
$$;
create function public.catalog_order_status(_token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.catalog_order_status(_token)
$$;
create function public.submit_catalog_proof(_token uuid, _proof text)
returns jsonb language sql security definer set search_path = '' as $$
  select private.submit_catalog_proof(_token,_proof)
$$;
create function public.catalog_orders_dashboard()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.catalog_orders_dashboard()
$$;
create function public.catalog_order_proof(_id uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select private.catalog_order_proof(_id)
$$;
create function public.review_catalog_order(_id uuid, _approve boolean, _value text)
returns void language sql security invoker set search_path = '' as $$
  select private.review_catalog_order(_id,_approve,_value)
$$;

revoke all on function private.create_catalog_order(uuid,uuid,text,text,text), public.create_catalog_order(uuid,uuid,text,text,text),
  private.catalog_order_status(uuid), public.catalog_order_status(uuid), private.submit_catalog_proof(uuid,text), public.submit_catalog_proof(uuid,text),
  private.catalog_orders_dashboard(), public.catalog_orders_dashboard(), private.catalog_order_proof(uuid), public.catalog_order_proof(uuid),
  private.review_catalog_order(uuid,boolean,text), public.review_catalog_order(uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.create_catalog_order(uuid,uuid,text,text,text),
  public.catalog_order_status(uuid), public.submit_catalog_proof(uuid,text) to anon, authenticated;
grant execute on function private.catalog_orders_dashboard(), public.catalog_orders_dashboard(),
  private.catalog_order_proof(uuid), public.catalog_order_proof(uuid),
  private.review_catalog_order(uuid,boolean,text), public.review_catalog_order(uuid,boolean,text) to authenticated;

notify pgrst, 'reload schema';
commit;
