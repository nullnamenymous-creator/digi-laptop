-- Staff record claims from the internal warranty screen using the separate
-- warranty QR, stock barcode, supplier barcode, or serial number.
create or replace function private.submit_warranty_claim(
  _code text,
  _customer_name text,
  _customer_phone text,
  _customer_email text,
  _issue text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_item public.stock_items%rowtype;
  v_claim text;
  v_phone text := regexp_replace(coalesce(_customer_phone, ''), '[^0-9+]', '', 'g');
begin
  select organization_id into v_org from public.profiles where id = (select auth.uid()) and role in ('owner', 'operator');
  if v_org is null then raise exception 'Akun ini tidak dapat mencatat klaim garansi.'; end if;
  if length(btrim(coalesce(_customer_name, ''))) < 2 or length(btrim(coalesce(_customer_name, ''))) > 120 then raise exception 'Nama pelanggan harus 2–120 karakter.'; end if;
  if length(v_phone) < 8 or length(v_phone) > 24 then raise exception 'Nomor telepon tidak valid.'; end if;
  if length(btrim(coalesce(_issue, ''))) < 10 or length(btrim(coalesce(_issue, ''))) > 1200 then raise exception 'Jelaskan masalah dalam 10–1200 karakter.'; end if;
  if length(btrim(coalesce(_code, ''))) < 3 or length(btrim(_code)) > 100 then raise exception 'Kode QR, barcode, atau nomor seri tidak valid.'; end if;

  select * into v_item
  from public.stock_items
  where organization_id = v_org
    and (lower(warranty_code) = lower(btrim(_code)) or lower(barcode) = lower(btrim(_code))
      or lower(supplier_barcode) = lower(btrim(_code)) or lower(serial_number) = lower(btrim(_code)))
  order by case when lower(warranty_code) = lower(btrim(_code)) then 0 when lower(barcode) = lower(btrim(_code)) then 1 else 2 end
  limit 1;

  if not found or not private.can_operate_branch(v_item.branch_id) or v_item.status <> 'sold'
    or v_item.warranty_until is null or v_item.warranty_until < current_date then
    raise exception 'Unit tidak ditemukan, belum terjual, atau masa garansinya sudah berakhir.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_item.id::text || ':' || v_phone, 0));
  if exists(select 1 from public.warranty_claims where stock_item_id = v_item.id and customer_phone = v_phone and created_at > now() - interval '12 hours') then
    raise exception 'Klaim untuk unit ini baru saja diterima. Hubungi toko untuk menanyakan statusnya.';
  end if;

  v_claim := 'WG-' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  insert into public.warranty_claims(organization_id, branch_id, stock_item_id, claim_number, customer_name, customer_phone, customer_email, issue)
  values(v_org, v_item.branch_id, v_item.id, v_claim, btrim(_customer_name), v_phone, left(btrim(coalesce(_customer_email, '')), 254), btrim(_issue));
  return v_claim;
end;
$$;

revoke all on function private.submit_warranty_claim(text, text, text, text, text) from public, anon, authenticated;
grant execute on function private.submit_warranty_claim(text, text, text, text, text) to authenticated;
grant usage on schema private to authenticated;

create or replace function public.submit_warranty_claim(_code text, _customer_name text, _customer_phone text, _customer_email text, _issue text)
returns text language sql security invoker set search_path = '' as $$
  select private.submit_warranty_claim(_code, _customer_name, _customer_phone, _customer_email, _issue)
$$;
revoke all on function public.submit_warranty_claim(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_warranty_claim(text, text, text, text, text) to authenticated;
