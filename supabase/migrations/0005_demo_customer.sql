-- ============================================================
-- Migration 0005 (OPTIONAL): Demo customer with TWO outlets
--
-- Seeds a second tenant — "Brew Bros (Demo)" — with outlets in
-- Banjara Hills and Madhapur, each with its own menu, stock,
-- vendors, purchases, expenses, and two weeks of sales, so the
-- dashboards and reports have realistic data per outlet.
--
-- This proves the multi-tenant/multi-outlet design with zero
-- schema changes. Skip this file in production if you don't
-- want demo data. Remove it later with:
--   delete from tenants where id = '99999999-9999-9999-9999-999999999999' cascade
--   (or use the delete statements at the bottom, kept as comments)
--
-- To LOG IN as the demo customer: after a new user signs up,
-- point their profile at the demo tenant, e.g.
--   update public.users
--   set tenant_id = '99999999-9999-9999-9999-999999999999',
--       outlet_id = '44444444-0000-0000-0000-000000000001'
--   where id = '<that auth user id>';
-- ============================================================

insert into public.tenants (id, name)
values ('99999999-9999-9999-9999-999999999999', 'Brew Bros (Demo)');

insert into public.outlets (id, tenant_id, name, address, gstin, phone) values
  ('44444444-0000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999999',
   'Brew Bros — Banjara Hills', 'Road No. 12, Banjara Hills, Hyderabad', '36AABCB1234F1Z5', '+91 90000 11111'),
  ('44444444-0000-0000-0000-000000000002', '99999999-9999-9999-9999-999999999999',
   'Brew Bros — Madhapur', 'Ayyappa Society, Madhapur, Hyderabad', '36AABCB1234F1Z5', '+91 90000 22222');

-- ---------- Menu, ingredients, vendors per outlet ----------

do $$
declare
  v_tenant uuid := '99999999-9999-9999-9999-999999999999';
  v_outlet uuid;
  v_cat_coffee uuid;
  v_cat_snacks uuid;
  v_cat_desserts uuid;
  v_suffix text;
begin
  foreach v_outlet in array array[
    '44444444-0000-0000-0000-000000000001'::uuid,
    '44444444-0000-0000-0000-000000000002'::uuid
  ]
  loop
    -- Madhapur is a bigger outlet: slightly higher prices there.
    v_suffix := case when v_outlet = '44444444-0000-0000-0000-000000000002' then 'MP' else 'BH' end;

    insert into public.categories (id, tenant_id, outlet_id, name, sort_order)
    values (gen_random_uuid(), v_tenant, v_outlet, 'Coffee', 1)
    returning id into v_cat_coffee;
    insert into public.categories (id, tenant_id, outlet_id, name, sort_order)
    values (gen_random_uuid(), v_tenant, v_outlet, 'Snacks', 2)
    returning id into v_cat_snacks;
    insert into public.categories (id, tenant_id, outlet_id, name, sort_order)
    values (gen_random_uuid(), v_tenant, v_outlet, 'Desserts', 3)
    returning id into v_cat_desserts;

    insert into public.items (tenant_id, outlet_id, category_id, name, price, gst_percent) values
      (v_tenant, v_outlet, v_cat_coffee,   'Espresso',       case v_suffix when 'MP' then 110 else 100 end, 5),
      (v_tenant, v_outlet, v_cat_coffee,   'Cappuccino',     case v_suffix when 'MP' then 150 else 140 end, 5),
      (v_tenant, v_outlet, v_cat_coffee,   'Latte',          case v_suffix when 'MP' then 160 else 150 end, 5),
      (v_tenant, v_outlet, v_cat_coffee,   'Cold Brew',      case v_suffix when 'MP' then 180 else 170 end, 5),
      (v_tenant, v_outlet, v_cat_snacks,   'Chicken Puff',   50, 5),
      (v_tenant, v_outlet, v_cat_snacks,   'Sandwich',       120, 5),
      (v_tenant, v_outlet, v_cat_desserts, 'Cheesecake',     180, 18),
      (v_tenant, v_outlet, v_cat_desserts, 'Choco Muffin',   90, 18);

    insert into public.ingredients (tenant_id, outlet_id, name, unit, current_stock, low_stock_threshold, cost_per_unit) values
      (v_tenant, v_outlet, 'Arabica Beans', 'kg', 12, 4, 950),
      (v_tenant, v_outlet, 'Milk', 'L', 25, 15, 62),
      (v_tenant, v_outlet, 'Cream Cheese', 'kg', 3, 2, 700),
      (v_tenant, v_outlet, 'Bread Loaves', 'pcs', 18, 10, 45),
      -- Madhapur is deliberately low on cups so its dashboard shows an alert.
      (v_tenant, v_outlet, 'Paper Cups', 'pkt', case when v_suffix = 'MP' then 2 else 9 end, 3, 150);

    insert into public.vendors (tenant_id, outlet_id, name, phone, notes) values
      (v_tenant, v_outlet, 'Hyderabad Coffee Traders', '+91 98888 10001', 'Weekly bean delivery'),
      (v_tenant, v_outlet, 'Heritage Dairy ' || v_suffix, '+91 98888 10002', 'Daily milk, morning');
  end loop;
