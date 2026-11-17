begin;

alter table public.sales
  add column customer_address text,
  add column referral_source text check (referral_source in
    ('recommendation','walk_in','google_maps','instagram','facebook','tiktok','other')),
  add column referral_note text,
  add check (referral_note is null or (referral_source is not distinct from 'other' and char_length(referral_note) <= 120));

create function private.normalize_customer_phone(_phone text)
returns text language sql immutable set search_path = '' as $$
  select case when left(digits,2) = '00' then substr(digits,3)
              when left(digits,1) = '0' then '62' || substr(digits,2)
              else digits end
  from (select regexp_replace(coalesce(_phone,''),'[^0-9]','','g') as digits) p
$$;
revoke all on function private.normalize_customer_phone(text) from public, anon, authenticated;
create index customers_normalized_phone_idx on public.customers
  (organization_id, private.normalize_customer_phone(phone));

create function private.create_cashier_sale_with_customer(
  _request_id uuid, _branch_id uuid, _customer_name text, _customer_type text,
  _payment_method text, _lines jsonb, _customer_id uuid, _paid_amount numeric,
  _due_date date, _customer_phone text, _discount numeric, _commission jsonb,
  _customer_address text, _referral_source text, _referral_note text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_sale uuid;
  v_existing uuid;
  v_customer uuid := _customer_id;
  v_phone text := left(btrim(coalesce(_customer_phone,'')),32);
  v_phone_key text := private.normalize_customer_phone(v_phone);
  v_name text := left(btrim(coalesce(_customer_name,'')),120);
  v_address text := nullif(left(btrim(coalesce(_customer_address,'')),300),'');
  v_source text := nullif(btrim(coalesce(_referral_source,'')),'');
  v_matches uuid[];
begin
  select organization_id into v_org from public.profiles
    where id = (select auth.uid()) and role in ('owner','operator');
  if v_org is null or not coalesce(private.can_operate_branch(_branch_id),false) then
    raise exception 'Tidak punya akses kasir cabang ini.';
  end if;
  if _request_id is null then raise exception 'ID transaksi wajib diisi.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text||':'||_request_id::text,0));
  select id into v_existing from public.sales where organization_id = v_org and request_id = _request_id;
  v_sale := private.create_cashier_sale_with_commission(_request_id,_branch_id,v_name,_customer_type,
    _payment_method,_lines,_customer_id,_paid_amount,_due_date,v_phone,_discount,_commission);
  if v_existing is not null then return v_sale; end if;

  if length(v_phone_key) between 8 and 15 then
    -- Serialize checkout-created contacts across all branches of the organization.
    perform pg_advisory_xact_lock(hashtextextended(v_org::text||':customer:'||v_phone_key,0));
    if v_customer is null then
      select array_agg(id) into v_matches from public.customers
        where organization_id = v_org and private.normalize_customer_phone(phone) = v_phone_key;
      if cardinality(v_matches) > 1 then
        raise exception 'Nomor ini terdaftar pada beberapa pelanggan. Pilih kontak pelanggan secara langsung.';
      end if;
      v_customer := v_matches[1];
      if v_customer is null and v_name <> '' then
        insert into public.customers(organization_id,name,phone,address,customer_type)
        values(v_org,v_name,v_phone,coalesce(v_address,''),_customer_type)
        on conflict (organization_id,name,phone) do nothing returning id into v_customer;
        if v_customer is null then
          select id into strict v_customer from public.customers
            where organization_id = v_org and name = v_name and phone = v_phone;
        end if;
      end if;
    else
      update public.customers c set phone = v_phone
        where c.organization_id = v_org and c.id = v_customer and btrim(c.phone) = ''
          and not exists (select 1 from public.customers existing where existing.organization_id = v_org
            and private.normalize_customer_phone(existing.phone) = v_phone_key);
    end if;
  end if;

  if v_customer is not null and v_address is not null then
    update public.customers set address = v_address where organization_id = v_org and id = v_customer
      and address is distinct from v_address;
  end if;
  update public.sales set customer_id = v_customer, customer_address = coalesce(v_address,
      (select nullif(address,'') from public.customers where organization_id = v_org and id = v_customer)),
    referral_source = v_source,
    referral_note = case when v_source = 'other' then nullif(left(btrim(coalesce(_referral_note,'')),120),'') end
  where id = v_sale;
  if _customer_id is null and v_customer is not null then
    update public.cash_transactions set customer_id = v_customer
      where organization_id = v_org and source_type = 'sale' and source_id = v_sale;
  end if;
  return v_sale;
end;
$$;

create function public.create_cashier_sale_with_customer(
  _request_id uuid, _branch_id uuid, _customer_name text, _customer_type text,
  _payment_method text, _lines jsonb, _customer_id uuid, _paid_amount numeric,
  _due_date date, _customer_phone text, _discount numeric, _commission jsonb,
  _customer_address text, _referral_source text, _referral_note text
)
returns uuid language sql security invoker set search_path = '' as $$
  select private.create_cashier_sale_with_customer(_request_id,_branch_id,_customer_name,_customer_type,
    _payment_method,_lines,_customer_id,_paid_amount,_due_date,_customer_phone,_discount,_commission,
    _customer_address,_referral_source,_referral_note)
$$;

revoke all on function
  private.create_cashier_sale_with_customer(uuid,uuid,text,text,text,jsonb,uuid,numeric,date,text,numeric,jsonb,text,text,text),
  public.create_cashier_sale_with_customer(uuid,uuid,text,text,text,jsonb,uuid,numeric,date,text,numeric,jsonb,text,text,text)
  from public, anon, authenticated;
grant execute on function
  private.create_cashier_sale_with_customer(uuid,uuid,text,text,text,jsonb,uuid,numeric,date,text,numeric,jsonb,text,text,text),
  public.create_cashier_sale_with_customer(uuid,uuid,text,text,text,jsonb,uuid,numeric,date,text,numeric,jsonb,text,text,text)
  to authenticated;

notify pgrst, 'reload schema';
commit;
