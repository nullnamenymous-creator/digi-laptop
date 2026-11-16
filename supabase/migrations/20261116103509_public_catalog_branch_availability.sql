begin;

create or replace function public.customer_catalog_storefront(_product_id uuid default null)
returns table(
  product_id uuid, name text, brand text, model text, retail_price numeric, image_path text, phone text,
  description text, specifications jsonb, warranty_months integer, gallery_paths text[], catalog_discount numeric, available_branches text[]
)
language sql stable security definer set search_path = '' as $catalog$
  select p.id, p.name, p.brand, p.model, p.retail_price, p.image_path, o.phone,
    p.description,
    jsonb_strip_nulls(jsonb_build_object(
      'processor', p.specifications ->> 'processor',
      'ram', p.specifications ->> 'ram',
      'storage', p.specifications ->> 'storage',
      'display', p.specifications ->> 'display',
      'graphics', p.specifications ->> 'graphics',
      'os', p.specifications ->> 'os'
    )),
    p.warranty_months, p.gallery_paths, p.catalog_discount, locations.names
  from public.products p
  join public.organizations o on o.id = p.organization_id
  join lateral (
    select array_agg(distinct b.name order by b.name) as names
    from public.stock_items s
    join public.branches b on b.id = s.branch_id and b.organization_id = s.organization_id
    where s.product_id = p.id and s.organization_id = p.organization_id
      and b.is_active and not b.is_central and s.status = 'available' and s.quantity > 0
  ) locations on locations.names is not null
  where o.id = '1f232ccc-ec3a-425c-83fe-2ab3cc27a029'
    and p.is_public and p.retail_price > 0 and (_product_id is null or p.id = _product_id)
  order by p.name
$catalog$;

revoke all on function public.customer_catalog_storefront(uuid) from public;
grant execute on function public.customer_catalog_storefront(uuid) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
