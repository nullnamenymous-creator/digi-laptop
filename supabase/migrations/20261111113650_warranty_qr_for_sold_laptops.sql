-- Internal warranty identity is separate from the intake/stock barcode.
alter table public.stock_items
  add column if not exists warranty_code text;

update public.stock_items as item
set warranty_code = 'DLW-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))
where item.status = 'sold'
  and item.warranty_until is not null
  and item.warranty_code is null
  and exists (
    select 1 from public.products as product
    where product.id = item.product_id and product.category = 'Laptop'
  );

create unique index if not exists stock_items_warranty_code_uidx
  on public.stock_items (warranty_code)
  where warranty_code is not null;

create or replace function private.assign_sold_laptop_warranty_code()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_category text;
begin
  if new.status = 'sold' and new.warranty_until is not null and new.warranty_code is null then
    select product.category into v_category
    from public.products as product
    where product.id = new.product_id;

    if v_category = 'Laptop' then
      new.warranty_code := 'DLW-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.assign_sold_laptop_warranty_code() from public, anon, authenticated;

drop trigger if exists assign_sold_laptop_warranty_code on public.stock_items;
create trigger assign_sold_laptop_warranty_code
before insert or update on public.stock_items
for each row execute function private.assign_sold_laptop_warranty_code();
