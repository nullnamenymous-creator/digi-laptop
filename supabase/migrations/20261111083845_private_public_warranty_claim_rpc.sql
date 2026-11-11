create or replace function private.submit_warranty_claim(_code text,_customer_name text,_customer_phone text,_customer_email text,_issue text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_item public.stock_items%rowtype; v_claim text; v_phone text:=regexp_replace(coalesce(_customer_phone,''),'[^0-9+]','','g');
begin
 if length(btrim(coalesce(_customer_name,'')))<2 or length(btrim(coalesce(_customer_name,'')))>120 then raise exception 'Nama pelanggan harus 2–120 karakter.'; end if;
 if length(v_phone)<8 or length(v_phone)>24 then raise exception 'Nomor telepon tidak valid.'; end if;
 if length(btrim(coalesce(_issue,'')))<10 or length(btrim(coalesce(_issue,'')))>1200 then raise exception 'Jelaskan masalah dalam 10–1200 karakter.'; end if;
 if length(btrim(coalesce(_code,'')))<3 or length(btrim(_code))>100 then raise exception 'Barcode atau nomor seri tidak valid.'; end if;
 select id into v_org from public.organizations order by created_at limit 1;
 if v_org is null then raise exception 'Data toko tidak tersedia.'; end if;
 select * into v_item from public.stock_items where organization_id=v_org and (lower(barcode)=lower(btrim(_code)) or lower(supplier_barcode)=lower(btrim(_code)) or lower(serial_number)=lower(btrim(_code))) order by case when lower(barcode)=lower(btrim(_code)) then 0 else 1 end limit 1;
 if not found or v_item.status<>'sold' or v_item.warranty_until is null or v_item.warranty_until<current_date then raise exception 'Unit tidak ditemukan, belum terjual, atau masa garansinya sudah berakhir.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_item.id::text||':'||v_phone,0));
 if exists(select 1 from public.warranty_claims where stock_item_id=v_item.id and customer_phone=v_phone and created_at>now()-interval '12 hours') then raise exception 'Klaim untuk unit ini baru saja diterima. Hubungi toko untuk menanyakan statusnya.'; end if;
 v_claim:='WG-'||to_char(now() at time zone 'Asia/Jakarta','YYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
 insert into public.warranty_claims(organization_id,branch_id,stock_item_id,claim_number,customer_name,customer_phone,customer_email,issue) values(v_org,v_item.branch_id,v_item.id,v_claim,btrim(_customer_name),v_phone,left(btrim(coalesce(_customer_email,'')),254),btrim(_issue));
 return v_claim;
end; $$;
revoke all on function private.submit_warranty_claim(text,text,text,text,text) from public,anon,authenticated;
grant usage on schema private to anon,authenticated;
grant execute on function private.submit_warranty_claim(text,text,text,text,text) to anon,authenticated;
create or replace function public.submit_warranty_claim(_code text,_customer_name text,_customer_phone text,_customer_email text,_issue text)
returns text language sql security invoker set search_path = '' as $$ select private.submit_warranty_claim(_code,_customer_name,_customer_phone,_customer_email,_issue) $$;
revoke all on function public.submit_warranty_claim(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_warranty_claim(text,text,text,text,text) to anon,authenticated;

drop policy if exists promotions_public_active on public.promotions;
drop policy if exists promotions_owner_manage on public.promotions;
drop policy if exists promotions_owner_read on public.promotions;
create policy promotions_public_active on public.promotions for select to anon using(is_active and (starts_at is null or starts_at<=current_date) and (ends_at is null or ends_at>=current_date));
create policy promotions_owner_read on public.promotions for select to authenticated using(private.is_owner(organization_id) or (is_active and (starts_at is null or starts_at<=current_date) and (ends_at is null or ends_at>=current_date)));
create policy promotions_owner_insert on public.promotions for insert to authenticated with check(private.is_owner(organization_id));
create policy promotions_owner_update on public.promotions for update to authenticated using(private.is_owner(organization_id)) with check(private.is_owner(organization_id));
create policy promotions_owner_delete on public.promotions for delete to authenticated using(private.is_owner(organization_id));
