alter table public.service_tickets add column if not exists paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0);
alter table public.service_tickets add column if not exists due_date date;
update public.service_tickets set paid_amount=final_cost where status='handed_over' and paid_amount=0;

insert into public.cash_transactions(organization_id,branch_id,direction,category,amount,description,source_type,source_id,created_by,created_at)
select t.organization_id,t.branch_id,'income','Penerimaan servis historis',t.paid_amount,'Penerimaan tiket servis '||t.ticket_number,'service_ticket',t.id,t.created_by,t.updated_at
from public.service_tickets t
where t.status='handed_over' and t.paid_amount>0
  and not exists(select 1 from public.cash_transactions c where c.source_type='service_ticket' and c.source_id=t.id);

create or replace function private.complete_service_handover(_ticket_id uuid,_final_cost numeric,_paid_amount numeric,_due_date date,_handover_photo_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid; v_branch uuid; v_number text; v_customer text;
begin
  select organization_id,branch_id,ticket_number,customer_name into v_org,v_branch,v_number,v_customer from public.service_tickets where id=_ticket_id for update;
  if v_org is null or not private.can_operate_branch(v_branch) then raise exception 'Tiket tidak ditemukan untuk cabang ini.'; end if;
  if _final_cost is null or _final_cost<0 or _paid_amount is null or _paid_amount<0 or _paid_amount>_final_cost then raise exception 'Biaya dan pembayaran servis tidak valid.'; end if;
  if _paid_amount<_final_cost and _due_date is null then raise exception 'Tanggal jatuh tempo wajib untuk piutang servis.'; end if;
  update public.service_tickets set status='handed_over',final_cost=_final_cost,paid_amount=_paid_amount,due_date=case when _paid_amount<_final_cost then _due_date else null end,handover_photo_path=coalesce(_handover_photo_path,''),updated_at=now() where id=_ticket_id;
  if _paid_amount>0 then insert into public.cash_transactions(organization_id,branch_id,direction,category,amount,description,source_type,source_id,created_by)
    values(v_org,v_branch,'income','Penerimaan servis',_paid_amount,'Pembayaran servis '||v_number||' · '||v_customer,'service_ticket',_ticket_id,v_uid); end if;
end;
$$;
revoke all on function private.complete_service_handover(uuid,numeric,numeric,date,text) from public,anon;
grant execute on function private.complete_service_handover(uuid,numeric,numeric,date,text) to authenticated;
create or replace function public.complete_service_handover(_ticket_id uuid,_final_cost numeric,_paid_amount numeric,_due_date date,_handover_photo_path text)
returns void language sql security invoker set search_path = '' as $$ select private.complete_service_handover(_ticket_id,_final_cost,_paid_amount,_due_date,_handover_photo_path) $$;
revoke all on function public.complete_service_handover(uuid,numeric,numeric,date,text) from public,anon;
grant execute on function public.complete_service_handover(uuid,numeric,numeric,date,text) to authenticated;

create or replace function private.record_party_payment(_source_type text,_source_id uuid,_amount numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid; v_branch uuid; v_total numeric; v_paid numeric; v_customer uuid; v_supplier uuid; v_direction text; v_category text; v_desc text;
begin
  select organization_id into v_org from public.profiles where id=v_uid and role in ('owner','operator');
  if v_org is null or _amount is null or _amount <= 0 then raise exception 'Pembayaran tidak valid.'; end if;
  if _source_type='sale' then
    select branch_id,total,paid_amount,customer_id into v_branch,v_total,v_paid,v_customer from public.sales where id=_source_id and organization_id=v_org for update;
    v_direction:='income'; v_category:='Penerimaan piutang penjualan'; v_desc:='Pembayaran piutang pelanggan';
  elsif _source_type='service_ticket' then
    select branch_id,final_cost,paid_amount into v_branch,v_total,v_paid from public.service_tickets where id=_source_id and organization_id=v_org and status='handed_over' for update;
    v_direction:='income'; v_category:='Penerimaan piutang servis'; v_desc:='Pembayaran piutang servis';
  elsif _source_type='intake_batch' then
    select branch_id,total_amount,amount_paid,supplier_id into v_branch,v_total,v_paid,v_supplier from public.intake_batches where id=_source_id and organization_id=v_org for update;
    v_direction:='expense'; v_category:='Pembayaran hutang supplier'; v_desc:='Pembayaran hutang pembelian';
  else raise exception 'Jenis tagihan tidak dikenal.'; end if;
  if v_branch is null or not private.can_operate_branch(v_branch) then raise exception 'Tagihan tidak ditemukan di cabang ini.'; end if;
  if _amount > v_total-v_paid then raise exception 'Pembayaran melebihi sisa tagihan.'; end if;
  if _source_type='sale' then update public.sales set paid_amount=paid_amount+_amount,due_date=case when paid_amount+_amount>=total then null else due_date end where id=_source_id;
  elsif _source_type='service_ticket' then update public.service_tickets set paid_amount=paid_amount+_amount,due_date=case when paid_amount+_amount>=final_cost then null else due_date end,updated_at=now() where id=_source_id;
  else update public.intake_batches set amount_paid=amount_paid+_amount,due_date=case when amount_paid+_amount>=total_amount then null else due_date end where id=_source_id; end if;
  insert into public.cash_transactions(organization_id,branch_id,direction,category,amount,description,source_type,source_id,customer_id,supplier_id,created_by)
  values(v_org,v_branch,v_direction,v_category,_amount,v_desc,_source_type,_source_id,v_customer,v_supplier,v_uid);
end;
$$;

