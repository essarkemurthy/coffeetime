-- ============================================================
-- Migration 0004: Outlet-aware business functions
--
-- The RPCs now take an optional p_outlet_id so a tenant with
-- several outlets (each user can work in any outlet of their
-- own tenant) writes data to the outlet selected in the app.
-- When omitted, the user's home outlet is used — so nothing
-- changes for single-outlet shops.
-- ============================================================

-- Resolves and validates the outlet a request should act on.
create or replace function public.resolve_outlet(p_outlet_id uuid, p_user public.users)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_outlet uuid;
begin
  v_outlet := coalesce(p_outlet_id, p_user.outlet_id);
  if not exists (
    select 1 from public.outlets where id = v_outlet and tenant_id = p_user.tenant_id
  ) then
    raise exception 'Outlet does not belong to your shop';
  end if;
  return v_outlet;
end;
$$;

drop function if exists public.create_sale(jsonb, numeric, text);
create or replace function public.create_sale(
  p_items jsonb,
  p_discount numeric default 0,
  p_payment_mode text default 'cash',
  p_outlet_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
  v_outlet uuid;
  v_sale_id uuid := gen_random_uuid();
  v_bill_no int;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_line jsonb;
  v_item public.items%rowtype;
  v_qty int;
  v_line_total numeric := 0;
  v_base numeric;
  v_gross numeric := 0;
  v_subtotal numeric := 0;
  v_gst numeric := 0;
begin
  select * into v_user from public.users where id = auth.uid();
  if v_user.id is null then
    raise exception 'Not logged in';
  end if;
  v_outlet := public.resolve_outlet(p_outlet_id, v_user);
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;
  if p_payment_mode not in ('cash', 'upi', 'card', 'mixed') then
    raise exception 'Invalid payment mode';
  end if;

  insert into public.bill_counters (outlet_id, bill_date, last_number)
  values (v_outlet, v_today, 1)
  on conflict (outlet_id, bill_date)
  do update set last_number = public.bill_counters.last_number + 1
  returning last_number into v_bill_no;

  insert into public.sales (id, tenant_id, outlet_id, bill_number, sale_date,
                            subtotal, gst_amount, discount, total, payment_mode, created_by)
  values (v_sale_id, v_user.tenant_id, v_outlet, v_bill_no, v_today,
          0, 0, coalesce(p_discount, 0), 0, p_payment_mode, v_user.id);

  for v_line in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_line->>'quantity')::int;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Invalid quantity';
    end if;

    select * into v_item from public.items
    where id = (v_line->>'item_id')::uuid
      and tenant_id = v_user.tenant_id and outlet_id = v_outlet and is_active = true;
    if v_item.id is null then
      raise exception 'Item not found or inactive';
    end if;

    v_line_total := round(v_item.price * v_qty, 2);
    v_base := round(v_line_total * 100 / (100 + v_item.gst_percent), 2);

    insert into public.sale_items (tenant_id, outlet_id, sale_id, item_id,
                                   item_name, quantity, price, gst_percent, line_total)
    values (v_user.tenant_id, v_outlet, v_sale_id, v_item.id,
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

drop function if exists public.adjust_stock(uuid, text, numeric, text);
create or replace function public.adjust_stock(
  p_ingredient_id uuid,
  p_type text,
  p_quantity numeric,
  p_note text default null,
  p_outlet_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
  v_outlet uuid;
  v_delta numeric;
begin
  select * into v_user from public.users where id = auth.uid();
  if v_user.id is null then
    raise exception 'Not logged in';
  end if;
  v_outlet := public.resolve_outlet(p_outlet_id, v_user);
  if p_type not in ('purchase', 'usage', 'adjustment', 'wastage') then
    raise exception 'Invalid movement type';
  end if;
  if p_quantity is null or p_quantity = 0 then
    raise exception 'Quantity is required';
  end if;

  v_delta := case
    when p_type in ('usage', 'wastage') then -abs(p_quantity)
    when p_type = 'purchase' then abs(p_quantity)
    else p_quantity
  end;

  update public.ingredients
  set current_stock = current_stock + v_delta
  where id = p_ingredient_id and tenant_id = v_user.tenant_id and outlet_id = v_outlet;

  if not found then
    raise exception 'Ingredient not found in this outlet';
  end if;

  insert into public.stock_movements (tenant_id, outlet_id, ingredient_id, type, quantity, note)
  values (v_user.tenant_id, v_outlet, p_ingredient_id, p_type, v_delta, p_note);
end;
$$;

drop function if exists public.create_purchase(uuid, text, date, jsonb, numeric, text);
create or replace function public.create_purchase(
  p_vendor_id uuid,
  p_bill_number text,
  p_bill_date date,
  p_items jsonb,
  p_paid_amount numeric default 0,
  p_payment_mode text default 'cash',
  p_outlet_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
  v_outlet uuid;
  v_purchase_id uuid := gen_random_uuid();
  v_line jsonb;
  v_qty numeric;
  v_rate numeric;
  v_amount numeric;
  v_total numeric := 0;
begin
  select * into v_user from public.users where id = auth.uid();
  if v_user.id is null then
    raise exception 'Not logged in';
  end if;
  v_outlet := public.resolve_outlet(p_outlet_id, v_user);
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item to the purchase';
  end if;
  if not exists (
    select 1 from public.vendors
    where id = p_vendor_id and tenant_id = v_user.tenant_id and outlet_id = v_outlet
  ) then
    raise exception 'Vendor not found in this outlet';
  end if;

  insert into public.purchases (id, tenant_id, outlet_id, vendor_id, bill_number, bill_date, total_amount, status)
  values (v_purchase_id, v_user.tenant_id, v_outlet, p_vendor_id,
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

    update public.ingredients
    set current_stock = current_stock + v_qty, cost_per_unit = v_rate
    where id = (v_line->>'ingredient_id')::uuid
      and tenant_id = v_user.tenant_id and outlet_id = v_outlet;
    if not found then
      raise exception 'Ingredient not found in this outlet';
    end if;

    insert into public.purchase_items (tenant_id, outlet_id, purchase_id, ingredient_id, quantity, rate, amount)
    values (v_user.tenant_id, v_outlet, v_purchase_id,
            (v_line->>'ingredient_id')::uuid, v_qty, v_rate, v_amount);

    insert into public.stock_movements (tenant_id, outlet_id, ingredient_id, type, quantity, note)
    values (v_user.tenant_id, v_outlet, (v_line->>'ingredient_id')::uuid,
            'purchase', v_qty, 'Purchase bill ' || coalesce(nullif(p_bill_number, ''), v_purchase_id::text));
  end loop;

  update public.purchases set total_amount = v_total where id = v_purchase_id;

  if coalesce(p_paid_amount, 0) > 0 then
    perform public.record_purchase_payment(v_purchase_id, p_paid_amount, current_date, p_payment_mode);
  end if;

  return v_purchase_id;
end;
$$;
