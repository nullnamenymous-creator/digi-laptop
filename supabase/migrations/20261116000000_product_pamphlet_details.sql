alter table public.products
  add column description text not null default '',
  add column specifications jsonb not null default '{}'::jsonb
    check (jsonb_typeof(specifications) = 'object'),
  add column gallery_paths text[] not null default '{}'
    check (cardinality(gallery_paths) <= 3);

create function private.set_product_gallery(
  _product_id uuid, _cover text, _gallery text[], _previous_cover text, _previous_gallery text[]
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_product public.products%rowtype;
  v_org uuid;
  v_role text;
  v_branch uuid;
begin
  select organization_id, role, branch_id into v_org, v_role, v_branch
  from public.profiles where id = (select auth.uid());
  if v_org is null or v_role not in ('owner', 'operator') then
    raise exception 'Tidak punya akses untuk mengubah foto produk.';
  end if;
  select * into v_product from public.products
  where id = _product_id and organization_id = v_org for update;
  if not found or (v_role = 'operator' and not exists (
    select 1 from public.stock_items s
    where s.organization_id = v_org and s.branch_id = v_branch and s.product_id = _product_id
  )) then
    raise exception 'Produk tidak tersedia untuk cabang Anda.';
  end if;
  if v_product.image_path is distinct from _previous_cover
     or v_product.gallery_paths is distinct from _previous_gallery then
    raise exception 'Foto sudah berubah. Muat ulang produk dan coba lagi.';
  end if;
  if _cover is null or _cover not like v_org::text || '/products/%'
     or _gallery is null or cardinality(_gallery) > 3 or exists (
       select 1 from unnest(_gallery) as photo(path)
       where path is null or path not like v_org::text || '/products/%'
     ) then
    raise exception 'Lokasi atau jumlah foto tidak valid.';
  end if;
  update public.products set image_path = _cover, gallery_paths = _gallery where id = _product_id;
end;
$$;

create function public.set_product_gallery(
  _product_id uuid, _cover text, _gallery text[], _previous_cover text, _previous_gallery text[]
) returns void language sql security invoker set search_path = '' as $$
  select private.set_product_gallery(_product_id, _cover, _gallery, _previous_cover, _previous_gallery)
$$;

revoke all on function private.set_product_gallery(uuid,text,text[],text,text[]) from public, anon;
revoke all on function public.set_product_gallery(uuid,text,text[],text,text[]) from public, anon;
grant execute on function private.set_product_gallery(uuid,text,text[],text,text[]) to authenticated;
grant execute on function public.set_product_gallery(uuid,text,text[],text,text[]) to authenticated;
