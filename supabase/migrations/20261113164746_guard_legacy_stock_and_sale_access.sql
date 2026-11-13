revoke execute on function public.receive_stock(uuid,uuid,text,jsonb), private.receive_stock(uuid,uuid,text,jsonb) from public,anon,authenticated;
create function private.check_sale_actor() returns trigger language plpgsql set search_path='' as $$
begin
 if (select auth.uid()) is not null and not private.can_operate_branch(new.branch_id) then
   raise exception 'Penjualan hanya dapat dicatat Pemilik atau Operator cabang.';
 end if;
 return new;
end $$;
create trigger check_sale_actor before insert on public.sales for each row execute function private.check_sale_actor();
