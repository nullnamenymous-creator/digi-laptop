alter function public.restore_digi_laptop_backup(jsonb) set schema private;

create or replace function public.restore_digi_laptop_backup(_backup jsonb)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.restore_digi_laptop_backup(_backup)
$$;

revoke all on function private.restore_digi_laptop_backup(jsonb) from public, anon;
grant execute on function private.restore_digi_laptop_backup(jsonb) to authenticated;
revoke all on function public.restore_digi_laptop_backup(jsonb) from public, anon;
grant execute on function public.restore_digi_laptop_backup(jsonb) to authenticated;
