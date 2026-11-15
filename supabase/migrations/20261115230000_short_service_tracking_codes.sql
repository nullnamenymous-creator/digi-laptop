-- Keep the original UUID and RPC so previously printed QR codes stay valid.
alter table public.service_tickets
  add column short_tracking_code text generated always as (
    'DGL-' || upper(left(tracking_code::text, 8) || right(tracking_code::text, 2))
  ) stored unique;

create function public.customer_service_status_short(_code text)
returns table(ticket_number text, status text, branch text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $portal$
  select t.ticket_number, t.status, b.name, t.updated_at
  from public.service_tickets t
  join public.branches b on b.id = t.branch_id and b.organization_id = t.organization_id
  where t.short_tracking_code = upper(trim(_code))
$portal$;

revoke all on function public.customer_service_status_short(text) from public;
grant execute on function public.customer_service_status_short(text) to anon, authenticated;
