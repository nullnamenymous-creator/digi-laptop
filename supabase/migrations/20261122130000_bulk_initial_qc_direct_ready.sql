begin;

create or replace function private.require_qc_physical_handover()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'pending_qc' and new.status = 'available' then
    -- Admin Pusat already has the new bulk unit in hand during its initial QC.
    -- Only the post-repair final QC needs a separate technician handover.
    if new.qc_stage = 'initial' and exists (
      select 1 from public.intake_batches b
      where b.id = new.intake_batch_id and b.bulk_laptop_intake
    ) then
      return new;
    end if;
    if new.qc_at is null or new.qc_by is null then
      raise exception 'Hasil QC belum lengkap.';
    end if;
    new.status := 'awaiting_qc_handover';
  elsif old.status = 'awaiting_qc_handover' and new.status = 'available' then
    if new.qc_stage = 'initial' and exists (
      select 1 from public.intake_batches b
      where b.id = new.intake_batch_id and b.bulk_laptop_intake
    ) then
      return new;
    end if;
    if not exists (
      select 1 from public.qc_handovers h
      where h.stock_item_id = new.id and h.qc_at = new.qc_at
        and h.accepted_by = auth.uid()
    ) then
      raise exception 'Unit harus diterima fisik melalui Serah terima hasil QC.';
    end if;
  end if;
  return new;
end;
$$;

-- Release already-passed initial bulk QC units that were incorrectly held for
-- technician handover. Their barcode, QC notes, and modal remain unchanged.
update public.stock_items s
set status = 'available'
where s.status = 'awaiting_qc_handover'
  and s.qc_stage = 'initial'
  and exists (
    select 1 from public.intake_batches b
    where b.id = s.intake_batch_id and b.bulk_laptop_intake
  );

notify pgrst, 'reload schema';

commit;
