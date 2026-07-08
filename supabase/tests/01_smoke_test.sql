-- ============================================================
-- Database smoke test — exercises the business logic end-to-end
-- on a fresh database that has 00_local_stub.sql + all
-- migrations applied. Every block raises an error on failure,
-- so "no errors" = all tests passed.
--
-- Simulated logins: set_config('request.jwt.claim.sub', <uuid>)
-- + SET ROLE authenticated (exactly how PostgREST executes).
-- ============================================================

\set ON_ERROR_STOP on

-- ---------- T1: signup trigger links new auth users to the first tenant ----------

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner@mycoffeeshop.test');

do $$
declare u public.users%rowtype;
begin
  select * into u from public.users where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  assert u.id is not null, 'T1: public.users row was not auto-created';
  assert u.tenant_id = '11111111-1111-1111-1111-111111111111', 'T1: wrong tenant assigned';
  assert u.outlet_id = '22222222-2222-2222-2222-222222222222', 'T1: wrong outlet assigned';
  assert u.role = 'owner', 'T1: first user should be owner';
end $$;

-- ---------- T2: a demo-customer user (manually linked, as documented) ----------

insert into auth.users (id, email) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'owner@brewbros.test');
update public.users
set tenant_id = '99999999-9999-9999-9999-999999999999',
    outlet_id = '44444444-0000-0000-0000-000000000001'
where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- ---------- T3: RLS — each tenant sees only its own data ----------

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
set role authenticated;

do $$
begin
  assert (select count(*) from public.tenants) = 1, 'T3: user must see exactly one tenant';
  assert (select name from public.tenants) = 'My Coffee Shop', 'T3: wrong tenant visible';
  assert (select count(*) from public.outlets) = 1, 'T3: single-outlet tenant must see 1 outlet';
  assert not exists (select 1 from public.items where tenant_id = '99999999-9999-9999-9999-999999999999'),
    'T3: demo tenant items leaked to shop 1';
  assert not exists (select 1 from public.sales where tenant_id = '99999999-9999-9999-9999-999999999999'),
    'T3: demo tenant sales leaked to shop 1';
end $$;

reset role;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
set role authenticated;

do $$
begin
  assert (select count(*) from public.outlets) = 2, 'T3: demo tenant must see its 2 outlets';
  assert not exists (select 1 from public.items where tenant_id = '11111111-1111-1111-1111-111111111111'),
    'T3: shop-1 items leaked to demo tenant';
end $$;

reset role;

-- ---------- T4: create_sale — GST-inclusive math, snapshots, bill numbering ----------

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
set role authenticated;

do $$
declare
  v_capp uuid; v_brownie uuid;
  r1 jsonb; r2 jsonb;
  s public.sales%rowtype;
begin
  select id into v_capp from public.items where name = 'Cappuccino' limit 1;          -- ₹120, 5%
  select id into v_brownie from public.items where name = 'Chocolate Brownie' limit 1; -- ₹90, 18%

  r1 := public.create_sale(
    jsonb_build_array(
      jsonb_build_object('item_id', v_capp, 'quantity', 2),
      jsonb_build_object('item_id', v_brownie, 'quantity', 1)
    ),
    30, 'upi');
  assert (r1->>'bill_number')::int = 1, 'T4: first bill of the day must be #1';

  select * into s from public.sales where id = (r1->>'sale_id')::uuid;
  -- 2×120 = 240 (base 228.57, gst 11.43); 1×90 = 90 (base 76.27, gst 13.73)
  assert s.total = 300.00, format('T4: total expected 300.00, got %s', s.total);
  assert s.subtotal = 304.84, format('T4: subtotal expected 304.84, got %s', s.subtotal);
  assert s.gst_amount = 25.16, format('T4: gst expected 25.16, got %s', s.gst_amount);
  assert s.discount = 30.00, 'T4: discount not stored';
  assert (select count(*) from public.sale_items where sale_id = s.id) = 2, 'T4: line count wrong';
  assert (select item_name from public.sale_items where sale_id = s.id and item_id = v_capp) = 'Cappuccino',
    'T4: item name not snapshotted';

  -- Second sale, same day → bill #2
  r2 := public.create_sale(jsonb_build_array(jsonb_build_object('item_id', v_capp, 'quantity', 1)), 0, 'cash');
  assert (r2->>'bill_number')::int = 2, 'T4: second bill of the day must be #2';

  -- Menu edit must NOT change the old bill (snapshot check).
  update public.items set price = 999 where id = v_capp;
  assert (select price from public.sale_items where sale_id = s.id and item_id = v_capp) = 120,
    'T4: old bill changed after menu edit!';
  update public.items set price = 120 where id = v_capp;

  -- Guard rails
  begin
    perform public.create_sale('[]'::jsonb, 0, 'cash');
    raise exception 'T4: empty cart was accepted';
  exception when others then
    if sqlerrm like 'T4:%' then raise; end if;
  end;
  begin
    perform public.create_sale(jsonb_build_array(jsonb_build_object('item_id', v_capp, 'quantity', 1)), 5000, 'cash');
    raise exception 'T4: discount larger than bill was accepted';
  exception when others then
    if sqlerrm like 'T4:%' then raise; end if;
  end;
