-- Restore per-unit acquisition cost from the historical supplier batch ledger.
update public.stock_items si
set acquisition_cost=ib.unit_cost
from public.intake_batches ib
where si.intake_batch_id=ib.id and si.acquisition_cost=0 and ib.unit_cost>0;
