-- ============================================================
-- Migration 0004: Platform onboarding — invites, client
-- provisioning, and role enforcement.
--
-- After this migration the app works as a PLATFORM:
--   * New logins are attached to a shop ONLY if their email was
--     invited (the old "first login owns the shop" trigger is
--     replaced). Uninvited logins see a "no access" screen.
--   * You (the platform operator) onboard a new client by running
--     select public.provision_client('Shop Name', 'owner@email');
--     in the Supabase SQL Editor.
--   * Roles now mean something: cashiers can only bill and view
--     sales; managers run the shop; owners also manage staff.
--   * A client can be switched off (tenants.is_active = false)
--     without deleting any data.
--
-- Safe to run on an EXISTING deployment: no data is changed and
-- already-linked users keep working exactly as before.
-- ============================================================

-- ---------- Kill switches ----------

alter table public.tenants add column if not exists is_active boolean not null default true;
alter table public.users   add column if not exists is_active boolean not null default true;

-- ---------- Invites ----------

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  outlet_id uuid not null references public.outlets(id),
  email text not null check (email = lower(email)),
  role text not null default 'cashier' check (role in ('owner', 'manager', 'cashier')),
  is_active boolean not null default true,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

-- One pending invite per email at a time, so a login always
-- resolves to exactly one shop.
create unique index idx_invites_pending_email
  on public.invites(email) where is_active and accepted_at is null;

alter table public.invites enable row level security;

-- ---------- Helpers: who is asking, and are they allowed in? ----------

-- The tenant of the logged-in user — but ONLY while both the user
-- and their tenant are active. Every RLS policy hangs off this, so
-- flipping either is_active flag instantly locks the account out.
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.tenant_id
  from public.users u
  join public.tenants t on t.id = u.tenant_id and t.is_active
  where u.id = auth.uid() and u.is_active;
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.role
  from public.users u
  join public.tenants t on t.id = u.tenant_id and t.is_active
  where u.id = auth.uid() and u.is_active;
$$;

-- Row of the logged-in user; raises if not logged in, deactivated,
-- or the tenant is switched off. Used by the business RPCs.
create or replace function public.get_active_user()
returns public.users
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.users%rowtype;
begin
  select u.* into v
  from public.users u
  join public.tenants t on t.id = u.tenant_id and t.is_active
  where u.id = auth.uid() and u.is_active;
  if v.id is null then
    raise exception 'Not logged in or account inactive';
  end if;
  return v;
end;
$$;

-- ---------- Invite-based signup ----------

