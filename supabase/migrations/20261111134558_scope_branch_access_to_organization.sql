create or replace function private.can_access_branch(_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.branches b on b.id = _branch_id
    where p.id = (select auth.uid())
      and b.organization_id = p.organization_id
      and (p.role = 'owner' or p.branch_id = _branch_id)
  )
$$;

revoke all on function private.can_access_branch(uuid) from public, anon;
grant execute on function private.can_access_branch(uuid) to authenticated;

create or replace function private.can_operate_branch(_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.branches b on b.id = _branch_id
    where p.id = (select auth.uid())
      and b.organization_id = p.organization_id
      and p.role in ('owner','operator')
      and (p.role = 'owner' or p.branch_id = _branch_id)
  )
$$;

revoke all on function private.can_operate_branch(uuid) from public, anon;
grant execute on function private.can_operate_branch(uuid) to authenticated;

drop policy if exists service_evidence_read_member on storage.objects;
create policy service_evidence_read_member on storage.objects
for select to authenticated
using (
  bucket_id = 'service-evidence'
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and (storage.foldername(name))[1] = p.organization_id::text
      and private.can_access_branch(((storage.foldername(name))[2])::uuid)
  )
);
