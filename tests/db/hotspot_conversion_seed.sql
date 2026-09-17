-- app_events and the booking rows this function reads, for the throwaway
-- cluster. app_events has no migration of its own before 20260902; hidden_gems
-- and bookings come from their real chains.
create table if not exists public.app_events (
  id bigserial primary key, event_name text not null, session_id uuid, user_id uuid,
  path text, town text, listing_id uuid, partner_id uuid, value_pence integer,
  props jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
