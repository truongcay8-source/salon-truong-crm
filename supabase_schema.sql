-- CRM Salon Truong - PostgreSQL / Supabase production security baseline
-- Muc tieu: khong tin vao UI. Moi quyen doc/ghi duoc chan bang Row Level Security (RLS).

create type public.app_role as enum ('OWNER','MANAGER','STAFF','RECEPTION');
create type public.account_status as enum ('PENDING','ACTIVE','SUSPENDED');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  role public.app_role,
  status public.account_status not null default 'PENDING',
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id)
);

create table public.customers (
  id bigint generated always as identity primary key,
  full_name text not null,
  phone text not null unique,
  source text,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.bookings (
  id bigint generated always as identity primary key,
  customer_id bigint not null references public.customers(id),
  staff_id uuid references public.profiles(id),
  starts_at timestamptz not null,
  service_name text not null,
  status text not null default 'CONFIRMED',
  quoted_price numeric(14,2) not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.hair_records (
  id bigint generated always as identity primary key,
  customer_id bigint not null references public.customers(id),
  staff_id uuid references public.profiles(id),
  service_name text,
  formula text,
  hair_condition text,
  next_note text,
  created_at timestamptz not null default now()
);

create table public.invoices (
  id bigint generated always as identity primary key,
  customer_id bigint references public.customers(id),
  total_amount numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.commissions (
  id bigint generated always as identity primary key,
  staff_id uuid not null references public.profiles(id),
  period_start date not null,
  period_end date not null,
  service_commission numeric(14,2) not null default 0,
  product_commission numeric(14,2) not null default 0,
  bonus numeric(14,2) not null default 0,
  adjustment numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

-- Helper functions. SECURITY DEFINER de tranh policy recursion tren profiles.
create or replace function public.app_current_role()
returns public.app_role
language sql stable security definer set search_path=public
as $$ select role from public.profiles where id = auth.uid() and status='ACTIVE' $$;

create or replace function public.is_active_user()
returns boolean
language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles where id=auth.uid() and status='ACTIVE') $$;

create or replace function public.is_management()
returns boolean
language sql stable security definer set search_path=public
as $$ select public.app_current_role() in ('OWNER','MANAGER') $$;

revoke all on function public.app_current_role() from public;
revoke all on function public.is_active_user() from public;
revoke all on function public.is_management() from public;
grant execute on function public.app_current_role(), public.is_active_user(), public.is_management() to authenticated;

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.bookings enable row level security;
alter table public.hair_records enable row level security;
alter table public.invoices enable row level security;
alter table public.commissions enable row level security;

-- PROFILES: pending user chi doc duoc ho so cua chinh minh. Management doc duoc danh sach.
create policy profiles_select_self_or_management on public.profiles
for select to authenticated
using (id=auth.uid() or public.is_management());

-- Khong cho client tu cap role/status bang UPDATE truc tiep.
-- Cho phep user sua ten/phone qua RPC rieng neu can; o baseline nay direct update bi chan.

-- CUSTOMERS: tat ca tai khoan ACTIVE co the xem/tao/sua khach de phuc vu.
create policy customers_select_active on public.customers
for select to authenticated using (public.is_active_user());
create policy customers_insert_active on public.customers
for insert to authenticated with check (public.is_active_user());
create policy customers_update_active on public.customers
for update to authenticated using (public.is_active_user()) with check (public.is_active_user());
-- Delete customer: chi OWNER. Khuyen nghi soft-delete thay vi xoa that.
create policy customers_delete_owner on public.customers
for delete to authenticated using (public.app_current_role()='OWNER');

-- BOOKINGS + HAIR RECORDS: active staff can phuc vu khach.
create policy bookings_all_active_select on public.bookings for select to authenticated using (public.is_active_user());
create policy bookings_all_active_insert on public.bookings for insert to authenticated with check (public.is_active_user());
create policy bookings_all_active_update on public.bookings for update to authenticated using (public.is_active_user()) with check (public.is_active_user());
create policy hair_select_active on public.hair_records for select to authenticated using (public.is_active_user());
create policy hair_insert_active on public.hair_records for insert to authenticated with check (public.is_active_user());
create policy hair_update_own_or_management on public.hair_records for update to authenticated using (staff_id=auth.uid() or public.is_management()) with check (staff_id=auth.uid() or public.is_management());

-- INVOICES / DOANH SO: chi OWNER + MANAGER duoc SELECT bao cao doanh so.
-- Le tan van co the tao hoa don/thu tien, nhung khong duoc query lai bang doanh thu.
create policy invoices_select_management on public.invoices
for select to authenticated using (public.is_management());
create policy invoices_insert_reception_or_management on public.invoices
for insert to authenticated with check (public.app_current_role() in ('OWNER','MANAGER','RECEPTION'));
create policy invoices_update_management on public.invoices
for update to authenticated using (public.is_management()) with check (public.is_management());

-- COMMISSION: OWNER/MANAGER xem tat ca; STAFF/RECEPTION chi xem dong cua chinh minh.
create policy commissions_select_scope on public.commissions
for select to authenticated
using (public.is_management() or staff_id=auth.uid());
create policy commissions_write_management on public.commissions
for all to authenticated
using (public.is_management())
with check (public.is_management());

-- Duyet tai khoan bang RPC, khong cap quyen UPDATE role/status cho client.
create or replace function public.approve_user(target_user uuid, new_role public.app_role)
returns void
language plpgsql security definer set search_path=public
as $$
declare actor_role public.app_role;
begin
  select role into actor_role from public.profiles where id=auth.uid() and status='ACTIVE';
  if actor_role not in ('OWNER','MANAGER') then raise exception 'Not allowed'; end if;
  if actor_role='MANAGER' and new_role in ('OWNER','MANAGER') then raise exception 'Manager cannot grant management roles'; end if;
  if new_role='OWNER' then raise exception 'OWNER role cannot be granted from client RPC'; end if;

  update public.profiles
  set role=new_role, status='ACTIVE', approved_at=now(), approved_by=auth.uid()
  where id=target_user and status='PENDING';
  if not found then raise exception 'Pending account not found'; end if;
end $$;
revoke all on function public.approve_user(uuid, public.app_role) from public;
grant execute on function public.approve_user(uuid, public.app_role) to authenticated;

-- Tao profile sau khi dang ky Auth. Luon PENDING, role NULL.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  insert into public.profiles(id,full_name,phone,status)
  values(new.id, coalesce(new.raw_user_meta_data->>'full_name','Chua cap nhat'), new.raw_user_meta_data->>'phone', 'PENDING');
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
