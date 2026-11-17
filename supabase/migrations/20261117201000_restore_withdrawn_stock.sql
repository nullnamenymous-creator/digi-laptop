begin;

alter table public.stock_items
  add column withdrawn_from_status text check (withdrawn_from_status in ('available','pending_qc','not_sellable','scrap')),
  add column withdrawn_repair_ids uuid[];

create or replace function private.withdraw_stock_unit(_unit_id uuid, _branch_id uuid, _reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_unit public.stock_items%rowtype;
  v_closed_repairs uuid[];
  v_reason text := btrim(coalesce(_reason, ''));
begin
  if char_length(v_reason) not between 3 and 300 then
    raise exception 'Isi alasan koreksi sepanjang 3 sampai 300 karakter.';
  end if;

  select s.* into v_unit
  from public.stock_items s
  join public.branches b on b.id = s.branch_id and b.organization_id = s.organization_id
  join public.products p on p.id = s.product_id and p.organization_id = s.organization_id
  where s.id = _unit_id and s.branch_id = _branch_id
    and b.is_active and lower(btrim(p.category)) = 'laptop'
    and (private.is_owner(s.organization_id)
      or private.can_administer_active_branch(s.branch_id))
  for update of s;

  if not found then raise exception 'Unit tidak ditemukan di cabang ini atau akses ditolak.'; end if;
  if v_unit.quantity <> 1 or (v_unit.status <> 'available' and not (
    v_unit.status in ('pending_qc','not_sellable','scrap') and private.is_owner(v_unit.organization_id)
  )) then
    raise exception 'Status unit ini tidak bisa dikoreksi dari daftar stok. Muat ulang daftar unit.';
  end if;

  if v_unit.status <> 'available' then
    if exists (
      select 1 from public.stock_repairs r where r.stock_item_id = v_unit.id
        and r.status in ('repair_needed','repairing','waiting_parts')
    ) then
      raise exception 'Unit masih punya pekerjaan repair aktif. Selesaikan atau tutup repair terlebih dahulu.';
    end if;

    with closed as (
    update public.stock_repairs set status = 'not_sellable',
      resolution = concat_ws(E'\n', nullif(resolution, ''), 'Unit dikeluarkan dari stok: ' || v_reason),
      updated_at = now()
    where stock_item_id = v_unit.id and status = 'pending_final_qc' returning id
    ) select array_agg(id) into v_closed_repairs from closed;
  end if;

  update public.stock_items set status = 'withdrawn', quantity = 0,
    withdrawn_from_status = v_unit.status, withdrawn_repair_ids = v_closed_repairs
  where id = v_unit.id;
  insert into public.stock_movements(
    organization_id, branch_id, product_id, stock_item_id,
    movement_type, quantity, reference, note, created_by
  ) values (
    v_unit.organization_id, v_unit.branch_id, v_unit.product_id, v_unit.id,
    'adjustment', -1, 'WITHDRAW-' || v_unit.barcode, v_reason, (select auth.uid())
  );
end;
$$;

create function private.restore_withdrawn_stock(_unit_id uuid, _legacy_status text, _reason text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_unit public.stock_items%rowtype;
  v_status text;
  v_reason text := btrim(coalesce(_reason,''));
  v_is_central boolean;
begin
  if char_length(v_reason) not between 3 and 300 then
    raise exception 'Isi alasan pemulihan sepanjang 3 sampai 300 karakter.';
  end if;
  select s.* into v_unit from public.stock_items s
  join public.branches b on b.id = s.branch_id and b.organization_id = s.organization_id
  join public.products p on p.id = s.product_id and p.organization_id = s.organization_id
  where s.id = _unit_id and b.is_active and lower(btrim(p.category)) = 'laptop'
    and private.is_owner(s.organization_id)
  for update of s;
  if not found then raise exception 'Unit tidak ditemukan atau akses ditolak.'; end if;
  if v_unit.status <> 'withdrawn' or v_unit.quantity <> 0 then
    raise exception 'Unit ini sudah dipulihkan atau status stoknya berubah.';
  end if;
  v_status := coalesce(v_unit.withdrawn_from_status, _legacy_status);
  if v_unit.withdrawn_from_status is null then
    if v_status is null or v_status not in ('available','pending_qc') then
      raise exception 'Pilih status untuk unit dengan koreksi lama.';
    end if;
    select b.is_central into v_is_central from public.branches b where b.id = v_unit.branch_id;
    if v_status = 'pending_qc' and not v_is_central then
      raise exception 'Antrean QC tersedia di cabang pusat.';
    end if;
  end if;
  if exists (select 1 from public.stock_repairs r where r.stock_item_id = v_unit.id
      and r.status in ('repair_needed','repairing','waiting_parts','pending_final_qc')) then
    raise exception 'Unit masih memiliki pekerjaan repair aktif. Periksa riwayat unit terlebih dahulu.';
  end if;

  update public.products set archived_at = null
  where id = v_unit.product_id and organization_id = v_unit.organization_id and archived_at is not null;
  if v_status = 'pending_qc' then
    update public.stock_repairs set status = 'pending_final_qc', updated_at = now()
    where id = any(v_unit.withdrawn_repair_ids) and stock_item_id = v_unit.id and status = 'not_sellable';
  end if;
  update public.stock_items set status = v_status, quantity = 1,
    qc_stage = case when v_status = 'pending_qc' and v_unit.withdrawn_from_status is null then 'initial' else qc_stage end,
    withdrawn_from_status = null, withdrawn_repair_ids = null
  where id = v_unit.id;
  insert into public.stock_movements(organization_id, branch_id, product_id, stock_item_id,
    movement_type, quantity, reference, note, created_by)
  values (v_unit.organization_id,v_unit.branch_id,v_unit.product_id,v_unit.id,
    'adjustment',1,'RESTORE-' || v_unit.barcode,v_reason,(select auth.uid()));
  return v_status;
end;
$$;

create function public.restore_withdrawn_stock(_unit_id uuid, _legacy_status text, _reason text)
returns text language sql security invoker set search_path = '' as $$
  select private.restore_withdrawn_stock(_unit_id,_legacy_status,_reason)
$$;
revoke all on function private.restore_withdrawn_stock(uuid,text,text), public.restore_withdrawn_stock(uuid,text,text)
  from public, anon, authenticated;
grant execute on function private.restore_withdrawn_stock(uuid,text,text), public.restore_withdrawn_stock(uuid,text,text)
  to authenticated;

notify pgrst, 'reload schema';
commit;
