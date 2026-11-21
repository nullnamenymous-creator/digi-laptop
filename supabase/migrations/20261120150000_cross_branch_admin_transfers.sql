begin;

-- Owner and central admin can review every inter-branch transfer in the organization.
drop policy if exists stock_transfers_read_member on public.stock_transfers;
create policy stock_transfers_read_member on public.stock_transfers
for select to authenticated
using (
  private.is_owner(organization_id)
  or private.is_central_admin(organization_id)
  or private.can_operate_branch(source_branch_id)
  or private.can_operate_branch(destination_branch_id)
);

drop policy if exists stock_transfer_items_read_member on public.stock_transfer_items;
create policy stock_transfer_items_read_member on public.stock_transfer_items
for select to authenticated
using (
  exists (
    select 1 from public.stock_transfers t
    where t.id = transfer_id
      and (
        private.is_owner(t.organization_id)
        or private.is_central_admin(t.organization_id)
        or private.can_operate_branch(t.source_branch_id)
        or private.can_operate_branch(t.destination_branch_id)
      )
  )
);

notify pgrst, 'reload schema';
commit;