-- Attach a user to the shop that invited their email (latest
-- pending invite wins). Returns true if an invite was claimed.
create or replace function public.claim_invite_for(p_user_id uuid, p_email text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invites%rowtype;
begin
  if p_user_id is null or p_email is null then
    return false;
  end if;
  if exists (select 1 from public.users where id = p_user_id) then
    return false;  -- already linked to a shop
  end if;

  select i.* into v_inv
  from public.invites i
  join public.tenants t on t.id = i.tenant_id and t.is_active
  where i.email = lower(p_email) and i.is_active and i.accepted_at is null
  order by i.created_at desc
  limit 1;
  if v_inv.id is null then
    return false;
  end if;

  insert into public.users (id, tenant_id, outlet_id, name, role)
  values (p_user_id, v_inv.tenant_id, v_inv.outlet_id, lower(p_email), v_inv.role)
  on conflict (id) do nothing;

  update public.invites set accepted_at = now() where id = v_inv.id;
  return true;
end;
$$;

revoke all on function public.claim_invite_for(uuid, text) from public, anon, authenticated;

-- Called by the app when a logged-in user has no shop yet — covers
-- invites created AFTER the person's first login.
create or replace function public.claim_invite()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.claim_invite_for(
    auth.uid(),
    (select email from auth.users where id = auth.uid())
  );
end;
$$;

revoke all on function public.claim_invite() from public, anon;
grant execute on function public.claim_invite() to authenticated;

-- REPLACES the Milestone-1 auto-link trigger function: new auth
-- users are now attached only via invites. (The trigger
-- on_auth_user_created from 0001 keeps pointing here.)
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.claim_invite_for(new.id, new.email);
  return new;
end;
$$;

-- ---------- Client provisioning (platform operator only) ----------

-- Creates a new client: tenant + outlet + starter categories + an
-- owner invite for their email. Run it from the Supabase SQL
-- Editor; regular app users cannot call it.
create or replace function public.provision_client(
  p_shop_name text,
  p_owner_email text,
  p_outlet_name text default null,
  p_address text default null,
  p_gstin text default null,
  p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_outlet_id uuid;
begin
  if coalesce(trim(p_shop_name), '') = '' or coalesce(trim(p_owner_email), '') = '' then
    raise exception 'Shop name and owner email are required';
  end if;

  insert into public.tenants (name) values (trim(p_shop_name))
  returning id into v_tenant_id;

  insert into public.outlets (tenant_id, name, address, gstin, phone)
  values (v_tenant_id, coalesce(nullif(trim(p_outlet_name), ''), trim(p_shop_name)),
          p_address, p_gstin, p_phone)
  returning id into v_outlet_id;

  insert into public.categories (tenant_id, outlet_id, name, sort_order) values
    (v_tenant_id, v_outlet_id, 'Coffee', 1),
    (v_tenant_id, v_outlet_id, 'Tea', 2),
    (v_tenant_id, v_outlet_id, 'Breads', 3),
    (v_tenant_id, v_outlet_id, 'Biscuits', 4),
    (v_tenant_id, v_outlet_id, 'Cakes', 5),
    (v_tenant_id, v_outlet_id, 'Snacks', 6);

  insert into public.invites (tenant_id, outlet_id, email, role)
  values (v_tenant_id, v_outlet_id, lower(trim(p_owner_email)), 'owner');

  return jsonb_build_object(
    'tenant_id', v_tenant_id,
    'outlet_id', v_outlet_id,
    'owner_email', lower(trim(p_owner_email)),
    'message', 'Client created. Ask the owner to log in with this email.'
  );
end;
$$;

revoke all on function public.provision_client(text, text, text, text, text, text)
  from public, anon, authenticated;

-- ---------- Role-based RLS ----------
-- Replace the uniform "any tenant user may do anything" policies:
--   * cashiers: read the menu, bill, and view sales — nothing else;
--   * managers & owners: everything;
--   * money/procurement tables are hidden from cashiers entirely.
-- (Sales are still WRITTEN via the create_sale RPC, which runs as
-- definer — the direct-write policies below cover manual edits.)

do $$
declare t text;
begin
  foreach t in array array[
    'categories', 'items', 'ingredients', 'stock_movements', 'vendors',
    'purchases', 'purchase_items', 'purchase_payments', 'sales',
    'sale_items', 'expenses'
  ]
  loop
    execute format('drop policy if exists %I_tenant on public.%I;', t, t);
  end loop;

  -- Read for every role, write for owner/manager.
  foreach t in array array[
    'categories', 'items', 'ingredients', 'stock_movements', 'sales', 'sale_items'
  ]
  loop
    execute format(
      'create policy %I_select on public.%I for select
         using (tenant_id = public.current_tenant_id());', t, t);
    execute format(
      'create policy %I_insert on public.%I for insert
         with check (tenant_id = public.current_tenant_id()
                     and public.current_user_role() in (''owner'', ''manager''));', t, t);
    execute format(
      'create policy %I_update on public.%I for update
         using (tenant_id = public.current_tenant_id()
                and public.current_user_role() in (''owner'', ''manager''))
         with check (tenant_id = public.current_tenant_id()
                     and public.current_user_role() in (''owner'', ''manager''));', t, t);
    execute format(
      'create policy %I_delete on public.%I for delete
         using (tenant_id = public.current_tenant_id()
                and public.current_user_role() in (''owner'', ''manager''));', t, t);
  end loop;

  -- Owner/manager only (cashiers cannot even read these).
  foreach t in array array[
    'vendors', 'purchases', 'purchase_items', 'purchase_payments', 'expenses'
  ]
  loop
    execute format(
      'create policy %I_mgr on public.%I for all
         using (tenant_id = public.current_tenant_id()
                and public.current_user_role() in (''owner'', ''manager''))
         with check (tenant_id = public.current_tenant_id()
                     and public.current_user_role() in (''owner'', ''manager''));', t, t);
  end loop;
end $$;

-- Outlets: everyone reads (bill headers need the shop name);
-- owner/manager edit.
drop policy if exists outlets_all on public.outlets;
create policy outlets_select on public.outlets
  for select using (tenant_id = public.current_tenant_id());
create policy outlets_write on public.outlets
  for all using (tenant_id = public.current_tenant_id()
                 and public.current_user_role() in ('owner', 'manager'))
  with check (tenant_id = public.current_tenant_id()
              and public.current_user_role() in ('owner', 'manager'));

-- Owners manage their staff (change role, deactivate) — never
-- their own row, so an owner cannot lock themselves out.
create policy users_owner_update on public.users
  for update using (tenant_id = public.current_tenant_id()
                    and public.current_user_role() = 'owner'
                    and id <> auth.uid())
  with check (tenant_id = public.current_tenant_id());

-- Owners manage their shop's invites.
create policy invites_owner on public.invites
  for all using (tenant_id = public.current_tenant_id()
                 and public.current_user_role() = 'owner')
  with check (tenant_id = public.current_tenant_id()
              and public.current_user_role() = 'owner');

-- ---------- Role guards inside the business RPCs ----------
-- RLS does not apply inside security-definer functions, so the
-- role checks are repeated here. Cashiers may bill (create_sale);
-- stock, purchases and payments need owner/manager.

create or replace function public.create_sale(
  p_items jsonb,
  p_discount numeric default 0,
  p_payment_mode text default 'cash'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
  v_sale_id uuid := gen_random_uuid();
  v_bill_no int;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_line jsonb;
  v_item public.items%rowtype;
  v_qty int;
  v_line_total numeric := 0;
  v_base numeric;
  v_gross numeric := 0;      -- sum of GST-inclusive line totals
  v_subtotal numeric := 0;   -- pre-GST
  v_gst numeric := 0;
begin
  v_user := public.get_active_user();
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;
  if p_payment_mode not in ('cash', 'upi', 'card', 'mixed') then
    raise exception 'Invalid payment mode';
  end if;

  -- Next bill number for this outlet today (atomic upsert).
  insert into public.bill_counters (outlet_id, bill_date, last_number)
  values (v_user.outlet_id, v_today, 1)
  on conflict (outlet_id, bill_date)
  do update set last_number = public.bill_counters.last_number + 1
  returning last_number into v_bill_no;

  insert into public.sales (id, tenant_id, outlet_id, bill_number, sale_date,
                            subtotal, gst_amount, discount, total, payment_mode, created_by)
  values (v_sale_id, v_user.tenant_id, v_user.outlet_id, v_bill_no, v_today,
          0, 0, coalesce(p_discount, 0), 0, p_payment_mode, v_user.id);

  for v_line in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_line->>'quantity')::int;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Invalid quantity';
    end if;

    select * into v_item from public.items
    where id = (v_line->>'item_id')::uuid
      and tenant_id = v_user.tenant_id and is_active = true;
    if v_item.id is null then
      raise exception 'Item not found or inactive';
    end if;

    v_line_total := round(v_item.price * v_qty, 2);
    -- Back out the GST portion from the inclusive price.
    v_base := round(v_line_total * 100 / (100 + v_item.gst_percent), 2);

    insert into public.sale_items (tenant_id, outlet_id, sale_id, item_id,
                                   item_name, quantity, price, gst_percent, line_total)
    values (v_user.tenant_id, v_user.outlet_id, v_sale_id, v_item.id,
            v_item.name, v_qty, v_item.price, v_item.gst_percent, v_line_total);

    v_gross := v_gross + v_line_total;
    v_subtotal := v_subtotal + v_base;
    v_gst := v_gst + (v_line_total - v_base);
  end loop;

  if coalesce(p_discount, 0) < 0 or coalesce(p_discount, 0) > v_gross then
    raise exception 'Discount cannot exceed bill amount';
  end if;

  update public.sales
  set subtotal = v_subtotal,
      gst_amount = v_gst,
      total = v_gross - coalesce(p_discount, 0)
  where id = v_sale_id;

  return jsonb_build_object('sale_id', v_sale_id, 'bill_number', v_bill_no);
end;
$$;

create or replace function public.adjust_stock(
  p_ingredient_id uuid,
  p_type text,
  p_quantity numeric,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
  v_delta numeric;
begin
  v_user := public.get_active_user();
  if v_user.role not in ('owner', 'manager') then
    raise exception 'Only owners and managers can adjust stock';
  end if;
  if p_type not in ('purchase', 'usage', 'adjustment', 'wastage') then
    raise exception 'Invalid movement type';
  end if;
  if p_quantity is null or p_quantity = 0 then
    raise exception 'Quantity is required';
  end if;

  v_delta := case
    when p_type in ('usage', 'wastage') then -abs(p_quantity)
    when p_type = 'purchase' then abs(p_quantity)
    else p_quantity  -- adjustment: signed
  end;

  insert into public.stock_movements (tenant_id, outlet_id, ingredient_id, type, quantity, note)
  values (v_user.tenant_id, v_user.outlet_id, p_ingredient_id, p_type, v_delta, p_note);

  update public.ingredients
  set current_stock = current_stock + v_delta
  where id = p_ingredient_id and tenant_id = v_user.tenant_id;

  if not found then
    raise exception 'Ingredient not found';
  end if;
end;
$$;

create or replace function public.create_purchase(
  p_vendor_id uuid,
  p_bill_number text,
  p_bill_date date,
  p_items jsonb,
  p_paid_amount numeric default 0,
  p_payment_mode text default 'cash'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
  v_purchase_id uuid := gen_random_uuid();
  v_line jsonb;
  v_qty numeric;
  v_rate numeric;
  v_amount numeric;
  v_total numeric := 0;
  v_ing_name text;
begin
  v_user := public.get_active_user();
  if v_user.role not in ('owner', 'manager') then
    raise exception 'Only owners and managers can record purchases';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item to the purchase';
  end if;

  insert into public.purchases (id, tenant_id, outlet_id, vendor_id, bill_number, bill_date, total_amount, status)
  values (v_purchase_id, v_user.tenant_id, v_user.outlet_id, p_vendor_id,
          nullif(p_bill_number, ''), coalesce(p_bill_date, current_date), 0, 'pending');

  for v_line in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_line->>'quantity')::numeric;
    v_rate := (v_line->>'rate')::numeric;
    if v_qty is null or v_qty <= 0 or v_rate is null or v_rate < 0 then
      raise exception 'Invalid quantity or rate';
    end if;
    v_amount := round(v_qty * v_rate, 2);
    v_total := v_total + v_amount;

    insert into public.purchase_items (tenant_id, outlet_id, purchase_id, ingredient_id, quantity, rate, amount)
    values (v_user.tenant_id, v_user.outlet_id, v_purchase_id,
            (v_line->>'ingredient_id')::uuid, v_qty, v_rate, v_amount);

    select name into v_ing_name from public.ingredients
    where id = (v_line->>'ingredient_id')::uuid and tenant_id = v_user.tenant_id;
    if v_ing_name is null then
      raise exception 'Ingredient not found';
    end if;

    -- Stock in + keep the latest cost per unit for valuation.
    insert into public.stock_movements (tenant_id, outlet_id, ingredient_id, type, quantity, note)
    values (v_user.tenant_id, v_user.outlet_id, (v_line->>'ingredient_id')::uuid,
            'purchase', v_qty, 'Purchase bill ' || coalesce(nullif(p_bill_number, ''), v_purchase_id::text));

    update public.ingredients
    set current_stock = current_stock + v_qty, cost_per_unit = v_rate
    where id = (v_line->>'ingredient_id')::uuid and tenant_id = v_user.tenant_id;
  end loop;

  update public.purchases set total_amount = v_total where id = v_purchase_id;

  if coalesce(p_paid_amount, 0) > 0 then
    perform public.record_purchase_payment(v_purchase_id, p_paid_amount, current_date, p_payment_mode);
  end if;

  return v_purchase_id;
end;
$$;

create or replace function public.record_purchase_payment(
  p_purchase_id uuid,
  p_amount numeric,
  p_payment_date date default current_date,
  p_mode text default 'cash'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
  v_total numeric;
  v_paid numeric;
begin
  v_user := public.get_active_user();
  if v_user.role not in ('owner', 'manager') then
    raise exception 'Only owners and managers can record payments';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be positive';
  end if;
  if p_mode not in ('cash', 'upi', 'bank') then
    raise exception 'Invalid payment mode';
  end if;

  select total_amount into v_total from public.purchases
  where id = p_purchase_id and tenant_id = v_user.tenant_id;
  if v_total is null then
    raise exception 'Purchase not found';
  end if;

  select coalesce(sum(amount), 0) into v_paid from public.purchase_payments
  where purchase_id = p_purchase_id;

  if v_paid + p_amount > v_total then
    raise exception 'Payment exceeds pending amount (pending: %)', v_total - v_paid;
  end if;

  insert into public.purchase_payments (tenant_id, outlet_id, purchase_id, amount, payment_date, mode)
  values (v_user.tenant_id, v_user.outlet_id, p_purchase_id, p_amount,
          coalesce(p_payment_date, current_date), p_mode);

  update public.purchases
  set status = case
    when v_paid + p_amount >= v_total then 'paid'
    when v_paid + p_amount > 0 then 'partial'
    else 'pending'
  end
  where id = p_purchase_id;
end;
$$;
