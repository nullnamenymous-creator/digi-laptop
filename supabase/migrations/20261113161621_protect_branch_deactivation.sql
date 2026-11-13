revoke delete, update on public.branches from public, anon, authenticated;
grant update (name, city, address) on public.branches to authenticated;

create or replace function private.deactivate_branch(_branch_id uuid, _code text)
returns void language plpgsql security definer set search_path = '' as $$
declare org uuid;
begin
  select organization_id into org from public.branches where id = _branch_id;
  if org is null or not private.is_owner(org) then raise exception 'Cabang tidak ditemukan atau akses ditolak.'; end if;
  if _code is null or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(_code,'UTF8')),'hex') <> 'f0d588a225e6e6ba0501a3f787230abf579f6db2dd55be0fa3450f8acd54e6f3' then
    raise exception 'Kode akses tambahan salah.';
  end if;
  perform 1 from public.organizations where id = org for update;
  perform 1 from public.branches where id = _branch_id and is_active for update;
  if not found then raise exception 'Cabang sudah tidak aktif.'; end if;
  if (select count(*) from public.branches where organization_id = org and is_active) <= 1 then
    raise exception 'Toko harus memiliki minimal satu cabang aktif.';
  end if;
  if exists (select 1 from public.profiles where branch_id = _branch_id and role <> 'owner') then
    raise exception 'Pindahkan akun Operator dan QC ke cabang aktif lain terlebih dahulu.';
  end if;
  update public.branches set is_active = false where id = _branch_id;
end;
$$;
revoke all on function private.deactivate_branch(uuid,text) from public, anon;
grant execute on function private.deactivate_branch(uuid,text) to authenticated;
create or replace function public.deactivate_branch(_branch_id uuid, _code text)
returns void language sql security invoker set search_path = ''
as $$ select private.deactivate_branch(_branch_id,_code) $$;
revoke all on function public.deactivate_branch(uuid,text) from public, anon;
grant execute on function public.deactivate_branch(uuid,text) to authenticated;
