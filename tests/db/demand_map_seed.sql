-- parking_requests and app_events for the throwaway cluster. parking_requests
-- has a real migration; app_events does not predate 20260902, so it is defined
-- here the same way the hotspot-conversion seed does.
create table if not exists public.app_events (
  id bigserial primary key, event_name text not null, session_id uuid, user_id uuid,
  path text, town text, listing_id uuid, partner_id uuid, value_pence integer,
  props jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  slug text, name text, lat double precision, lng double precision,
  active boolean default true, created_at timestamptz default now()
);
