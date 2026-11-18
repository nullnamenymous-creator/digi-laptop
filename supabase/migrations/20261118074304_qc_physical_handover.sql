begin;

-- Existing available units remain available; only future QC approvals enter handover.
alter table public.stock_items drop constraint stock_items_status_check;
alter table public.stock_items add constraint stock_items_status_check check (
  status in ('pending_qc','repair_needed','repairing','waiting_parts','available',
    'not_sellable','scrap','sold','used_for_service','transferred','withdrawn',
    'reserved_online','awaiting_qc_handover')
);

create table public.qc_handovers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  branch_id uuid not null references public.branches(id),
  stock_item_id uuid references public.stock_items(id) on delete set null,
  intake_batch_id uuid,
  barcode text not null,
  product_name text not null,
  qc_at timestamptz not null,
  technician_name text not null,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_by_name text not null,
  accepted_at timestamptz not null default now(),
  note text not null default '',
  unique(stock_item_id, qc_at)
);
create index qc_handovers_branch_time_idx on public.qc_handovers(branch_id, accepted_at desc);
create table public.qc_handover_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  branch_id uuid not null references public.branches(id),
  stock_item_id uuid references public.stock_items(id) on delete set null,
  barcode text not null,
  qc_at timestamptz not null,
  note text not null check (length(btrim(note)) between 5 and 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text not null,
  created_at timestamptz not null default now()
);
create index qc_handover_notes_unit_idx on public.qc_handover_notes(stock_item_id, qc_at);
alter table public.qc_handovers enable row level security;
alter table public.qc_handover_notes enable row level security;
revoke all on public.qc_handovers, public.qc_handover_notes from public, anon, authenticated;
grant select on public.qc_handovers, public.qc_handover_notes to authenticated;
create policy qc_handovers_read on public.qc_handovers for select to authenticated
  using (private.is_owner(organization_id) or private.is_central_admin(organization_id));
create policy qc_handover_notes_read on public.qc_handover_notes for select to authenticated
  using (private.is_owner(organization_id) or private.is_central_admin(organization_id));

create function private.require_qc_physical_handover()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'pending_qc' and new.status = 'available' then
    if new.qc_at is null or new.qc_by is null then raise exception 'Hasil QC belum lengkap.'; end if;
    new.status := 'awaiting_qc_handover';
  elsif old.status = 'awaiting_qc_handover' and new.status = 'available' then
    if not exists(select 1 from public.qc_handovers h where h.stock_item_id = new.id
      and h.qc_at = new.qc_at and h.accepted_by = auth.uid()) then
      raise exception 'Unit harus diterima fisik melalui Serah terima hasil QC.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.require_qc_physical_handover() from public, anon, authenticated;
create trigger require_qc_physical_handover before update of status on public.stock_items
  for each row execute function private.require_qc_physical_handover();

create function private.accept_qc_handover(_barcode text, _confirmed boolean, _note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.stock_items%rowtype; v_org uuid; v_name text; v_product text; v_tech text; v_id uuid;
begin
  select organization_id,full_name into v_org,v_name from public.profiles
    where id=auth.uid() and role in ('owner','central_admin');
  if v_org is null then raise exception 'Hanya Pemilik dan Admin Pusat yang boleh menerima hasil QC.'; end if;
  if _confirmed is distinct from true then raise exception 'Konfirmasi bahwa barcode sesuai dan unit fisik sudah diterima.'; end if;
  if length(btrim(coalesce(_barcode,''))) not between 1 and 160 or length(coalesce(_note,'')) > 1000 then
    raise exception 'Barcode atau catatan tidak valid.';
  end if;
  select * into s from public.stock_items where organization_id=v_org and barcode=upper(btrim(_barcode)) for update;
  if not found then raise exception 'Barcode tidak ditemukan di toko ini. Pindai label unit yang benar.'; end if;
  if not private.is_central_branch(s.branch_id) then raise exception 'Unit ini tidak berada di Cabang Pusat.'; end if;
  select id into v_id from public.qc_handovers where stock_item_id=s.id and qc_at=s.qc_at;
  if v_id is not null then return jsonb_build_object('id',v_id,'already_received',true,'barcode',s.barcode); end if;
  if s.status <> 'awaiting_qc_handover' or s.quantity <> 1 or s.qc_at is null or s.qc_by is null then
    raise exception 'Barcode ini belum lolos QC atau tidak menunggu serah terima fisik.';
  end if;
  select name into v_product from public.products where id=s.product_id and organization_id=v_org and lower(category)='laptop';
  if not found then raise exception 'Pilih barcode satuan laptop hasil QC.'; end if;
  select full_name into v_tech from public.profiles where id=s.qc_by and organization_id=v_org;
  insert into public.qc_handovers(organization_id,branch_id,stock_item_id,intake_batch_id,barcode,product_name,qc_at,
    technician_name,accepted_by,accepted_by_name,note)
  values(v_org,s.branch_id,s.id,s.intake_batch_id,s.barcode,v_product,s.qc_at,coalesce(v_tech,'Tidak tercatat'),
    auth.uid(),coalesce(v_name,'Petugas'),btrim(coalesce(_note,''))) returning id into v_id;
  update public.stock_items set status='available' where id=s.id;
  return jsonb_build_object('id',v_id,'already_received',false,'barcode',s.barcode);
end;
$$;
revoke all on function private.accept_qc_handover(text,boolean,text) from public, anon;
grant execute on function private.accept_qc_handover(text,boolean,text) to authenticated;
create function public.accept_qc_handover(_barcode text,_confirmed boolean,_note text default '')
returns jsonb language sql security invoker set search_path='' as $$ select private.accept_qc_handover(_barcode,_confirmed,_note) $$;
revoke all on function public.accept_qc_handover(text,boolean,text) from public, anon;
grant execute on function public.accept_qc_handover(text,boolean,text) to authenticated;

create function private.note_qc_handover_issue(_unit_id uuid,_note text)
returns void language plpgsql security definer set search_path='' as $$
declare s public.stock_items%rowtype; v_org uuid; v_name text;
begin
  select organization_id,full_name into v_org,v_name from public.profiles where id=auth.uid() and role in ('owner','central_admin');
  if v_org is null then raise exception 'Hanya Pemilik dan Admin Pusat yang boleh mencatat selisih.'; end if;
  if length(btrim(coalesce(_note,''))) not between 5 and 1000 then raise exception 'Catatan wajib diisi, 5 sampai 1000 karakter.'; end if;
  select * into s from public.stock_items where id=_unit_id and organization_id=v_org for update;
  if not found or s.status <> 'awaiting_qc_handover' or not private.is_central_branch(s.branch_id) or s.qc_at is null then
    raise exception 'Unit tidak menunggu serah terima fisik di Pusat.';
  end if;
  insert into public.qc_handover_notes(organization_id,branch_id,stock_item_id,barcode,qc_at,note,created_by,created_by_name)
    values(v_org,s.branch_id,s.id,s.barcode,s.qc_at,btrim(_note),auth.uid(),coalesce(v_name,'Petugas'));
end;
$$;
revoke all on function private.note_qc_handover_issue(uuid,text) from public, anon;
grant execute on function private.note_qc_handover_issue(uuid,text) to authenticated;
create function public.note_qc_handover_issue(_unit_id uuid,_note text)
returns void language sql security invoker set search_path='' as $$ select private.note_qc_handover_issue(_unit_id,_note) $$;
revoke all on function public.note_qc_handover_issue(uuid,text) from public, anon;
grant execute on function public.note_qc_handover_issue(uuid,text) to authenticated;

do $$
begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.qc_handovers, public.qc_handover_notes;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
