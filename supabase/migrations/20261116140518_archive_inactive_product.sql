begin;

alter table public.products add column archived_at timestamptz;
alter table public.products add constraint archived_products_are_private
  check (archived_at is null or not is_public);

create function private.guard_product_archive()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.archived_at is not null and old.archived_at is null then
    if exists (
      select 1 from public.stock_items s where s.product_id = old.id and s.quantity > 0
    ) or exists (
      select 1 from public.stock_transfer_items i
      join public.stock_transfers t on t.id = i.transfer_id
      where i.product_id = old.id and t.status = 'in_transit'
    ) then
      raise exception 'Produk masih punya stok atau mutasi berjalan di salah satu cabang.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_product_archive() from public, anon, authenticated;

create trigger guard_product_archive before update of archived_at on public.products
for each row execute function private.guard_product_archive();

create function private.guard_archived_product_stock()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_archived_at timestamptz;
begin
  if new.quantity > 0 then
    select p.archived_at into v_archived_at from public.products p where p.id = new.product_id for share;
    if v_archived_at is not null then
      raise exception 'Produk sudah diarsipkan dan tidak bisa ditambahkan ke stok.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_archived_product_stock() from public, anon, authenticated;

create trigger guard_archived_product_stock before insert or update of quantity, status, product_id on public.stock_items
for each row execute function private.guard_archived_product_stock();

create function public.archive_inactive_product(_product_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.products
  set archived_at = coalesce(archived_at, now()), is_public = false
  where id = _product_id and private.is_owner(organization_id);
  if not found then raise exception 'Produk tidak ditemukan atau akses arsip ditolak.'; end if;
end;
$$;
revoke all on function public.archive_inactive_product(uuid) from public, anon;
grant execute on function public.archive_inactive_product(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
