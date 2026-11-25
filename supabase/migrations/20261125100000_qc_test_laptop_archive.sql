begin;

alter table public.stock_items
  add column if not exists test_archive_id uuid,
  add column if not exists test_archived_at timestamptz,
  add column if not exists test_archived_from_status text,
  add column if not exists test_archived_from_qc_stage text,
  add column if not exists test_archive_reason text;

create table if not exists public.qc_test_archive_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  branch_id uuid not null references public.branches(id),
  stock_item_id uuid references public.stock_items(id) on delete set null,
  barcode text not null,
  product_name text not null,
  intake_batch_id uuid,
  status_before text not null,
  qc_stage_before text not null,
  reason text not null check (length(btrim(reason)) between 10 and 500),
  archived_by uuid references auth.users(id) on delete set null,
  archived_by_name text not null,
  archived_at timestamptz not null default now(),
  restored_by uuid references auth.users(id) on delete set null,
  restored_by_name text,
  restored_at timestamptz,
  restore_reason text
);
create index if not exists qc_test_archive_branch_time_idx on public.qc_test_archive_log(branch_id, archived_at desc);
alter table public.qc_test_archive_log enable row level security;
revoke all on public.qc_test_archive_log from public, anon, authenticated;
grant select on public.qc_test_archive_log to authenticated;
create policy qc_test_archive_read on public.qc_test_archive_log for select to authenticated
  using (private.is_owner(organization_id) or private.can_administer_active_branch(branch_id));

