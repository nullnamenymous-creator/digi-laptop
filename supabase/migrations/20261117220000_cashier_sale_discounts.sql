begin;

alter table public.sales add column discount_amount numeric(14,2) not null default 0
  check (discount_amount >= 0);

create function private.create_cashier_sale(
  _request_id uuid, _branch_id uuid, _customer_name text, _customer_type text,
  _payment_method text, _lines jsonb, _customer_id uuid, _paid_amount numeric,
  _due_date date, _customer_phone text, _discount numeric
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_sale uuid;
  v_branch uuid;
  v_subtotal numeric;
  v_total numeric;
begin
  select organization_id into v_org from public.profiles
    where id = (select auth.uid()) and role in ('owner','operator');
  if v_org is null or not coalesce(private.can_operate_branch(_branch_id),false) then
    raise exception 'Tidak punya akses kasir cabang ini.';
  end if;
  if _request_id is null then raise exception 'ID transaksi wajib diisi.'; end if;
  -- Use the existing checkout lock so old and new clients can retry the same request.
  perform pg_advisory_xact_lock(hashtextextended(v_org::text||':'||_request_id::text,0));
  select id, branch_id into v_sale, v_branch from public.sales
    where organization_id = v_org and request_id = _request_id;
  if found then
    if v_branch is distinct from _branch_id then
      raise exception 'ID transaksi sudah digunakan di cabang lain.';
    end if;
    return v_sale;
  end if;
  if _discount is null or _discount::text in ('NaN','Infinity','-Infinity')
      or _discount < 0 or _discount <> trunc(_discount) then
    raise exception 'Masukkan potongan dalam rupiah bulat.';
  end if;
  if _discount = 0 then
    return private.create_sale_with_receipt(_request_id,_branch_id,_customer_name,_customer_type,
      _payment_method,_lines,_customer_id,_paid_amount,_due_date,_customer_phone);
  end if;

  -- Existing checkout validates prices and records the actual payment. Its gross-total
  -- due date check uses a temporary date until the discounted balance is validated.
  v_sale := private.create_sale_with_receipt(_request_id,_branch_id,_customer_name,_customer_type,
    _payment_method,_lines,_customer_id,_paid_amount,coalesce(_due_date,current_date),_customer_phone);
  select total into strict v_subtotal from public.sales where id = v_sale;
  v_total := v_subtotal - _discount;
  if v_total <= 0 then raise exception 'Potongan harus lebih kecil dari subtotal.'; end if;
  if _paid_amount > v_total then raise exception 'Pembayaran melebihi total setelah potongan.'; end if;
  if _paid_amount < v_total and _due_date is null then
    raise exception 'Tanggal jatuh tempo wajib untuk piutang.';
  end if;

  -- Allocate by cumulative value so rounding still adds up to the exact discount.
  with amounts as (
    select id, line_total, sum(line_total) over (order by id rows unbounded preceding) as running_total
    from public.sale_items where sale_id = v_sale
  )
  update public.sale_items i set line_total = a.line_total
    - round(a.running_total * _discount / v_subtotal, 2)
    + round((a.running_total - a.line_total) * _discount / v_subtotal, 2)
  from amounts a where a.id = i.id;

  update public.sales set total = v_total, discount_amount = _discount,
    due_date = case when _paid_amount < v_total then _due_date end
  where id = v_sale;
  return v_sale;
end;
$$;

create function public.create_cashier_sale(
  _request_id uuid, _branch_id uuid, _customer_name text, _customer_type text,
  _payment_method text, _lines jsonb, _customer_id uuid, _paid_amount numeric,
  _due_date date, _customer_phone text, _discount numeric
)
returns uuid language sql security invoker set search_path = '' as $$
  select private.create_cashier_sale(_request_id,_branch_id,_customer_name,_customer_type,
    _payment_method,_lines,_customer_id,_paid_amount,_due_date,_customer_phone,_discount)
$$;
revoke all on function private.create_cashier_sale(uuid,uuid,text,text,text,jsonb,uuid,numeric,date,text,numeric),
  public.create_cashier_sale(uuid,uuid,text,text,text,jsonb,uuid,numeric,date,text,numeric)
  from public, anon, authenticated;
grant execute on function private.create_cashier_sale(uuid,uuid,text,text,text,jsonb,uuid,numeric,date,text,numeric),
  public.create_cashier_sale(uuid,uuid,text,text,text,jsonb,uuid,numeric,date,text,numeric) to authenticated;

notify pgrst, 'reload schema';
commit;
