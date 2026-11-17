begin;

create or replace function private.withdraw_stock_unit(_unit_id uuid, _branch_id uuid, _reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_unit public.stock_items%rowtype;
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

    update public.stock_repairs set status = 'not_sellable',
      resolution = concat_ws(E'\n', nullif(resolution, ''), 'Unit dikeluarkan dari stok: ' || v_reason),
      updated_at = now()
    where stock_item_id = v_unit.id and status = 'pending_final_qc';
  end if;

  update public.stock_items set status = 'withdrawn', quantity = 0 where id = v_unit.id;
  insert into public.stock_movements(
    organization_id, branch_id, product_id, stock_item_id,
    movement_type, quantity, reference, note, created_by
  ) values (
    v_unit.organization_id, v_unit.branch_id, v_unit.product_id, v_unit.id,
    'adjustment', -1, 'WITHDRAW-' || v_unit.barcode, v_reason, (select auth.uid())
  );
end;
$$;

notify pgrst, 'reload schema';

commit;
