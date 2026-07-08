# CoffeeTime — Coffee Shop Management Platform

A web app to run a coffee shop end-to-end: menu, billing/POS with GST,
inventory & groceries, vendor purchases & payments, expenses, and reports.
Works in the browser on an Android tablet and a phone.

- **Stack:** Next.js 14 (App Router) + TypeScript, Tailwind CSS with
  shadcn-style components, Supabase (PostgreSQL + email OTP auth), Vercel.
- **Currency:** ₹ with Indian number formatting (₹1,23,456.50).
  **Dates:** DD-MM-YYYY. **Timezone:** Asia/Kolkata.
- **GST:** every item has a GST % (0/5/12/18). Menu prices are
  **GST-inclusive** — the price you type is what the customer pays; the
  bill shows the GST breakup automatically.
- **Multi-tenant ready:** every table has `tenant_id` and `outlet_id`.
  Today one tenant + one outlet is seeded and all multi-tenant UI is
  hidden. New shop owners can be onboarded later with **no schema change**.
- **Soft delete everywhere:** items, vendors, etc. are hidden with
  `is_active` flags — your data is never destroyed.
- Old bills never change when you edit the menu (name/price/GST are
  snapshotted on each sale line).

## One-time setup (about 20 minutes)

### 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project** (free plan is fine).
   Pick the **Mumbai (ap-south-1)** region.
2. In the dashboard open **SQL Editor** and run these three files from this
   repo, **in order** (copy-paste each one and press Run):
   1. `supabase/migrations/0001_schema.sql` — tables + security rules
   2. `supabase/migrations/0002_functions.sql` — billing/stock logic
   3. `supabase/migrations/0003_seed.sql` — your shop + sample menu & ingredients
3. (Optional) Edit the shop name/address in `0003_seed.sql` before running,
   or later in the `outlets` table via **Table Editor**.
4. In **Authentication → Providers → Email**, keep Email enabled. In
   **Authentication → Email Templates → Magic Link / OTP**, no change needed —
   the app uses the 6-digit code.

### 2. Run locally (optional, for testing on your computer)

```bash
cp .env.example .env.local   # then paste your Supabase URL + anon key into it
npm install
npm run dev                  # open http://localhost:3000
```

Your Supabase URL and anon key are in **Project Settings → API**.

### 3. Deploy to Vercel

1. Push this repository to your GitHub account.
2. Go to [vercel.com](https://vercel.com) → **Add New → Project** → import the repo.
3. Before pressing Deploy, open **Environment Variables** and add exactly:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://YOUR-PROJECT.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your anon key |

4. Press **Deploy**. Vercel gives you a URL like `https://your-shop.vercel.app`.
5. Open that URL on the shop tablet, log in with your email + the 6-digit
   code, and use the browser menu → **Add to Home screen** so it opens like
   an app.

The **first person to log in** is automatically linked to your shop as the
owner (a database trigger does this).

## Daily use

See [`docs/DAILY_GUIDE.md`](docs/DAILY_GUIDE.md) — a one-page guide in
simple English.

## Project layout

```
app/
  login/            Email OTP sign-in
  (app)/dashboard/  Today at a glance
  (app)/pos/        Billing screen (tablet-first)
  (app)/sales/      Bills list + bill view (print / WhatsApp)
  (app)/menu/       Categories & items
  (app)/inventory/  Ingredients, stock in/out
  (app)/vendors/    Vendor master + dues
  (app)/purchases/  Purchase bills + payments
  (app)/expenses/   Expense entry
  (app)/reports/    Date-range reports + CSV export
components/ui/      Reusable buttons, inputs, dialogs (shadcn-style)
lib/                Supabase clients, ₹/date formatting, types
supabase/migrations Database schema, functions, seed data
```

## Phase 2 (already supported by the schema, not built yet)

Multi-tenant onboarding UI, subscriptions, recipe-based automatic stock
deduction, more roles/permissions per user.
