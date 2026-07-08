-- ============================================================
-- Migration 0002: Business logic functions (RPCs)
--
-- These run INSIDE the database so multi-step operations
-- (bill numbering, stock updates, payment status) are atomic —
-- two tablets billing at the same moment can never clash.
-- ============================================================

-- ---------- Sales ----------

-- Creates a sale with a per-outlet, per-day auto-incrementing
-- bill number, snapshotting item name/price/GST so old bills
-- never change when the menu is edited.
--
-- p_items is a JSON array: [{ "item_id": "...", "quantity": 2 }, ...]
-- Prices are GST-INCLUSIVE; we back-calculate the GST breakup.
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
  select * into v_user from public.users where id = auth.uid();
  if v_user.id is null then
    raise exception 'Not logged in';
  end if;
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

-- ---------- Inventory ----------

-- Records a stock movement and keeps ingredient.current_stock in sync.
-- 'purchase' adds stock; 'usage' and 'wastage' remove it;
-- 'adjustment' applies the signed quantity as-is (can be + or -).
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
  select * into v_user from public.users where id = auth.uid();
  if v_user.id is null then
    raise exception 'Not logged in';
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

-- ---------- Purchases ----------

-- Creates a vendor purchase with line items, updates ingredient
-- stock, and optionally records an immediate payment. Status is
-- derived from how much has been paid.
--
-- p_items: [{ "ingredient_id": "...", "quantity": 5, "rate": 260 }, ...]
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
  select * into v_user from public.users where id = auth.uid();
  if v_user.id is null then
    raise exception 'Not logged in';
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

-- Records a payment against a purchase and refreshes its status.
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
  select * into v_user from public.users where id = auth.uid();
  if v_user.id is null then
    raise exception 'Not logged in';
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
