drop policy if exists service_evidence_update_member on storage.objects;
create policy service_evidence_update_member on storage.objects
for update to authenticated
using (
  bucket_id = 'service-evidence'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (storage.foldername(name))[1] = p.organization_id::text
      and private.can_operate_branch(((storage.foldername(name))[2])::uuid)
  )
)
with check (
  bucket_id = 'service-evidence'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (storage.foldername(name))[1] = p.organization_id::text
      and private.can_operate_branch(((storage.foldername(name))[2])::uuid)
  )
);

do $$
declare v_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array array['sales','service_tickets','products','suppliers','customers'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
end;
$$;
