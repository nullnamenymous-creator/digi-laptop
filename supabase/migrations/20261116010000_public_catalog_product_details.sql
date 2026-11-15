create function public.customer_catalog_details()
returns table(
  name text, brand text, model text, retail_price numeric, image_path text, phone text,
  description text, specifications jsonb, warranty_months integer
)
language sql stable security definer set search_path = '' as $catalog$
  select p.name, p.brand, p.model, p.retail_price, p.image_path, o.phone,
    p.description,
    jsonb_strip_nulls(jsonb_build_object(
      'processor', p.specifications ->> 'processor',
      'ram', p.specifications ->> 'ram',
      'storage', p.specifications ->> 'storage',
      'display', p.specifications ->> 'display',
      'graphics', p.specifications ->> 'graphics',
      'os', p.specifications ->> 'os'
    )),
    p.warranty_months
  from public.products p
  join public.organizations o on o.id = p.organization_id
  where o.id = '1f232ccc-ec3a-425c-83fe-2ab3cc27a029'
    and p.is_public and p.retail_price > 0
    and exists (
      select 1 from public.stock_items s
      join public.branches b on b.id = s.branch_id and b.organization_id = s.organization_id
      where s.product_id = p.id and s.organization_id = p.organization_id
        and b.is_active and s.status = 'available' and s.quantity > 0
    )
  order by p.name
$catalog$;

revoke all on function public.customer_catalog_details() from public;
grant execute on function public.customer_catalog_details() to anon, authenticated;
