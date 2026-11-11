-- Let an owner remove a team login while preserving the operational records
-- created by that user. Historical actor references become NULL.
alter table public.team_invites drop constraint if exists team_invites_created_by_fkey;
alter table public.team_invites add constraint team_invites_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete cascade;

alter table public.stock_items drop constraint if exists stock_items_created_by_fkey;
alter table public.stock_items add constraint stock_items_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;
alter table public.stock_items drop constraint if exists stock_items_qc_by_fkey;
alter table public.stock_items add constraint stock_items_qc_by_fkey
  foreign key (qc_by) references auth.users(id) on delete set null;
alter table public.stock_movements drop constraint if exists stock_movements_created_by_fkey;
alter table public.stock_movements add constraint stock_movements_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;
alter table public.sales drop constraint if exists sales_cashier_id_fkey;
alter table public.sales add constraint sales_cashier_id_fkey
  foreign key (cashier_id) references auth.users(id) on delete set null;
alter table public.service_tickets drop constraint if exists service_tickets_created_by_fkey;
alter table public.service_tickets add constraint service_tickets_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;
alter table public.service_parts drop constraint if exists service_parts_created_by_fkey;
alter table public.service_parts add constraint service_parts_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;
alter table public.intake_batches drop constraint if exists intake_batches_created_by_fkey;
alter table public.intake_batches add constraint intake_batches_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;
alter table public.stock_repairs drop constraint if exists stock_repairs_technician_id_fkey;
alter table public.stock_repairs add constraint stock_repairs_technician_id_fkey
  foreign key (technician_id) references auth.users(id) on delete set null;
alter table public.stock_repair_parts drop constraint if exists stock_repair_parts_created_by_fkey;
alter table public.stock_repair_parts add constraint stock_repair_parts_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;
alter table public.cash_transactions drop constraint if exists cash_transactions_created_by_fkey;
alter table public.cash_transactions add constraint cash_transactions_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;
