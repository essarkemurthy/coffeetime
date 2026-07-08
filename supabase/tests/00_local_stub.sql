-- ============================================================
-- Local-testing stub: minimal Supabase environment on plain
-- PostgreSQL, so the migrations and business logic can be
-- tested without a running Supabase stack.
--
-- NOT for production — Supabase provides all of this itself.
-- Run against a FRESH database, before the migrations.
-- ============================================================

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  created_at timestamptz not null default now()
);

-- Supabase resolves auth.uid() from the request JWT; locally we
-- read it from a session setting that tests control directly.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- The role PostgREST uses for logged-in users.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

grant usage on schema public to authenticated;
grant usage on schema auth to authenticated;

-- Tables/functions created by the migrations after this point
-- get the same default grants Supabase applies.
alter default privileges in schema public grant all on tables to authenticated;
alter default privileges in schema public grant all on sequences to authenticated;
alter default privileges in schema public grant execute on functions to authenticated;
