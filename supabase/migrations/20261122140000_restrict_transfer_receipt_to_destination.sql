begin;

create or replace function private.check_stock_transfer_receiver()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
begin
  if old.status = 'in_transit' and new.status = 'received' then
    select p.role into v_role from public.profiles p
    where p.id = auth.uid() and p.organization_id = new.organization_id;

    if private.is_owner(new.organization_id) then
      return new;
    end if;
    if v_role = 'operator' and private.can_operate_branch(new.destination_branch_id) then
      return new;
    end if;
    if v_role = 'central_admin' and private.is_central_branch(new.destination_branch_id)
      and private.can_access_branch(new.destination_branch_id) then
      return new;
    end if;
    raise exception 'Penerimaan fisik harus dikonfirmasi kasir cabang tujuan atau Pemilik.';
  end if;
  return new;
end;
$$;
revoke all on function private.check_stock_transfer_receiver() from public, anon, authenticated;

drop trigger if exists check_stock_transfer_receiver on public.stock_transfers;
create trigger check_stock_transfer_receiver
before update of status on public.stock_transfers
for each row execute function private.check_stock_transfer_receiver();

notify pgrst, 'reload schema';

commit;
