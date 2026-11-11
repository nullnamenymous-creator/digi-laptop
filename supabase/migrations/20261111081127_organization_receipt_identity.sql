alter table public.organizations add column if not exists phone text not null default '', add column if not exists address text not null default '';
