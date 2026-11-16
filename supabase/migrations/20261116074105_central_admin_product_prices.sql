create or replace function private.limit_central_admin_product_changes()
returns trigger language plpgsql set search_path = '' as $$
begin
  if private.is_central_admin(new.organization_id) then
    if tg_op = 'INSERT' then
      if new.retail_price <> 0 or new.reseller_price <> 0 or new.is_public then
        raise exception 'Harga jual dan publikasi katalog dikelola Pemilik.';
      end if;
    elsif (to_jsonb(new) - array['name','brand','model','description','specifications','image_path','gallery_paths','warranty_months','catalog_discount','cost_price','retail_price','reseller_price','updated_at'])
          is distinct from (to_jsonb(old) - array['name','brand','model','description','specifications','image_path','gallery_paths','warranty_months','catalog_discount','cost_price','retail_price','reseller_price','updated_at']) then
      raise exception 'Admin Pusat hanya dapat memperbarui identitas, spesifikasi, garansi, foto produk, modal, harga jual, dan potongan harga.';
    end if;
  end if;
  return new;
end;
$$;
