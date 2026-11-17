begin;
-- Roll back the newly added Guardian session overlay.
do $$
declare t record;
begin
  for t in select schemaname,tablename from pg_policies
    where policyname='guardian_session' and schemaname in ('public','storage')
  loop
    execute format('drop policy guardian_session on %I.%I',t.schemaname,t.tablename);
  end loop;
end;
$$;
drop policy if exists profiles_read_org on public.profiles;
create policy profiles_read_org on public.profiles for select to authenticated
  using (private.is_org_member(organization_id));
do $$
declare v_existing text;
begin
  select substr(setting,length('pgrst.db_pre_request=')+1) into v_existing
  from pg_db_role_setting s join pg_roles r on r.oid=s.setrole
    cross join lateral unnest(s.setconfig) setting
  where r.rolname='authenticator' and setting like 'pgrst.db_pre_request=%' limit 1;
  if v_existing='public.guardian_pre_request' then
    execute 'alter role authenticator reset pgrst.db_pre_request';
  end if;
end;
$$;
-- Compatibility for the deployed team-users endpoint. Its existing token and
-- owner checks continue to authorize account administration.
create or replace function public.guardian_check_session()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise sqlstate '42501' using message='Silakan masuk kembali.';
  end if;
end;
$$;
revoke all on function public.guardian_check_session() from public, anon;
grant execute on function public.guardian_check_session() to authenticated;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
commit;
