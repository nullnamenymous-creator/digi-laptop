-- Scope customer and supplier access to the authenticated user's organization.
-- Keep CRUD rights for owners/operators while avoiding duplicate permissive SELECT policies.

drop policy if exists suppliers_manage_operator on public.suppliers;
drop policy if exists suppliers_read_member on public.suppliers;
create policy suppliers_read_member on public.suppliers
  for select to authenticated
  using (
    private.is_org_member(suppliers.organization_id)
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.organization_id = suppliers.organization_id
        and p.role in ('owner', 'operator')
    )
  );
create policy suppliers_add_member on public.suppliers
  for insert to authenticated
  with check (
    private.is_owner(suppliers.organization_id)
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.organization_id = suppliers.organization_id
        and p.role = 'operator'
    )
  );
create policy suppliers_update_member on public.suppliers
  for update to authenticated
  using (
    private.is_owner(suppliers.organization_id)
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.organization_id = suppliers.organization_id
        and p.role = 'operator'
    )
  )
  with check (
    private.is_owner(suppliers.organization_id)
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.organization_id = suppliers.organization_id
        and p.role = 'operator'
    )
  );
create policy suppliers_delete_member on public.suppliers
  for delete to authenticated
  using (
    private.is_owner(suppliers.organization_id)
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.organization_id = suppliers.organization_id
        and p.role = 'operator'
    )
  );

drop policy if exists customers_manage_operator on public.customers;
drop policy if exists customers_read_member on public.customers;
create policy customers_read_member on public.customers
  for select to authenticated
  using (
    private.is_org_member(customers.organization_id)
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.organization_id = customers.organization_id
        and p.role in ('owner', 'operator')
    )
  );
create policy customers_add_member on public.customers
  for insert to authenticated
  with check (
    private.is_owner(customers.organization_id)
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.organization_id = customers.organization_id
        and p.role = 'operator'
    )
  );
create policy customers_update_member on public.customers
  for update to authenticated
  using (
    private.is_owner(customers.organization_id)
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.organization_id = customers.organization_id
        and p.role = 'operator'
    )
  )
  with check (
    private.is_owner(customers.organization_id)
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.organization_id = customers.organization_id
        and p.role = 'operator'
    )
  );
create policy customers_delete_member on public.customers
  for delete to authenticated
  using (
    private.is_owner(customers.organization_id)
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.organization_id = customers.organization_id
        and p.role = 'operator'
    )
  );