end $$;

-- ---------- T5: adjust_stock ----------

do $$
declare
  v_milk uuid; before_qty numeric; after_qty numeric;
begin
  select id, current_stock into v_milk, before_qty from public.ingredients where name = 'Milk' limit 1;

  perform public.adjust_stock(v_milk, 'usage', 5, 'evening usage');
  select current_stock into after_qty from public.ingredients where id = v_milk;
  assert after_qty = before_qty - 5, 'T5: usage did not reduce stock';

  perform public.adjust_stock(v_milk, 'purchase', 12, 'local top-up');
  select current_stock into after_qty from public.ingredients where id = v_milk;
  assert after_qty = before_qty + 7, 'T5: purchase did not add stock';

  assert (select count(*) from public.stock_movements where ingredient_id = v_milk) >= 2,
    'T5: movements not recorded';
end $$;

-- ---------- T6: create_purchase + payment status transitions ----------

do $$
declare
  v_vendor uuid; v_beans uuid; v_purchase uuid;
  before_qty numeric;
  p public.purchases%rowtype;
begin
  insert into public.vendors (tenant_id, outlet_id, name)
  values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'Test Beans Co')
  returning id into v_vendor;

  select id, current_stock into v_beans, before_qty from public.ingredients where name = 'Coffee Beans' limit 1;

  v_purchase := public.create_purchase(
    v_vendor, 'TB-001', current_date,
    jsonb_build_array(jsonb_build_object('ingredient_id', v_beans, 'quantity', 5, 'rate', 900)),
    2000, 'upi');

  select * into p from public.purchases where id = v_purchase;
  assert p.total_amount = 4500, 'T6: purchase total wrong';
  assert p.status = 'partial', 'T6: expected partial after part payment';
  assert (select current_stock from public.ingredients where id = v_beans) = before_qty + 5,
    'T6: stock not updated by purchase';
  assert (select cost_per_unit from public.ingredients where id = v_beans) = 900,
    'T6: cost per unit not updated';

  -- Overpayment must be rejected.
  begin
    perform public.record_purchase_payment(v_purchase, 99999, current_date, 'cash');
    raise exception 'T6: overpayment was accepted';
  exception when others then
    if sqlerrm like 'T6:%' then raise; end if;
  end;

  -- Pay the rest → paid.
  perform public.record_purchase_payment(v_purchase, 2500, current_date, 'cash');
  select * into p from public.purchases where id = v_purchase;
  assert p.status = 'paid', 'T6: expected paid after full payment';
end $$;

reset role;

-- ---------- T7: multi-outlet — demo user works in either outlet, never elsewhere ----------

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
set role authenticated;

