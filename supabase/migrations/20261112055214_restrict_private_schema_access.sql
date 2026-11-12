-- Keep internal application helpers out of anonymous API access.
revoke usage on schema private from public, anon;
grant usage on schema private to authenticated, service_role;
revoke all on function private.copy_intake_unit_cost() from public, anon, authenticated;
