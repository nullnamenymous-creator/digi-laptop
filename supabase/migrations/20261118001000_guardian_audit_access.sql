begin;

-- The scoped profile policy is authoritative for the staff directory.
drop policy if exists profiles_read_org on public.profiles;

-- Enforce the customer edit/delete permissions already presented by the UI.
drop policy if exists customers_update_member on public.customers;
create policy customers_update_member on public.customers for update to authenticated
  using (private.is_owner(organization_id)) with check (private.is_owner(organization_id));
drop policy if exists customers_delete_member on public.customers;
create policy customers_delete_member on public.customers for delete to authenticated
  using (private.is_owner(organization_id));

create table public.guardian_audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  branch_id uuid,
  actor_id uuid,
  actor_name text not null default '',
  actor_role text not null default '',
  table_name text not null,
  record_id uuid not null,
  operation text not null check (operation in ('INSERT','UPDATE','DELETE')),
  before_values jsonb,
  after_values jsonb,
  created_at timestamptz not null default now()
);
create index guardian_audit_org_date_idx on public.guardian_audit_events(organization_id,created_at desc,id desc);
alter table public.guardian_audit_events enable row level security;
revoke all on public.guardian_audit_events from public, anon, authenticated;
grant select on public.guardian_audit_events to authenticated;
create policy guardian_audit_owner on public.guardian_audit_events for select to authenticated
  using (private.is_owner(organization_id));

create function private.guardian_audit_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_after jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_after,v_before);
  v_keys text[];
  v_name text;
  v_role text;
begin
  -- Whitelist operational fields. Customer identity and account secrets are excluded.
  v_keys := case tg_table_name
    when 'profiles' then array['organization_id','branch_id','role']
    when 'products' then array['sku','name','cost_price','retail_price','reseller_price','is_public','archived_at']
    when 'stock_items' then array['branch_id','product_id','barcode','status','quantity','acquisition_cost']
    when 'sales' then array['branch_id','receipt_number','total','paid_amount','discount_amount','payment_method']
    when 'stock_transfers' then array['source_branch_id','destination_branch_id','status','transfer_number']
    when 'cash_transactions' then array['branch_id','direction','category','amount','source_type','source_id']
    else array[]::text[] end;
  if v_before is not null then
    select coalesce(jsonb_object_agg(key,value),'{}') into v_before from jsonb_each(v_before) where key = any(v_keys);
  end if;
  if v_after is not null then
    select coalesce(jsonb_object_agg(key,value),'{}') into v_after from jsonb_each(v_after) where key = any(v_keys);
  end if;
  if tg_op = 'UPDATE' and v_before = v_after then return new; end if;
  select full_name, role into v_name,v_role from public.profiles where id = (select auth.uid());
  insert into public.guardian_audit_events(organization_id,branch_id,actor_id,actor_name,actor_role,
    table_name,record_id,operation,before_values,after_values)
  values((v_row->>'organization_id')::uuid,coalesce(v_row->>'branch_id',v_row->>'source_branch_id')::uuid,
    (select auth.uid()),coalesce(v_name,''),coalesce(v_role,''),tg_table_name,(v_row->>'id')::uuid,
    tg_op,v_before,v_after);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.guardian_audit_change() from public, anon, authenticated;
create trigger guardian_audit after insert or update or delete on public.profiles
  for each row execute function private.guardian_audit_change();
create trigger guardian_audit after insert or update or delete on public.products
  for each row execute function private.guardian_audit_change();
create trigger guardian_audit after insert or update or delete on public.stock_items
  for each row execute function private.guardian_audit_change();
create trigger guardian_audit after insert or update or delete on public.sales
  for each row execute function private.guardian_audit_change();
create trigger guardian_audit after insert or update or delete on public.stock_transfers
  for each row execute function private.guardian_audit_change();
create trigger guardian_audit after insert or update or delete on public.cash_transactions
  for each row execute function private.guardian_audit_change();

notify pgrst, 'reload schema';
commit;
