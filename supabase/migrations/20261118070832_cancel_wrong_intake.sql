begin;

-- Immutable evidence of corrections; the original operational rows are removed
-- only after the owner confirms that no money actually left the store.
create table public.intake_cancellations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  branch_id uuid not null references public.branches(id),
  intake_batch_id uuid not null unique,
  reason text not null check (length(btrim(reason)) between 10 and 1000),
  cancelled_by uuid references auth.users(id) on delete set null,
  cancelled_by_name text not null,
  created_at timestamptz not null default now(),
  snapshot jsonb not null
);
create index intake_cancellations_branch_idx on public.intake_cancellations(branch_id, created_at desc);
alter table public.intake_cancellations enable row level security;
revoke all on public.intake_cancellations from public, anon, authenticated;
grant select on public.intake_cancellations to authenticated;
create policy intake_cancellations_owner_read on public.intake_cancellations
  for select to authenticated using (private.is_owner(organization_id));

create function private.cancel_wrong_intake(_id uuid, _reason text, _payment_was_input_error boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  b public.intake_batches%rowtype;
  v_id uuid;
  v_snapshot jsonb;
  v_name text;
begin
  if auth.uid() is null then raise exception 'Masuk sebagai Pemilik untuk membatalkan penerimaan.'; end if;
  if length(btrim(coalesce(_reason, ''))) not between 10 and 1000 then
    raise exception 'Alasan pembatalan wajib diisi, 10 sampai 1000 karakter.';
  end if;
  select * into b from public.intake_batches where id = _id for update;
  if not found then
    select id into v_id from public.intake_cancellations
      where intake_batch_id = _id and private.is_owner(organization_id);
    if v_id is not null then return v_id; end if;
    raise exception 'Penerimaan tidak ditemukan atau akses ditolak.';
  end if;
  if not private.is_owner(b.organization_id) then raise exception 'Hanya Pemilik yang boleh membatalkan penerimaan.'; end if;
  if not private.is_central_branch(b.branch_id) then raise exception 'Pembatalan penerimaan hanya untuk Cabang Pusat.'; end if;
  if _payment_was_input_error is distinct from true then
    raise exception 'Konfirmasi bahwa pembayaran hanya salah input dan tidak ada uang keluar ke supplier.';
  end if;
  perform 1 from public.stock_items where intake_batch_id = b.id order by id for update;
  perform 1 from public.cash_transactions where source_type = 'intake_batch' and source_id = b.id order by id for update;
  if b.unit_count <= 0 or coalesce((select sum(quantity) from public.stock_items where intake_batch_id = b.id), 0) <> b.unit_count then
    raise exception 'Jumlah unit penerimaan sudah berubah. Periksa riwayat stok sebelum membatalkan.';
  end if;
  if exists(select 1 from public.cash_transactions where source_id = b.id and
    (source_type is distinct from 'intake_batch' or organization_id <> b.organization_id or branch_id <> b.branch_id or direction <> 'expense'))
    or coalesce((select sum(amount) from public.cash_transactions where source_type = 'intake_batch' and source_id = b.id), 0) <> b.amount_paid then
    raise exception 'Catatan pembayaran tidak cocok. Periksa keuangan sebelum membatalkan.';
  end if;
  select full_name into v_name from public.profiles where id = auth.uid() and organization_id = b.organization_id;
  v_snapshot := jsonb_build_object(
    'batch', to_jsonb(b),
    'product', (select to_jsonb(p) from public.products p where p.id = b.product_id),
    'stock_items', coalesce((select jsonb_agg(to_jsonb(s)) from public.stock_items s where s.intake_batch_id = b.id), '[]'::jsonb),
    'stock_movements', coalesce((select jsonb_agg(to_jsonb(m)) from public.stock_movements m join public.stock_items s on s.id = m.stock_item_id where s.intake_batch_id = b.id), '[]'::jsonb),
    'cash_transactions', coalesce((select jsonb_agg(to_jsonb(c)) from public.cash_transactions c where c.source_type = 'intake_batch' and c.source_id = b.id), '[]'::jsonb)
  );
  insert into public.intake_cancellations(organization_id, branch_id, intake_batch_id, reason, cancelled_by, cancelled_by_name, snapshot)
    values(b.organization_id, b.branch_id, b.id, btrim(_reason), auth.uid(), coalesce(v_name, 'Pemilik'), v_snapshot)
    returning id into v_id;
  delete from public.cash_transactions where source_type = 'intake_batch' and source_id = b.id;
  update public.intake_batches set amount_paid = 0 where id = b.id;
  -- Reuse the existing authoritative checks for sales, transfers, repairs,
  -- service consumption, warranties, changed branches and stock movements.
  -- An exception rolls back the ledger correction AND the cancellation log.
  perform private.manage_intake(b.id, true, null, null);
  return v_id;
end;
$$;
revoke all on function private.cancel_wrong_intake(uuid,text,boolean) from public, anon;
grant execute on function private.cancel_wrong_intake(uuid,text,boolean) to authenticated;

create function public.cancel_wrong_intake(_id uuid, _reason text, _payment_was_input_error boolean)
returns uuid language sql security invoker set search_path = '' as $$
  select private.cancel_wrong_intake(_id, _reason, _payment_was_input_error);
$$;
revoke all on function public.cancel_wrong_intake(uuid,text,boolean) from public, anon;
grant execute on function public.cancel_wrong_intake(uuid,text,boolean) to authenticated;

commit;
