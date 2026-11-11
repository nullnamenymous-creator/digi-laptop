-- Disable the public catalog, promotion feed, and anonymous warranty-claim
-- endpoint while retaining their historic records for possible later use.
drop view if exists public.public_catalog;
drop policy if exists products_public_catalog on public.products;
revoke select on public.products from anon;
revoke select (id,organization_id,name,brand,model,category,retail_price,is_public,image_path)
  on public.products from anon;

revoke all on public.promotions from anon,authenticated;
drop policy if exists promotions_public_active on public.promotions;
drop policy if exists promotions_owner_manage on public.promotions;
drop policy if exists promotions_owner_read on public.promotions;
drop policy if exists promotions_owner_insert on public.promotions;
drop policy if exists promotions_owner_update on public.promotions;
drop policy if exists promotions_owner_delete on public.promotions;

revoke execute on function public.submit_warranty_claim(text,text,text,text,text) from anon;
revoke execute on function private.submit_warranty_claim(text,text,text,text,text) from anon;
