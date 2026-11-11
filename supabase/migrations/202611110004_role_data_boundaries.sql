create or replace function private.can_operate_branch(_branch_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('owner','operator')
      and (p.role = 'owner' or p.branch_id = _branch_id)
  )
$$;
revoke all on function private.can_operate_branch(uuid) from public, anon;
grant execute on function private.can_operate_branch(uuid) to authenticated;

drop policy if exists sales_read_branch on public.sales;
create policy sales_read_branch on public.sales for select to authenticated using (private.can_operate_branch(branch_id));
drop policy if exists sale_items_read_branch on public.sale_items;
create policy sale_items_read_branch on public.sale_items for select to authenticated using (exists (select 1 from public.sales s where s.id = sale_id and private.can_operate_branch(s.branch_id)));
drop policy if exists services_read_branch on public.service_tickets;
create policy services_read_branch on public.service_tickets for select to authenticated using (private.can_operate_branch(branch_id));
drop policy if exists services_add_branch on public.service_tickets;
create policy services_add_branch on public.service_tickets for insert to authenticated with check (private.can_operate_branch(branch_id) and private.is_org_member(organization_id));
drop policy if exists services_update_branch on public.service_tickets;
create policy services_update_branch on public.service_tickets for update to authenticated using (private.can_operate_branch(branch_id)) with check (private.can_operate_branch(branch_id));
drop policy if exists service_parts_read_branch on public.service_parts;
create policy service_parts_read_branch on public.service_parts for select to authenticated using (exists (select 1 from public.service_tickets t where t.id = ticket_id and private.can_operate_branch(t.branch_id)));

create or replace function private.require_operator_for_sale()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_operate_branch(new.branch_id) then raise exception 'Hanya pemilik atau operator cabang yang dapat membuat transaksi.'; end if;
  return new;
end;
$$;
revoke all on function private.require_operator_for_sale() from public, anon, authenticated;
drop trigger if exists require_operator_for_sale on public.sales;
create trigger require_operator_for_sale before insert on public.sales for each row execute function private.require_operator_for_sale();

create or replace function private.require_operator_for_service_part()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_branch_id uuid;
begin
  select branch_id into v_branch_id from public.service_tickets where id = new.ticket_id;
  if v_branch_id is null or not private.can_operate_branch(v_branch_id) then raise exception 'Hanya pemilik atau operator cabang yang dapat memakai sparepart untuk servis pelanggan.'; end if;
  return new;
end;
$$;
revoke all on function private.require_operator_for_service_part() from public, anon, authenticated;
drop trigger if exists require_operator_for_service_part on public.service_parts;
create trigger require_operator_for_service_part before insert on public.service_parts for each row execute function private.require_operator_for_service_part();