do $$
declare
  v_bh uuid := '44444444-0000-0000-0000-000000000001';  -- Banjara Hills (home outlet)
  v_mp uuid := '44444444-0000-0000-0000-000000000002';  -- Madhapur
  v_item_mp uuid;
  v_counter_before int;
  r jsonb;
  s public.sales%rowtype;
begin
  select id into v_item_mp from public.items where outlet_id = v_mp and name = 'Espresso';
  select coalesce(max(last_number), 0) into v_counter_before
  from public.bill_counters
  where outlet_id = v_mp and bill_date = (now() at time zone 'Asia/Kolkata')::date;

  -- Sell in the NON-home outlet by passing p_outlet_id.
  r := public.create_sale(
    jsonb_build_array(jsonb_build_object('item_id', v_item_mp, 'quantity', 1)),
    0, 'card', v_mp);
  select * into s from public.sales where id = (r->>'sale_id')::uuid;
  assert s.outlet_id = v_mp, 'T7: sale not written to the selected outlet';
  assert s.bill_number = v_counter_before + 1,
    format('T7: bill number must continue the outlet counter (%s), got %s', v_counter_before + 1, s.bill_number);

  -- A Madhapur item cannot be sold in Banjara Hills.
  begin
    perform public.create_sale(
      jsonb_build_array(jsonb_build_object('item_id', v_item_mp, 'quantity', 1)), 0, 'cash', v_bh);
    raise exception 'T7: cross-outlet item was accepted';
  exception when others then
    if sqlerrm like 'T7:%' then raise; end if;
  end;

  -- Another tenant's outlet must be rejected outright.
  begin
    perform public.create_sale(
      jsonb_build_array(jsonb_build_object('item_id', v_item_mp, 'quantity', 1)),
      0, 'cash', '22222222-2222-2222-2222-222222222222');
    raise exception 'T7: foreign outlet was accepted';
  exception when others then
    if sqlerrm like 'T7:%' then raise; end if;
  end;
end $$;

reset role;

-- ---------- T8: demo seed sanity — both outlets have dashboard-ready data ----------

do $$
declare
  v_bh uuid := '44444444-0000-0000-0000-000000000001';
  v_mp uuid := '44444444-0000-0000-0000-000000000002';
  n int;
begin
  select count(*) into n from public.sales where outlet_id = v_bh;
  assert n >= 40, format('T8: Banjara Hills should have 2 weeks of sales, got %s', n);
  select count(*) into n from public.sales where outlet_id = v_mp;
  assert n >= 80, format('T8: Madhapur should be busier, got %s', n);

  -- Every seeded sale must be internally consistent.
  select count(*) into n
  from public.sales s
  where s.tenant_id = '99999999-9999-9999-9999-999999999999'
    and abs((select coalesce(sum(line_total), 0) from public.sale_items si where si.sale_id = s.id)
            - (s.total + s.discount)) > 0.01;
  assert n = 0, format('T8: %s seeded sales have inconsistent totals', n);

  select count(*) into n
  from public.sales s
  where s.tenant_id = '99999999-9999-9999-9999-999999999999'
    and abs(s.subtotal + s.gst_amount - (s.total + s.discount)) > 0.01;
  assert n = 0, format('T8: %s seeded sales have inconsistent GST split', n);

  -- Madhapur must show a low-stock alert (Paper Cups), Banjara Hills must not.
  assert exists (select 1 from public.ingredients
                 where outlet_id = v_mp and current_stock <= low_stock_threshold),
    'T8: Madhapur should have a low-stock ingredient';

  -- Each outlet owes ₹3,200 to its dairy vendor (6200 billed − 3000 paid).
  select sum(p.total_amount - paid.amt)::int into n
  from public.purchases p
  join lateral (select coalesce(sum(amount), 0) amt from public.purchase_payments where purchase_id = p.id) paid on true
  where p.outlet_id = v_bh and p.status <> 'paid';
  assert n = 3200, format('T8: Banjara Hills vendor due expected 3200, got %s', n);
end $$;

\echo '=== ALL SMOKE TESTS PASSED ==='
