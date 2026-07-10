# Running CoffeeTime as a platform

This guide is for **you, the platform operator** — the person who hosts
one CoffeeTime deployment (one Supabase project + one Vercel app) and
onboards coffee shops as clients. Each shop sees only its own data;
isolation is enforced by the database (row-level security), not by app
code.

## How access works

- **Nobody gets in without an invite.** Anyone can request a login code,
  but a login only reaches a shop if that email was invited. Uninvited
  logins see a "no shop linked to this email" screen and nothing else.
- **You** invite the first owner of each shop with `provision_client`
  (below). **Shop owners** invite their own staff from the **Staff**
  page inside the app.
- Because access is invite-gated, it is fine to leave "Allow new users
  to sign up" ON in Supabase — OTP login needs it.

## Onboarding a new client (about 1 minute)

Open the Supabase dashboard → **SQL Editor** and run:

```sql
select public.provision_client(
  'Brew & Bean',            -- shop name
  'owner@brewbean.com',     -- owner's login email
  'Brew & Bean — Kondapur', -- outlet name (optional)
  'Kondapur, Hyderabad',    -- address (optional)
  null,                     -- GSTIN (optional)
  '98490 00000'             -- phone (optional)
);
```

This creates the shop, one outlet, six starter menu categories, and an
owner invite. Then tell the owner to open your app URL and log in with
that exact email — they're in, as the owner, and can build their menu
and invite staff themselves.

Only you can run this: the function is blocked for app users and works
only from the SQL Editor (or a service-role connection).

## Roles

| Ability | Cashier | Manager | Owner |
|---|---|---|---|
| Billing (POS) and viewing bills | ✅ | ✅ | ✅ |
| Dashboard, menu, stock, vendors, purchases, expenses, reports | — | ✅ | ✅ |
| Staff page: invite, change roles, switch accounts on/off | — | — | ✅ |

These limits are enforced in the database, not just hidden in the UI.

## Switching a client off (and back on)

No data is deleted — the shop just can't log in until you switch it
back:

```sql
update public.tenants set is_active = false
where name = 'Brew & Bean';           -- or: where id = '<tenant_id>'
```

Everyone at that shop immediately sees a "shop account is not active"
screen. Set `is_active = true` to restore access, exactly as it was.

To see all your clients:

```sql
select t.id, t.name, t.is_active, t.created_at,
       (select count(*) from public.users u where u.tenant_id = t.id) as staff
from public.tenants t order by t.created_at;
```

## Fixing common situations

**"I sent the invite after they already tried logging in."**
Nothing to fix — when they open the app again (or refresh), the app
claims the pending invite automatically.

**Owner typo'd their email / lost access.** Insert a fresh owner invite
for the correct email:

```sql
insert into public.invites (tenant_id, outlet_id, email, role)
select tenant_id, id, 'correct@email.com', 'owner'
from public.outlets where tenant_id = '<tenant_id>' limit 1;
```

**A user should move to a different shop.** A login belongs to exactly
one shop. Delete their `public.users` row, then invite the same email
from the new shop.

## Upgrading a deployment that existed before migration 0004

Run `supabase/migrations/0004_platform.sql` once in the SQL Editor.
Nothing changes for people already linked to a shop — but from that
moment, **new logins need an invite** (the old "first login joins the
seeded shop as owner" behaviour is gone). All existing users keep the
`owner` role; demote staff to cashier/manager from the Staff page if
you want the limits to apply to them.

## What's still on you (not built yet)

- Charging clients (subscriptions/billing) — `is_active` is your manual
  kill switch for non-payment.
- A web admin panel — onboarding and switching clients off is done in
  the SQL Editor for now.
- Multiple outlets per shop — the schema supports it; the app UI
  assumes one outlet per shop.
