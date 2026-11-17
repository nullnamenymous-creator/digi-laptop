begin;

alter table public.sale_items
  add column specifications jsonb,
  add constraint sale_item_specifications_object check (jsonb_typeof(specifications) = 'object');

create function private.capture_sale_item_specifications()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  select p.specifications into new.specifications
  from public.products p
  where p.id = new.product_id;
  return new;
end;
$$;

revoke all on function private.capture_sale_item_specifications() from public, anon, authenticated;

create trigger capture_sale_item_specifications
  before insert on public.sale_items
  for each row execute function private.capture_sale_item_specifications();

notify pgrst, 'reload schema';

commit;
