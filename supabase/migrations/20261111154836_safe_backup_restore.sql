create or replace function public.restore_digi_laptop_backup(_backup jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_table text;
  v_keys text[];
  v_columns text;
  v_updates text;
  v_total integer := 0;
  v_count integer;
  v_identity jsonb;
  v_allowed constant text[] := array[
    'branches','products','suppliers','customers','intake_batches','stock_opening_batches',
    'stock_items','stock_transfers','stock_transfer_items','stock_repairs','stock_repair_parts',
    'sales','sale_items','service_tickets','service_parts','cash_transactions','stock_movements','warranty_claims'
  ];
begin
  select organization_id into v_org from public.profiles where id = v_uid and role = 'owner';
  if v_org is null then raise exception 'Pemulihan cadangan hanya dapat dilakukan oleh pemilik toko.'; end if;
  if jsonb_typeof(_backup) <> 'object'
    or _backup->>'format' <> 'digi-laptop-backup'
    or (_backup->>'version') not in ('1','2')
    or (_backup->>'organization_id')::uuid is distinct from v_org
    or jsonb_typeof(_backup->'tables') <> 'object' then
    raise exception 'Cadangan tidak valid atau bukan milik organisasi ini.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(_backup #> '{tables,sale_items}', '[]'::jsonb)) item
    where not exists (
      select 1 from jsonb_array_elements(coalesce(_backup #> '{tables,sales}', '[]'::jsonb)) parent
      where parent->>'id' = item->>'sale_id'
    )
  ) then raise exception 'Item penjualan merujuk nota yang tidak ada dalam cadangan.'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(_backup #> '{tables,stock_repair_parts}', '[]'::jsonb)) item
    where not exists (
      select 1 from jsonb_array_elements(coalesce(_backup #> '{tables,stock_repairs}', '[]'::jsonb)) parent
      where parent->>'id' = item->>'repair_id'
    )
  ) then raise exception 'Sparepart repair merujuk repair yang tidak ada dalam cadangan.'; end if;

  foreach v_table in array v_allowed loop
    if _backup->'tables' ? v_table then
      if jsonb_typeof(_backup->'tables'->v_table) <> 'array' then
        raise exception 'Bagian % pada cadangan bukan daftar data.', v_table;
      end if;
      if v_table not in ('sale_items','stock_repair_parts') and exists (
        select 1 from jsonb_array_elements(_backup->'tables'->v_table) row_data
        where (row_data->>'organization_id')::uuid is distinct from v_org
      ) then raise exception 'Data % berasal dari organisasi lain.', v_table; end if;
    end if;
  end loop;

  foreach v_table in array v_allowed loop
    if jsonb_array_length(coalesce(_backup->'tables'->v_table, '[]'::jsonb)) = 0 then continue; end if;
    select array_agg(key) into v_keys from jsonb_object_keys((_backup->'tables'->v_table)->0) key;
    if not ('id' = any(coalesce(v_keys, array[]::text[]))) then
      raise exception 'Data % tidak memiliki ID.', v_table;
    end if;
    select string_agg(format('%I', a.attname), ', ' order by a.attnum),
           string_agg(format('%I = excluded.%I', a.attname, a.attname), ', ' order by a.attnum)
      into v_columns, v_updates
    from pg_attribute a
    where a.attrelid = format('public.%I', v_table)::regclass
      and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
      and a.attname = any(v_keys);
    if v_columns is null then raise exception 'Kolom cadangan % tidak dikenali.', v_table; end if;
    v_updates := (select string_agg(format('%I = excluded.%I', a.attname, a.attname), ', ' order by a.attnum)
      from pg_attribute a where a.attrelid = format('public.%I', v_table)::regclass
        and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
        and a.attname = any(v_keys) and a.attname <> 'id');
    execute format(
      'insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) on conflict (id) %s',
      v_table, v_columns, v_columns, v_table,
      case when v_updates is null then 'do nothing' else 'do update set ' || v_updates end
    ) using _backup->'tables'->v_table;
    get diagnostics v_count = row_count;
    v_total := v_total + v_count;
  end loop;

  v_identity := coalesce(_backup->'organization', '{}'::jsonb);
  update public.organizations
  set name = coalesce(nullif(v_identity->>'name',''), name),
      phone = coalesce(v_identity->>'phone', phone),
      address = coalesce(v_identity->>'address', address)
  where id = v_org;
  return v_total;
end;
$$;

revoke all on function public.restore_digi_laptop_backup(jsonb) from public, anon;
grant execute on function public.restore_digi_laptop_backup(jsonb) to authenticated;
