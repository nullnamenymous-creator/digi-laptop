-- Preserve stock receipt timestamps while adding the shared creation timestamp
-- used to order inventory across the application and sales RPC.
alter table public.stock_items
  add column if not exists created_at timestamptz;

update public.stock_items
set created_at = received_at
where created_at is null;

alter table public.stock_items
  alter column created_at set default now(),
  alter column created_at set not null;