create function private.archive_test_laptop(_stock_item_id uuid,_reason text,_confirmed boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.stock_items%rowtype; org uuid; actor_name text; product_name text; archive_id uuid; clean_reason text:=btrim(coalesce(_reason,''));
begin
  if _confirmed is distinct from true or length(clean_reason) not between 10 and 500 then
    raise exception 'Konfirmasi unit uji coba dan isi alasan arsip minimal 10 karakter.';
  end if;
  select * into s from public.stock_items where id=_stock_item_id for update;
  if not found then raise exception 'Unit tidak ditemukan.'; end if;
  select p.organization_id,p.full_name into org,actor_name from public.profiles p
    where p.id=auth.uid() and p.organization_id=s.organization_id and p.role in ('owner','central_admin');
  if org is null or not private.is_central_branch(s.branch_id)
    or (not private.is_owner(org) and not private.can_administer_active_branch(s.branch_id)) then
    raise exception 'Hanya Pemilik atau Admin Pusat pada Cabang Pusat yang dapat mengarsipkan unit.';
  end if;
  if s.intake_batch_id is null or s.quantity<>1 or s.test_archive_id is not null
    or s.status not in ('pending_qc','waiting_parts','repair_needed','repairing','awaiting_qc_handover','available','not_sellable','scrap') then
    raise exception 'Unit ini bukan laptop penerimaan yang dapat diarsipkan.';
  end if;
  if exists(select 1 from public.sale_items x where x.stock_item_id=s.id)
    or exists(select 1 from public.stock_transfer_items x where x.source_stock_item_id=s.id or x.received_stock_item_id=s.id)
    or exists(select 1 from public.warranty_claims x where x.stock_item_id=s.id) then
    raise exception 'Unit sudah terjual, dimutasi, atau memiliki klaim garansi sehingga tidak dapat diarsipkan.';
  end if;
  select p.name into product_name from public.products p where p.id=s.product_id and p.organization_id=s.organization_id and lower(p.category)='laptop';
  if not found then raise exception 'Arsip uji coba hanya berlaku untuk unit laptop.'; end if;
  insert into public.qc_test_archive_log(organization_id,branch_id,stock_item_id,barcode,product_name,intake_batch_id,status_before,qc_stage_before,reason,archived_by,archived_by_name)
    values(s.organization_id,s.branch_id,s.id,s.barcode,product_name,s.intake_batch_id,s.status,s.qc_stage,clean_reason,auth.uid(),coalesce(actor_name,'Admin Pusat'))
    returning id into archive_id;
  update public.stock_repairs set status='not_sellable',resolution=concat_ws(E'\n',nullif(resolution,''),'Diarsipkan sebagai data uji coba: '||clean_reason),technician_id=auth.uid(),updated_at=now()
    where stock_item_id=s.id and status in ('repair_needed','repairing','waiting_parts','pending_final_qc');
  update public.stock_items set status='withdrawn',quantity=0,test_archive_id=archive_id,test_archived_at=now(),
    test_archived_from_status=s.status,test_archived_from_qc_stage=s.qc_stage,test_archive_reason=clean_reason where id=s.id;
  insert into public.stock_movements(organization_id,branch_id,product_id,stock_item_id,movement_type,quantity,reference,note,created_by)
    values(s.organization_id,s.branch_id,s.product_id,s.id,'adjustment',-1,'TEST-ARCHIVE-'||s.barcode,clean_reason,auth.uid());
  return archive_id;
end;
$$;
revoke all on function private.archive_test_laptop(uuid,text,boolean) from public,anon;
grant execute on function private.archive_test_laptop(uuid,text,boolean) to authenticated;
create function public.archive_test_laptop(_stock_item_id uuid,_reason text,_confirmed boolean)
returns uuid language sql security invoker set search_path='' as $$ select private.archive_test_laptop(_stock_item_id,_reason,_confirmed) $$;
revoke all on function public.archive_test_laptop(uuid,text,boolean) from public,anon;
grant execute on function public.archive_test_laptop(uuid,text,boolean) to authenticated;

create function private.restore_test_laptop(_archive_id uuid,_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare a public.qc_test_archive_log%rowtype; s public.stock_items%rowtype; actor_name text; next_stage text;
begin
  if length(btrim(coalesce(_reason,''))) not between 5 and 500 then raise exception 'Alasan pemulihan wajib diisi, minimal 5 karakter.'; end if;
  select * into a from public.qc_test_archive_log where id=_archive_id for update;
  if not found or a.restored_at is not null then raise exception 'Arsip tidak ditemukan atau sudah dipulihkan.'; end if;
  select p.full_name into actor_name from public.profiles p where p.id=auth.uid() and p.organization_id=a.organization_id and p.role in ('owner','central_admin');
  if actor_name is null or (not private.is_owner(a.organization_id) and not private.can_administer_active_branch(a.branch_id)) then raise exception 'Hanya Pemilik atau Admin Pusat yang dapat memulihkan arsip.'; end if;
  select * into s from public.stock_items where id=a.stock_item_id and organization_id=a.organization_id for update;
  if not found or s.status<>'withdrawn' or s.test_archive_id<>a.id then raise exception 'Status unit berubah; periksa riwayat unit sebelum memulihkan.'; end if;
  next_stage:=case when a.status_before='pending_qc' then a.qc_stage_before else 'final' end;
  update public.stock_items set status='pending_qc',quantity=1,qc_stage=next_stage,qc_at=null,qc_by=null,qc_notes='',
    test_archive_id=null,test_archived_at=null,test_archived_from_status=null,test_archived_from_qc_stage=null,test_archive_reason=null where id=s.id;
  update public.qc_test_archive_log set restored_by=auth.uid(),restored_by_name=coalesce(actor_name,'Admin Pusat'),restored_at=now(),restore_reason=btrim(_reason) where id=a.id;
  insert into public.stock_movements(organization_id,branch_id,product_id,stock_item_id,movement_type,quantity,reference,note,created_by)
    values(s.organization_id,s.branch_id,s.product_id,s.id,'adjustment',1,'TEST-RESTORE-'||s.barcode,btrim(_reason),auth.uid());
end;
$$;
revoke all on function private.restore_test_laptop(uuid,text) from public,anon;
grant execute on function private.restore_test_laptop(uuid,text) to authenticated;
create function public.restore_test_laptop(_archive_id uuid,_reason text)
returns void language sql security invoker set search_path='' as $$ select private.restore_test_laptop(_archive_id,_reason) $$;
revoke all on function public.restore_test_laptop(uuid,text) from public,anon;
grant execute on function public.restore_test_laptop(uuid,text) to authenticated;

notify pgrst,'reload schema';
commit;
