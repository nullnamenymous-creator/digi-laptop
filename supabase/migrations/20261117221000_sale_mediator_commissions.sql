begin;

create table public.sale_commissions (
  sale_id uuid primary key references public.sales(id),
  branch_id uuid not null references public.branches(id),
  mediator_name text not null check (length(mediator_name) between 1 and 120),
  amount numeric(14,2) not null check (amount > 0),
  settlement_method text not null check (settlement_method in ('cashier','retained','pending')),
  settled_at timestamptz,
  settled_by uuid references auth.users(id),
  check ((settlement_method = 'pending') = (settled_at is null))
);

create index sale_commissions_pending_idx on public.sale_commissions(branch_id) where settled_at is null;
alter table public.sale_commissions enable row level security;
revoke all on public.sale_commissions from anon, authenticated;
grant select on public.sale_commissions to authenticated;
create policy sale_commissions_read on public.sale_commissions for select to authenticated
  using (private.can_operate_branch(branch_id));

create function private.create_cashier_sale_with_commission(
  _request_id uuid, _branch_id uuid, _customer_name text, _customer_type text,
  _payment_method text, _lines jsonb, _customer_id uuid, _paid_amount numeric,
  _due_date date, _customer_phone text, _discount numeric, _commission jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_org uuid;
  v_sale uuid;
  v_existing uuid;
  v_total numeric;
  v_receipt text;
  v_name text := btrim(coalesce(_commission->>'name',''));
  v_amount numeric;
  v_method text := coalesce(_commission->>'method','');
begin
  if _commission is not null then
    select organization_id into v_org from public.profiles where id = v_user and role in ('owner','operator');
    if v_org is null or not coalesce(private.can_operate_branch(_branch_id),false) then
      raise exception 'Tidak punya akses kasir cabang ini.';
    end if;
    if _request_id is null then raise exception 'ID transaksi wajib diisi.'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_org::text||':'||_request_id::text,0));
    select id into v_existing from public.sales where organization_id = v_org and request_id = _request_id;
  end if;

  v_sale := private.create_cashier_sale(_request_id,_branch_id,_customer_name,_customer_type,
    _payment_method,_lines,_customer_id,_paid_amount,_due_date,_customer_phone,_discount);
  if _commission is null or v_existing is not null then return v_sale; end if;

  if length(v_name) not between 1 and 120 or v_method not in ('cashier','retained','pending')
      or coalesce(_commission->>'amount','') !~ '^[0-9]{1,12}$' then
    raise exception 'Lengkapi nama, nominal rupiah bulat, dan cara pembayaran komisi.';
  end if;
  v_amount := (_commission->>'amount')::numeric;
  select total, receipt_number into strict v_total, v_receipt from public.sales where id = v_sale;
  if v_amount <= 0 or v_amount >= v_total then
    raise exception 'Komisi harus lebih dari nol dan lebih kecil dari total nota.';
  end if;
  if v_method = 'retained' and v_amount > _paid_amount then
    raise exception 'Komisi yang dipotong dari setoran melebihi pembayaran pelanggan.';
  end if;

  insert into public.sale_commissions(sale_id,branch_id,mediator_name,amount,settlement_method,settled_at,settled_by)
  values(v_sale,_branch_id,v_name,v_amount,v_method,
    case when v_method <> 'pending' then now() end, case when v_method <> 'pending' then v_user end);

  if v_method = 'retained' then
    if v_amount = _paid_amount then
      delete from public.cash_transactions where organization_id = v_org and source_type = 'sale'
        and source_id = v_sale and direction = 'income';
    else
      update public.cash_transactions set amount = amount - v_amount,
        description = 'Setoran mediator untuk nota ' || v_receipt
      where organization_id = v_org and source_type = 'sale' and source_id = v_sale and direction = 'income';
    end if;
  elsif v_method = 'cashier' then
    insert into public.cash_transactions(organization_id,branch_id,direction,category,amount,description,source_type,source_id,created_by)
    values(v_org,_branch_id,'expense','Komisi mediator',v_amount,'Komisi nota ' || v_receipt,'sale_commission',v_sale,v_user);
  end if;
  return v_sale;
end;
$$;

create function public.create_cashier_sale_with_commission(
  _request_id uuid, _branch_id uuid, _customer_name text, _customer_type text,
  _payment_method text, _lines jsonb, _customer_id uuid, _paid_amount numeric,
  _due_date date, _customer_phone text, _discount numeric, _commission jsonb
)
returns uuid language sql security invoker set search_path = '' as $$
  select private.create_cashier_sale_with_commission(_request_id,_branch_id,_customer_name,_customer_type,
    _payment_method,_lines,_customer_id,_paid_amount,_due_date,_customer_phone,_discount,_commission)
$$;

create function private.settle_sale_commission(_sale_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_org uuid;
  v_receipt text;
  v_commission public.sale_commissions%rowtype;
begin
  select organization_id into v_org from public.profiles where id = v_user and role in ('owner','operator');
  select c.* into v_commission from public.sale_commissions c join public.sales s on s.id = c.sale_id
    where c.sale_id = _sale_id and s.organization_id = v_org
      and private.can_operate_branch(c.branch_id) for update of c;
  if not found then raise exception 'Komisi tidak ditemukan di cabang ini.'; end if;
  if v_commission.settled_at is not null then return; end if;

  select receipt_number into strict v_receipt from public.sales where id = _sale_id;
  insert into public.cash_transactions(organization_id,branch_id,direction,category,amount,description,source_type,source_id,created_by)
  values(v_org,v_commission.branch_id,'expense','Komisi mediator',v_commission.amount,
    'Komisi nota ' || v_receipt,'sale_commission',_sale_id,v_user);
  update public.sale_commissions set settlement_method = 'cashier', settled_at = now(), settled_by = v_user
    where sale_id = _sale_id;
end;
$$;

create function public.settle_sale_commission(_sale_id uuid)
returns void language sql security invoker set search_path = '' as $$
  select private.settle_sale_commission(_sale_id)
$$;

revoke all on function
  private.create_cashier_sale_with_commission(uuid,uuid,text,text,text,jsonb,uuid,numeric,date,text,numeric,jsonb),
  public.create_cashier_sale_with_commission(uuid,uuid,text,text,text,jsonb,uuid,numeric,date,text,numeric,jsonb),
  private.settle_sale_commission(uuid), public.settle_sale_commission(uuid) from public, anon, authenticated;
grant execute on function
  private.create_cashier_sale_with_commission(uuid,uuid,text,text,text,jsonb,uuid,numeric,date,text,numeric,jsonb),
  public.create_cashier_sale_with_commission(uuid,uuid,text,text,text,jsonb,uuid,numeric,date,text,numeric,jsonb),
  private.settle_sale_commission(uuid), public.settle_sale_commission(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
