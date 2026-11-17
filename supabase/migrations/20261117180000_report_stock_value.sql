begin;

create function public.report_stock_value(_organization_id uuid, _branch_id uuid default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with owned_store as (
    select _organization_id as id where private.is_owner(_organization_id)
  ),
  units as (
    select s.quantity, s.acquisition_cost as unit_cost, s.status = 'available' as ready,
      false as in_transit, p.retail_price - case when p.is_public then p.catalog_discount else 0 end as unit_price
    from owned_store o
    join public.stock_items s on s.organization_id = o.id
    join public.products p on p.id = s.product_id and p.organization_id = o.id
    where s.quantity > 0
      and s.status not in ('sold','used_for_service','withdrawn','transferred')
      and (_branch_id is null or s.branch_id = _branch_id)
    union all
    select i.quantity, i.unit_cost, false, true, null::numeric
    from owned_store o
    join public.stock_transfers t on t.organization_id = o.id
    join public.stock_transfer_items i on i.transfer_id = t.id and i.organization_id = o.id
    where t.status = 'in_transit'
      and (_branch_id is null or t.source_branch_id = _branch_id)
  )
  select jsonb_build_object(
    'units', coalesce(sum(quantity), 0),
    'cost', coalesce(sum(quantity * unit_cost) filter (where unit_cost > 0), 0),
    'retail', coalesce(sum(quantity * unit_price) filter (where ready and unit_price > 0), 0),
    'readyUnits', coalesce(sum(quantity) filter (where ready), 0),
    'transitUnits', coalesce(sum(quantity) filter (where in_transit), 0),
    'missingCost', coalesce(sum(quantity) filter (where coalesce(unit_cost, 0) <= 0), 0),
    'missingPrice', coalesce(sum(quantity) filter (where ready and coalesce(unit_price, 0) <= 0), 0)
  )
  from units
  having exists (select 1 from owned_store)
$$;

revoke all on function public.report_stock_value(uuid, uuid) from public, anon, authenticated;
grant execute on function public.report_stock_value(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
