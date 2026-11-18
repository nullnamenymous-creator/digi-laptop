-- Master-only permission. Existing foreign keys continue blocking deletion of
-- products referenced by intake, stock, repairs, transfers, or sales.
-- No existing data, policies for other roles, or account/session rules change.
create policy central_admin_sparepart_delete
on public.products for delete to authenticated
using (
  category = 'Sparepart'
  and private.is_central_admin(organization_id)
);
