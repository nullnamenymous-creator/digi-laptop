CREATE OR REPLACE FUNCTION private.update_customer_service(_ticket_id uuid, _status text, _technician_note text, _estimated_cost numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_ticket public.service_tickets%rowtype;
  v_technician_name text;
begin
  select role, full_name into v_role, v_technician_name
  from public.profiles where id = v_uid;
  if v_role is null then raise exception 'Akun tidak ditemukan.'; end if;

  select * into v_ticket from public.service_tickets
  where id = _ticket_id for update;
  if not found then raise exception 'Tiket servis tidak ditemukan.'; end if;
  if _estimated_cost is null or _estimated_cost < 0 then
    raise exception 'Estimasi biaya tidak valid.';
  end if;

  if v_role = 'technician' then
    if not private.can_work_service_ticket(_ticket_id) then
      raise exception 'Tiket ini bukan antrean teknisi cabang lo.';
    end if;
    if _status is null or _status not in ('diagnosing','waiting_approval','waiting_parts','repairing','ready') then
      raise exception 'Status tersebut hanya dapat diubah oleh operator.';
    end if;
    if v_ticket.status in ('handed_over','cancelled') then
      raise exception 'Tiket yang sudah ditutup tidak dapat diubah.';
    end if;
    update public.service_tickets
    set status = _status,
        assigned_technician_id = coalesce(assigned_technician_id, v_uid),
        technician_name = v_technician_name,
        technician_note = left(btrim(coalesce(_technician_note,'')), 4000),
        estimated_cost = _estimated_cost,
        updated_at = now()
    where id = _ticket_id;
  elsif v_role in ('owner','operator') then
    if not private.can_operate_branch(v_ticket.branch_id) then
      raise exception 'Tiket servis tidak ditemukan untuk cabang ini.';
    end if;
    if _status <> 'cancelled' or v_ticket.status in ('handed_over','cancelled','ready') then
      raise exception 'Operator hanya dapat membatalkan tiket yang belum siap diserahkan.';
    end if;
    if exists (select 1 from public.service_parts where ticket_id = _ticket_id) then
      raise exception 'Tiket dengan sparepart terpakai tidak dapat dibatalkan.';
    end if;
    update public.service_tickets set status = 'cancelled', updated_at = now()
    where id = _ticket_id;
  else
    raise exception 'Role ini tidak dapat mengelola tiket servis pelanggan.';
  end if;
end;
$function$;
