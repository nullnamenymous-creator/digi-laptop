create index if not exists stock_transfers_org_idx on public.stock_transfers(organization_id);
create index if not exists stock_transfers_created_by_idx on public.stock_transfers(created_by);
create index if not exists stock_transfers_received_by_idx on public.stock_transfers(received_by);
create index if not exists stock_transfer_items_org_idx on public.stock_transfer_items(organization_id);
create index if not exists stock_transfer_items_product_idx on public.stock_transfer_items(product_id);
create index if not exists stock_transfer_items_received_stock_idx on public.stock_transfer_items(received_stock_item_id);
