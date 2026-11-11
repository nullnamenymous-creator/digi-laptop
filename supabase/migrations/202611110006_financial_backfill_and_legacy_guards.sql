-- Seed cash receipts for pre-ledger sales, and close legacy direct RPC paths.
insert into public.cash_transactions(organization_id,branch_id,direction,category,amount,description,source_type,source_id,customer_id,created_by,created_at)
select s.organization_id,s.branch_id,'income','Penjualan historis',s.paid_amount,'Penerimaan penjualan '||s.receipt_number,'sale',s.id,s.customer_id,s.cashier_id,s.created_at
from public.sales s
where s.paid_amount > 0
  and not exists (select 1 from public.cash_transactions c where c.source_type='sale' and c.source_id=s.id);

revoke execute on function public.create_sale(uuid,text,text,text,jsonb) from public, anon, authenticated;
revoke execute on function private.create_sale(uuid,text,text,text,jsonb) from public, anon, authenticated;
revoke execute on function public.receive_stock_batch(uuid,uuid,text,integer) from public, anon, authenticated;
revoke execute on function private.receive_stock_batch(uuid,uuid,text,integer) from public, anon, authenticated;
