begin;
alter table public.stock_items add column if not exists qc_started_at timestamptz;
alter table public.stock_items add column if not exists qc_started_by uuid references auth.users(id) on delete set null;

create function private.start_stock_qc(_stock_item_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.stock_items%rowtype;
begin
  select * into s from public.stock_items where id = _stock_item_id for update;
  if not found or not exists(select 1 from public.profiles p
    where p.id = auth.uid() and p.organization_id = s.organization_id
      and p.branch_id = s.branch_id and p.role = 'technician')
    or not private.is_central_branch(s.branch_id) then
    raise exception 'Hanya teknisi Cabang Pusat yang boleh memulai QC unit ini.';
  end if;
  if s.status <> 'pending_qc' then raise exception 'Unit tidak berada dalam antrean QC.'; end if;
  if s.qc_started_at is not null and (s.qc_at is null or s.qc_started_at > s.qc_at) then
    if s.qc_started_by is distinct from auth.uid() then raise exception 'Unit sedang diperiksa teknisi lain.'; end if;
    return;
  end if;
  update public.stock_items set qc_started_at = clock_timestamp(), qc_started_by = auth.uid() where id = s.id;
end;
$$;
revoke all on function private.start_stock_qc(uuid) from public, anon;
grant execute on function private.start_stock_qc(uuid) to authenticated;
create function public.start_stock_qc(_stock_item_id uuid)
returns void language sql security invoker set search_path = '' as $$ select private.start_stock_qc(_stock_item_id) $$;
revoke all on function public.start_stock_qc(uuid) from public, anon;
grant execute on function public.start_stock_qc(uuid) to authenticated;
commit;
