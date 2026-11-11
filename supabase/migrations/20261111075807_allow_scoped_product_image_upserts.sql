drop policy if exists product_images_read_for_upsert on storage.objects;
create policy product_images_read_for_upsert on storage.objects
for select to authenticated
using (
  bucket_id = 'product-images'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('owner','operator')
      and (storage.foldername(name))[1] = p.organization_id::text
      and (storage.foldername(name))[2] = 'products'
  )
);
