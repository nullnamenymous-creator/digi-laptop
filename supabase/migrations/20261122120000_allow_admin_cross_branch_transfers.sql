begin;

create or replace function private.check_central_stock()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'stock_transfers' then
    if not (private.is_owner(new.organization_id) or private.is_central_admin(new.organization_id)) then
      raise exception 'Hanya Pemilik atau Admin Pusat yang boleh mengirim mutasi.';
    end if;
    if not exists (
      select 1 from public.branches source
      join public.branches destination on destination.organization_id = source.organization_id
      where source.id = new.source_branch_id
        and source.organization_id = new.organization_id
        and source.is_active
        and destination.id = new.destination_branch_id
        and destination.is_active
        and source.id <> destination.id
    ) then
      raise exception 'Cabang asal atau tujuan tidak aktif atau tidak valid.';
    end if;
  elsif not private.is_central_branch(new.branch_id) then
    raise exception 'Penerimaan dan stok awal hanya dapat dicatat di Pusat.';
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';

commit;