end $$;

-- ---------- Purchases with payments (per outlet) ----------

do $$
declare
  v_tenant uuid := '99999999-9999-9999-9999-999999999999';
  v_outlet uuid;
  v_vendor uuid;
  v_ing uuid;
  v_purchase uuid;
begin
  foreach v_outlet in array array[
    '44444444-0000-0000-0000-000000000001'::uuid,
    '44444444-0000-0000-0000-000000000002'::uuid
  ]
  loop
    -- Bean purchase 10 days ago: fully paid.
    select id into v_vendor from public.vendors where outlet_id = v_outlet and name like 'Hyderabad Coffee%';
    select id into v_ing from public.ingredients where outlet_id = v_outlet and name = 'Arabica Beans';
    v_purchase := gen_random_uuid();
    insert into public.purchases (id, tenant_id, outlet_id, vendor_id, bill_number, bill_date, total_amount, status)
    values (v_purchase, v_tenant, v_outlet, v_vendor, 'HCT-2081', current_date - 10, 9500, 'paid');
    insert into public.purchase_items (tenant_id, outlet_id, purchase_id, ingredient_id, quantity, rate, amount)
    values (v_tenant, v_outlet, v_purchase, v_ing, 10, 950, 9500);
    insert into public.purchase_payments (tenant_id, outlet_id, purchase_id, amount, payment_date, mode)
    values (v_tenant, v_outlet, v_purchase, 9500, current_date - 8, 'bank');

    -- Milk purchase 3 days ago: half paid → shows as pending due.
    select id into v_vendor from public.vendors where outlet_id = v_outlet and name like 'Heritage Dairy%';
    select id into v_ing from public.ingredients where outlet_id = v_outlet and name = 'Milk';
    v_purchase := gen_random_uuid();
    insert into public.purchases (id, tenant_id, outlet_id, vendor_id, bill_number, bill_date, total_amount, status)
    values (v_purchase, v_tenant, v_outlet, v_vendor, 'HD-4412', current_date - 3, 6200, 'partial');
    insert into public.purchase_items (tenant_id, outlet_id, purchase_id, ingredient_id, quantity, rate, amount)
    values (v_tenant, v_outlet, v_purchase, v_ing, 100, 62, 6200);
    insert into public.purchase_payments (tenant_id, outlet_id, purchase_id, amount, payment_date, mode)
    values (v_tenant, v_outlet, v_purchase, 3000, current_date - 2, 'upi');
  end loop;
end $$;

-- ---------- Expenses (per outlet, spread over the month) ----------

insert into public.expenses (tenant_id, outlet_id, category, amount, expense_date, note)
select '99999999-9999-9999-9999-999999999999', o.id, e.category, e.amount, e.expense_date, e.note
from public.outlets o
cross join (values
  ('rent'::text,        45000::numeric, current_date - 7,  'Monthly rent'),
  ('salary',            38000,          current_date - 6,  'Staff salaries'),
  ('electricity',        6500,          current_date - 4,  'Power bill'),
  ('maintenance',        1800,          current_date - 12, 'Grinder service'),
  ('misc',                950,          current_date - 1,  'Cleaning supplies')
) as e(category, amount, expense_date, note)
where o.tenant_id = '99999999-9999-9999-9999-999999999999';

-- ---------- Two weeks of sales per outlet ----------
-- Realistic spread: Madhapur does more volume than Banjara Hills;
-- every bill has correct GST-inclusive math and a per-day bill number.

do $$
declare
  v_tenant uuid := '99999999-9999-9999-9999-999999999999';
  v_outlet uuid;
  v_day date;
  v_bills int;
  v_bill int;
  v_sale uuid;
  v_lines int;
  v_item record;
  v_qty int;
  v_line_total numeric;
  v_base numeric;
  v_gross numeric;
  v_subtotal numeric;
  v_gst numeric;
  v_mode text;
