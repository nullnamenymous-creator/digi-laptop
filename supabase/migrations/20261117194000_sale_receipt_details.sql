begin;

alter table public.sales add column customer_phone text;
alter table public.sale_items add column unit_barcode text;

create function private.capture_sale_item_barcode()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  select s.barcode into new.unit_barcode from public.stock_items s where s.id = new.stock_item_id;
  return new;
end;
$$;
revoke all on function private.capture_sale_item_barcode() from public, anon, authenticated;
create trigger capture_sale_item_barcode before insert on public.sale_items
for each row execute function private.capture_sale_item_barcode();

create function private.create_sale_with_receipt(
  _request_id uuid, _branch_id uuid, _customer_name text, _customer_type text,
  _payment_method text, _lines jsonb, _customer_id uuid, _paid_amount numeric,
  _due_date date, _customer_phone text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_sale uuid;
begin
  v_sale := private.create_sale_with_request(_request_id,_branch_id,_customer_name,_customer_type,
    _payment_method,_lines,_customer_id,_paid_amount,_due_date);
  update public.sales s
    set customer_phone = coalesce(nullif(left(btrim(coalesce(_customer_phone,'')),32),''),
      (select nullif(btrim(c.phone),'') from public.customers c where c.id = s.customer_id
        and c.organization_id = s.organization_id), '')
    where s.id = v_sale and s.customer_phone is null;
  return v_sale;
end;
$$;

create function public.create_sale_with_receipt(
  _request_id uuid, _branch_id uuid, _customer_name text, _customer_type text,
  _payment_method text, _lines jsonb, _customer_id uuid, _paid_amount numeric,
  _due_date date, _customer_phone text
)
returns uuid language sql security invoker set search_path = '' as $$
  select private.create_sale_with_receipt(_request_id,_branch_id,_customer_name,_customer_type,
    _payment_method,_lines,_customer_id,_paid_amount,_due_date,_customer_phone)
$$;
revoke all on function private.create_sale_with_receipt(uuid,uuid,text,text,text,jsonb,uuid,numeric,date,text),
  public.create_sale_with_receipt(uuid,uuid,text,text,text,jsonb,uuid,numeric,date,text) from public, anon, authenticated;
grant execute on function private.create_sale_with_receipt(uuid,uuid,text,text,text,jsonb,uuid,numeric,date,text),
  public.create_sale_with_receipt(uuid,uuid,text,text,text,jsonb,uuid,numeric,date,text) to authenticated;

create function private.copy_catalog_order_receipt_phone()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.sale_id is not null and new.sale_id is distinct from old.sale_id then
    update public.sales set customer_phone = new.phone
    where id = new.sale_id and organization_id = new.organization_id and customer_phone is null;
  end if;
  return new;
end;
$$;
revoke all on function private.copy_catalog_order_receipt_phone() from public, anon, authenticated;
create trigger copy_catalog_order_receipt_phone after update of sale_id on private.catalog_orders
for each row execute function private.copy_catalog_order_receipt_phone();

notify pgrst, 'reload schema';
commit;
