alter table public.service_tickets add column tracking_code uuid not null default gen_random_uuid() unique;
create function public.customer_service_status(_code uuid)
returns table(ticket_number text, status text, branch text, updated_at timestamptz)
language sql stable security definer set search_path='' as $portal$
 select t.ticket_number,t.status,b.name,t.updated_at
 from public.service_tickets t join public.branches b on b.id=t.branch_id and b.organization_id=t.organization_id
 where t.tracking_code=_code
$portal$;
create function public.customer_catalog()
returns table(name text,brand text,model text,retail_price numeric,image_path text,phone text)
language sql stable security definer set search_path='' as $portal$
 select p.name,p.brand,p.model,p.retail_price,p.image_path,o.phone
 from public.products p join public.organizations o on o.id=p.organization_id
 where o.id='1f232ccc-ec3a-425c-83fe-2ab3cc27a029' and p.is_public and p.retail_price>0
 and exists(select 1 from public.stock_items s join public.branches b on b.id=s.branch_id
 where s.product_id=p.id and s.organization_id=p.organization_id and b.is_active and s.status='available' and s.quantity>0)
 order by p.name
$portal$;
revoke all on function public.customer_service_status(uuid),public.customer_catalog() from public;
grant execute on function public.customer_service_status(uuid),public.customer_catalog() to anon,authenticated;