begin
  perform setseed(0.42);  -- deterministic demo data

  foreach v_outlet in array array[
    '44444444-0000-0000-0000-000000000001'::uuid,
    '44444444-0000-0000-0000-000000000002'::uuid
  ]
  loop
    for v_day in select generate_series(current_date - 13, current_date, interval '1 day')::date
    loop
      -- Madhapur ~8-14 bills/day, Banjara Hills ~4-9
      v_bills := case when v_outlet = '44444444-0000-0000-0000-000000000002'
                      then 8 + floor(random() * 7)::int
                      else 4 + floor(random() * 6)::int end;
      -- Today is still in progress: fewer bills so far.
      if v_day = current_date then
        v_bills := greatest(2, v_bills / 2);
      end if;

      for v_bill in 1..v_bills
      loop
        v_sale := gen_random_uuid();
        v_gross := 0; v_subtotal := 0; v_gst := 0;
        v_mode := (array['cash','upi','upi','card','upi','cash'])[1 + floor(random() * 6)::int];

        insert into public.sales (id, tenant_id, outlet_id, bill_number, sale_date,
                                  subtotal, gst_amount, discount, total, payment_mode, created_at)
        values (v_sale, v_tenant, v_outlet, v_bill, v_day, 0, 0, 0, 0, v_mode,
                v_day::timestamptz + interval '8 hours'
                  + (interval '1 minute' * floor(random() * 720)::int)
                  - interval '5 hours 30 minutes');  -- store as UTC for IST daytime

        v_lines := 1 + floor(random() * 3)::int;
        for v_item in
          select id, name, price, gst_percent from public.items
          where outlet_id = v_outlet order by random() limit v_lines
        loop
          v_qty := 1 + floor(random() * 2)::int;
          v_line_total := round(v_item.price * v_qty, 2);
          v_base := round(v_line_total * 100 / (100 + v_item.gst_percent), 2);

          insert into public.sale_items (tenant_id, outlet_id, sale_id, item_id,
                                         item_name, quantity, price, gst_percent, line_total)
          values (v_tenant, v_outlet, v_sale, v_item.id,
                  v_item.name, v_qty, v_item.price, v_item.gst_percent, v_line_total);

          v_gross := v_gross + v_line_total;
          v_subtotal := v_subtotal + v_base;
          v_gst := v_gst + (v_line_total - v_base);
        end loop;

        update public.sales
        set subtotal = v_subtotal, gst_amount = v_gst, total = v_gross
        where id = v_sale;
      end loop;

      -- Keep the daily bill counter in sync so live billing continues from here.
      insert into public.bill_counters (outlet_id, bill_date, last_number)
      values (v_outlet, v_day, v_bills)
      on conflict (outlet_id, bill_date) do update set last_number = excluded.last_number;
    end loop;
  end loop;
end $$;

-- ---------- To remove ALL demo data later, run: ----------
-- delete from public.sale_items        where tenant_id = '99999999-9999-9999-9999-999999999999';
-- delete from public.sales             where tenant_id = '99999999-9999-9999-9999-999999999999';
-- delete from public.bill_counters     where outlet_id in (select id from public.outlets where tenant_id = '99999999-9999-9999-9999-999999999999');
-- delete from public.purchase_payments where tenant_id = '99999999-9999-9999-9999-999999999999';
-- delete from public.purchase_items    where tenant_id = '99999999-9999-9999-9999-999999999999';
-- delete from public.purchases         where tenant_id = '99999999-9999-9999-9999-999999999999';
-- delete from public.stock_movements   where tenant_id = '99999999-9999-9999-9999-999999999999';
-- delete from public.expenses          where tenant_id = '99999999-9999-9999-9999-999999999999';
-- delete from public.ingredients       where tenant_id = '99999999-9999-9999-9999-999999999999';
-- delete from public.items             where tenant_id = '99999999-9999-9999-9999-999999999999';
-- delete from public.categories        where tenant_id = '99999999-9999-9999-9999-999999999999';
-- delete from public.vendors           where tenant_id = '99999999-9999-9999-9999-999999999999';
-- delete from public.users             where tenant_id = '99999999-9999-9999-9999-999999999999';
-- delete from public.outlets           where tenant_id = '99999999-9999-9999-9999-999999999999';
-- delete from public.tenants           where id        = '99999999-9999-9999-9999-999999999999';
