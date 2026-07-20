-- Community spot submissions (from the "Add a Spot" tab).
-- Until now a submission was only emailed to the founder and shown on the
-- submitter's own device — never persisted — so it was invisible in the app
-- and across devices. This table is the durable record the admin dashboard
-- reads (with the service-role key) so submissions can be reviewed.
create extension if not exists pgcrypto;

create table if not exists public.spot_submissions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete set null,
  submitter_name  text,
  submitter_email text,
  near            text,          -- landmark ("what's near this spot")
  street          text,          -- street / area
  type            text,          -- spot type (free / timed / paid …)
  restriction     text,
  notes           text,
  lat             float,
  lng             float,
  has_photo       boolean not null default false,
  status          text not null default 'new',   -- new | approved | rejected
  created_at      timestamptz not null default now()
);

alter table public.spot_submissions enable row level security;

-- Signed-in users may insert their own submission. There is no public select
-- policy — the admin dashboard reads with the service-role key (bypasses RLS).
drop policy if exists "insert own spot submission" on public.spot_submissions;
create policy "insert own spot submission" on public.spot_submissions
  for insert with check (auth.uid() = user_id or user_id is null);

create index if not exists spot_submissions_created_idx on public.spot_submissions (created_at desc);
