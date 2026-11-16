begin;

alter table public.stock_items drop constraint stock_items_status_check;
alter table public.stock_items add constraint stock_items_status_check check (
  status in ('pending_qc','repair_needed','repairing','waiting_parts','available',
    'not_sellable','scrap','sold','used_for_service','transferred','withdrawn')
);

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
      or private.can_manage_central_opening_stock(s.organization_id, s.branch_id))
  for update of s;

  if not found then raise exception 'Unit tidak ditemukan di cabang ini atau akses ditolak.'; end if;
  if v_unit.status <> 'available' or v_unit.quantity <> 1 then
    raise exception 'Koreksi ini hanya berlaku untuk satu unit laptop yang masih tersedia. Muat ulang daftar stok.';
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

revoke all on function private.withdraw_stock_unit(uuid, uuid, text) from public, anon;
grant execute on function private.withdraw_stock_unit(uuid, uuid, text) to authenticated;

create or replace function public.withdraw_stock_unit(_unit_id uuid, _branch_id uuid, _reason text)
returns void language sql security invoker set search_path = '' as $$
  select private.withdraw_stock_unit(_unit_id, _branch_id, _reason)
$$;

revoke all on function public.withdraw_stock_unit(uuid, uuid, text) from public, anon;
grant execute on function public.withdraw_stock_unit(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
