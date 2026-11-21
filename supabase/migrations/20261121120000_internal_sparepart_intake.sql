begin;

create or replace function private.receive_internal_sparepart(
  _branch_id uuid,
  _product_id uuid,
  _new_product_name text,
  _quantity integer,
  _unit_price numeric
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_role text;
  v_product_id uuid := _product_id;
  v_product public.products%rowtype;
  v_batch uuid := gen_random_uuid();
  v_barcode text := 'DL-P-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  v_total numeric;
  v_name text := btrim(coalesce(_new_product_name, ''));
begin
  select organization_id, role into v_org, v_role
  from public.profiles where id = v_uid;
  if v_org is null or v_role not in ('owner', 'central_admin')
    or not private.can_access_branch(_branch_id)
    or not exists (select 1 from public.branches b where b.id = _branch_id and b.organization_id = v_org and b.is_active) then
    raise exception 'Penerimaan sparepart hanya untuk Pemilik/Admin Pusat pada cabang yang dapat dikelola.';
  end if;
  if _quantity is null or _quantity not between 1 and 500 then
    raise exception 'Jumlah barang harus antara 1 dan 500.';
  end if;
  if _unit_price is null or _unit_price <= 0 then
    raise exception 'Harga produk per unit harus lebih dari nol.';
  end if;
  v_total := _quantity * _unit_price;

  if v_product_id is null then
    if v_name = '' then raise exception 'Nama barang wajib diisi.'; end if;
    insert into public.products(
      organization_id, sku, name, brand, model, category,
      cost_price, retail_price, reseller_price, warranty_months, is_public
    ) values (
      v_org, 'DL-SP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
      v_name, '', '', 'Sparepart', _unit_price, 0, 0, 0, false
    ) returning id into v_product_id;
  else
    select * into v_product from public.products p
    where p.id = v_product_id and p.organization_id = v_org
      and p.category = 'Sparepart' and p.archived_at is null
    for update;
    if not found then raise exception 'Pilih sparepart aktif yang terdaftar.'; end if;
    update public.products set cost_price = _unit_price, retail_price = 0, reseller_price = 0, is_public = false where id = v_product_id;
  end if;

  insert into public.intake_batches(
    id, organization_id, branch_id, product_id, supplier, supplier_id,
    invoice_number, unit_count, unit_cost, total_amount, amount_paid, due_date, created_by
  ) values (
    v_batch, v_org, _branch_id, v_product_id, '', null,
    '', _quantity, _unit_price, v_total, v_total, null, v_uid
  );

  insert into public.stock_items(
    organization_id, branch_id, product_id, barcode, supplier, supplier_id,
    quantity, status, intake_batch_id, qc_stage, acquisition_cost, created_by
  ) values (
    v_org, _branch_id, v_product_id, v_barcode, '', null,
    _quantity, 'available', v_batch, 'initial', _unit_price, v_uid
  );

  insert into public.stock_movements(
    organization_id, branch_id, product_id, stock_item_id,
    movement_type, quantity, reference, note, created_by
  ) select v_org, _branch_id, v_product_id, s.id,
    'receive', _quantity, v_barcode, 'Penerimaan sparepart kebutuhan toko · batch ' || left(v_batch::text, 8), v_uid
    from public.stock_items s where s.intake_batch_id = v_batch;

  insert into public.cash_transactions(
    organization_id, branch_id, direction, category, amount,
    description, source_type, source_id, created_by
  ) values (
    v_org, _branch_id, 'expense', 'Pembelian sparepart internal', v_total,
    'Pembelian sparepart kebutuhan toko · ' || (select p.name from public.products p where p.id = v_product_id),
    'intake_batch', v_batch, v_uid
  );

  return v_batch;
end;
$$;
revoke all on function private.receive_internal_sparepart(uuid,uuid,text,integer,numeric) from public, anon;
grant execute on function private.receive_internal_sparepart(uuid,uuid,text,integer,numeric) to authenticated;

create or replace function public.receive_internal_sparepart(
  _branch_id uuid, _product_id uuid, _new_product_name text, _quantity integer, _unit_price numeric
)
returns uuid language sql security invoker set search_path = '' as $$
  select private.receive_internal_sparepart(_branch_id, _product_id, _new_product_name, _quantity, _unit_price);
$$;
revoke all on function public.receive_internal_sparepart(uuid,uuid,text,integer,numeric) from public, anon;
grant execute on function public.receive_internal_sparepart(uuid,uuid,text,integer,numeric) to authenticated;

notify pgrst, 'reload schema';
commit;

begin;

-- Spareparts are internal-use stock and cannot be sold through any sale path.
create or replace function private.block_sparepart_sale()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.products p where p.id = new.product_id and lower(p.category) = 'sparepart') then
    raise exception 'Sparepart adalah stok internal toko dan tidak dapat dijual.';
  end if;
  return new;
end;
$$;
revoke all on function private.block_sparepart_sale() from public, anon;
grant execute on function private.block_sparepart_sale() to authenticated;
drop trigger if exists block_sparepart_sale on public.sale_items;
create trigger block_sparepart_sale before insert or update on public.sale_items
for each row execute function private.block_sparepart_sale();

notify pgrst, 'reload schema';
commit;
