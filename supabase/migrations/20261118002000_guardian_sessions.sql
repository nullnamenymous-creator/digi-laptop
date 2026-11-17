begin;

create table private.guardian_staff_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null,
  revoked_before timestamptz,
  disabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table private.guardian_staff_access enable row level security;
revoke all on private.guardian_staff_access from public, anon, authenticated;

create function private.guardian_session_valid()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.sessions s
    where s.id::text = (select auth.jwt()->>'session_id')
      and s.user_id = (select auth.uid())
      and (s.not_after is null or s.not_after > now())
      and not exists (
        select 1 from private.guardian_staff_access a where a.user_id = s.user_id
          and (a.disabled or s.created_at <= a.revoked_before)
      )
      and (
        (select auth.jwt()->>'aal') = 'aal2'
        or not exists (select 1 from auth.mfa_factors f where f.user_id = s.user_id and f.status = 'verified')
      )
  )
$$;
revoke all on function private.guardian_session_valid() from public, anon, authenticated;
grant execute on function private.guardian_session_valid() to authenticated;

create function public.guardian_check_session()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not private.guardian_session_valid() then
    raise sqlstate '42501' using message = 'Sesi dicabut atau autentikator perlu diverifikasi. Masuk kembali.';
  end if;
end;
$$;
revoke all on function public.guardian_check_session() from public, anon, authenticated;
grant execute on function public.guardian_check_session() to authenticated;

create function public.guardian_pre_request()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if (select auth.jwt()->>'role') = 'authenticated' then perform public.guardian_check_session(); end if;
end;
$$;
revoke all on function public.guardian_pre_request() from public, anon, authenticated;
grant execute on function public.guardian_pre_request() to anon, authenticated, service_role;

-- Restrictive policies also cover direct table access through Storage and Realtime.
-- Existing branch and role policies still determine which records the user can access.
do $$
declare t record;
begin
  for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and c.relrowsecurity and
      (n.nspname='public' or (n.nspname='storage' and c.relname='objects'))
  loop
    execute format('create policy guardian_session on %I.%I as restrictive for all to authenticated using ((select private.guardian_session_valid())) with check ((select private.guardian_session_valid()))',
      t.nspname,t.relname);
  end loop;
end;
$$;

create function private.guardian_set_staff_access(_user_id uuid, _disabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_target_role text;
begin
  if not private.guardian_session_valid() then raise exception 'Sesi tidak valid.'; end if;
  select organization_id into v_org from public.profiles where id = (select auth.uid()) and role = 'owner';
  if v_org is null then raise exception 'Hanya Pemilik yang boleh mencabut sesi.'; end if;
  select role into v_target_role from public.profiles where id=_user_id and organization_id=v_org for update;
  if not found or v_target_role='owner' then raise exception 'Pilih akun staf toko ini.'; end if;
  insert into private.guardian_staff_access(user_id,organization_id,revoked_before,disabled)
    values(_user_id,v_org,clock_timestamp(),coalesce(_disabled,false))
    on conflict (user_id) do update set revoked_before=excluded.revoked_before,
      disabled=case when _disabled is null then guardian_staff_access.disabled else excluded.disabled end,updated_at=now();
end;
$$;
create function public.guardian_set_staff_access(_user_id uuid, _disabled boolean)
returns void language sql security invoker set search_path = '' as $$
  select private.guardian_set_staff_access(_user_id,_disabled)
$$;
revoke all on function private.guardian_set_staff_access(uuid,boolean), public.guardian_set_staff_access(uuid,boolean)
  from public,anon,authenticated;
grant execute on function private.guardian_set_staff_access(uuid,boolean), public.guardian_set_staff_access(uuid,boolean)
  to authenticated;

-- Capture the access decision as an operational audit event.
create function private.guardian_audit_staff_access()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.guardian_audit_events(organization_id,actor_id,actor_name,actor_role,table_name,
    record_id,operation,before_values,after_values)
  select new.organization_id,(select auth.uid()),p.full_name,p.role,'guardian_staff_access',new.user_id,tg_op,
    case when tg_op='UPDATE' then jsonb_build_object('disabled',old.disabled,'revoked_before',old.revoked_before) end,
    jsonb_build_object('disabled',new.disabled,'revoked_before',new.revoked_before)
  from public.profiles p where p.id=(select auth.uid());
  return new;
end;
$$;
revoke all on function private.guardian_audit_staff_access() from public,anon,authenticated;
create trigger guardian_access_audit after insert or update on private.guardian_staff_access
  for each row execute function private.guardian_audit_staff_access();

-- Preserve an existing pre-request hook by refusing to replace it.
do $$
declare v_existing text;
begin
  select substr(setting,length('pgrst.db_pre_request=')+1) into v_existing
  from pg_db_role_setting s join pg_roles r on r.oid=s.setrole
    cross join lateral unnest(s.setconfig) setting
  where r.rolname='authenticator' and setting like 'pgrst.db_pre_request=%' limit 1;
  if coalesce(v_existing,'') not in ('','public.guardian_pre_request') then
    raise exception 'Existing API pre-request hook requires integration: %',v_existing;
  end if;
end;
$$;
alter role authenticator set pgrst.db_pre_request = 'public.guardian_pre_request';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
commit;
