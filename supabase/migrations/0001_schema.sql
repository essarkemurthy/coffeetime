-- ============================================================
-- CoffeeTime — Coffee Shop Management Platform
-- Migration 0001: Core schema (multi-tenant ready)
--
-- Every business table carries tenant_id + outlet_id so the
-- same schema can later serve many shop owners with multiple
-- outlets. Today we seed exactly ONE tenant and ONE outlet.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- Tenants & outlets ----------

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.outlets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  address text,
  gstin text,
  phone text,
  created_at timestamptz not null default now()
);

-- ---------- App users (linked to Supabase Auth) ----------

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id),
  outlet_id uuid not null references public.outlets(id),
  name text not null default '',
  role text not null default 'owner' check (role in ('owner', 'manager', 'cashier')),
  created_at timestamptz not null default now()
);

-- ---------- Menu ----------

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  outlet_id uuid not null references public.outlets(id),
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  outlet_id uuid not null references public.outlets(id),
  category_id uuid not null references public.categories(id),
  name text not null,
  -- Price is GST-INCLUSIVE: this is what the customer pays.
  price numeric(10, 2) not null check (price >= 0),
  gst_percent numeric(4, 2) not null default 0 check (gst_percent in (0, 5, 12, 18)),
  is_active boolean not null default true,
  image_url text,
  created_at timestamptz not null default now()
);

-- ---------- Inventory ----------

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  outlet_id uuid not null references public.outlets(id),
  name text not null,
  unit text not null check (unit in ('kg', 'g', 'L', 'ml', 'pcs', 'pkt')),
  current_stock numeric(12, 3) not null default 0,
  low_stock_threshold numeric(12, 3) not null default 0,
  cost_per_unit numeric(10, 2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  outlet_id uuid not null references public.outlets(id),
  ingredient_id uuid not null references public.ingredients(id),
  type text not null check (type in ('purchase', 'usage', 'adjustment', 'wastage')),
  -- Positive = stock in, negative = stock out.
  quantity numeric(12, 3) not null,
  note text,
  created_at timestamptz not null default now()
);

-- ---------- Vendors & purchases ----------

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  outlet_id uuid not null references public.outlets(id),
  name text not null,
  phone text,
  gstin text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  outlet_id uuid not null references public.outlets(id),
  vendor_id uuid not null references public.vendors(id),
  bill_number text,
  bill_date date not null default current_date,
  total_amount numeric(12, 2) not null default 0,
  status text not null default 'pending' check (status in ('paid', 'partial', 'pending')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  outlet_id uuid not null references public.outlets(id),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id),
  quantity numeric(12, 3) not null check (quantity > 0),
  rate numeric(10, 2) not null check (rate >= 0),
  amount numeric(12, 2) not null check (amount >= 0)
);

create table public.purchase_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  outlet_id uuid not null references public.outlets(id),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  payment_date date not null default current_date,
  mode text not null check (mode in ('cash', 'upi', 'bank')),
  created_at timestamptz not null default now()
);

-- ---------- Sales ----------

-- Daily bill number counters, one row per outlet per day.
create table public.bill_counters (
  outlet_id uuid not null references public.outlets(id),
  bill_date date not null,
  last_number int not null default 0,
  primary key (outlet_id, bill_date)
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  outlet_id uuid not null references public.outlets(id),
  -- Resets to 1 every day, per outlet. Unique within (outlet, day).
  bill_number int not null,
  sale_date date not null default current_date,
  subtotal numeric(12, 2) not null default 0,     -- pre-GST amount
  gst_amount numeric(12, 2) not null default 0,   -- GST portion
  discount numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,        -- what the customer paid
  payment_mode text not null check (payment_mode in ('cash', 'upi', 'card', 'mixed')),
  created_by uuid references public.users(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (outlet_id, sale_date, bill_number)
);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  outlet_id uuid not null references public.outlets(id),
  sale_id uuid not null references public.sales(id) on delete cascade,
  item_id uuid not null references public.items(id),
  -- Snapshots: editing the menu later never changes old bills.
  item_name text not null,
  quantity int not null check (quantity > 0),
  price numeric(10, 2) not null,        -- GST-inclusive unit price at time of sale
  gst_percent numeric(4, 2) not null,
  line_total numeric(12, 2) not null    -- price * quantity (GST-inclusive)
);

-- ---------- Expenses ----------

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  outlet_id uuid not null references public.outlets(id),
  category text not null check (category in ('rent', 'salary', 'electricity', 'maintenance', 'misc')),
  amount numeric(12, 2) not null check (amount > 0),
  expense_date date not null default current_date,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Helpful indexes ----------

create index idx_items_outlet on public.items(outlet_id, category_id);
create index idx_sales_outlet_date on public.sales(outlet_id, sale_date);
create index idx_sale_items_sale on public.sale_items(sale_id);
create index idx_stock_movements_ingredient on public.stock_movements(ingredient_id, created_at);
create index idx_purchases_vendor on public.purchases(vendor_id);
create index idx_expenses_outlet_date on public.expenses(outlet_id, expense_date);

-- ============================================================
-- Row Level Security: users may only touch rows of their tenant.
-- ============================================================

-- Helper: the tenant of the currently logged-in user.
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.users where id = auth.uid();
$$;

alter table public.tenants enable row level security;
alter table public.outlets enable row level security;
alter table public.users enable row level security;
alter table public.categories enable row level security;
alter table public.items enable row level security;
alter table public.ingredients enable row level security;
alter table public.stock_movements enable row level security;
alter table public.vendors enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.purchase_payments enable row level security;
alter table public.bill_counters enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.expenses enable row level security;

create policy tenants_select on public.tenants
  for select using (id = public.current_tenant_id());

create policy outlets_all on public.outlets
  for all using (tenant_id = public.current_tenant_id());

create policy users_select on public.users
  for select using (tenant_id = public.current_tenant_id() or id = auth.uid());

do $$
declare t text;
begin
  -- One uniform tenant policy for every business table.
  foreach t in array array[
    'categories', 'items', 'ingredients', 'stock_movements', 'vendors',
    'purchases', 'purchase_items', 'purchase_payments', 'sales',
    'sale_items', 'expenses'
  ]
  loop
    execute format(
      'create policy %I_tenant on public.%I for all
         using (tenant_id = public.current_tenant_id())
         with check (tenant_id = public.current_tenant_id());',
      t, t
    );
  end loop;
end $$;

-- bill_counters has no tenant_id; scope it through the outlet.
create policy bill_counters_tenant on public.bill_counters
  for all using (
    outlet_id in (select id from public.outlets where tenant_id = public.current_tenant_id())
  );

-- ============================================================
-- Auto-link new Auth users to the (single) seeded tenant/outlet.
-- When you later onboard more tenants, replace this trigger with
-- a proper invite flow — no schema change needed.
-- ============================================================

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_outlet uuid;
begin
  select id into v_tenant from public.tenants order by created_at limit 1;
  select id into v_outlet from public.outlets where tenant_id = v_tenant order by created_at limit 1;
  if v_tenant is not null and v_outlet is not null then
    insert into public.users (id, tenant_id, outlet_id, name, role)
    values (new.id, v_tenant, v_outlet, coalesce(new.email, ''), 'owner')
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
