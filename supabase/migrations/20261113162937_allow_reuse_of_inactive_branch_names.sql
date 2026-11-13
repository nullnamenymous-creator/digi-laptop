create unique index branches_active_organization_name_key on public.branches (organization_id, name) where is_active;
alter table public.branches drop constraint branches_organization_id_name_key;
