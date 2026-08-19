-- ParkEasy for Business — corporate pooled permits.
--
-- NOT YET APPLIED to production. Run this against project bbgqregyogtjzaustbng
-- before deploying the /api/corporate endpoints; they will 500 until it exists.
--
--------------------------------------------------------------------------------
-- THE DOMAIN RULE, WRITTEN DOWN WHERE IT CANNOT BE MISSED
--------------------------------------------------------------------------------
-- A permit here is a RIGHT OF ENTRY AGAINST A QUOTA. It is not a numbered bay
-- and it is not a reservation of a specific space.
--
-- Commercial car park operators oversell deliberately, and their own season
-- ticket terms say so: a season ticket "does not guarantee you a space". What
-- ParkEasy sells an employer is the right for up to N of their staff to enter
-- on any given day, and what ParkEasy guarantees is that it will never issue
-- more than N claims for one date.
--
-- So: no column, view, function, endpoint, screen or email in this feature may
-- use the words "bay", "reserved bay", "your bay" or a bay number. The correct
-- words are "permit", "guaranteed access" and the car park's own name. This is
-- not style. Saying "bay 14 is reserved for you" makes a promise ParkEasy has
-- no power to keep, at a site it does not control.
--------------------------------------------------------------------------------

create extension if not exists pgcrypto;

--------------------------------------------------------------------------------
-- 1. Vehicle registration normalisation
--------------------------------------------------------------------------------
-- One function, used by the claim path, the vehicle table and any backfill, so
-- "BT21ABC", "bt21 abc" and "BT21-ABC" can never be three different vehicles.
-- Stored normalised; the UI is responsible for displaying it formatted.
create or replace function public.normalise_vrn(p_vrn text)
returns text
language sql
immutable
as $$
  select nullif(upper(regexp_replace(coalesce(p_vrn, ''), '[^A-Za-z0-9]', '', 'g')), '');
$$;

--------------------------------------------------------------------------------
-- 2. Tables
--------------------------------------------------------------------------------

-- The employer. Billed by invoice through Stripe Billing — a different flow
-- from the Connect destination charges the driver marketplace uses, because
-- here ParkEasy collects from a company on terms and settles with the operator
-- separately. See operator_settlements at the bottom.
create table if not exists public.corporate_accounts (
  id                    uuid primary key default gen_random_uuid(),
  company_name          text not null,
  billing_contact_name  text,
  billing_contact_email text not null,
  billing_address       text,
  stripe_customer_id    text unique,
  status                text not null default 'active'
                          check (status in ('active','paused','cancelled')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- A block of permits at one car park. permit_count is the QUOTA: the maximum
-- number of staff who may hold a claim for the same date.
create table if not exists public.corporate_permit_blocks (
  id                          uuid primary key default gen_random_uuid(),
  corporate_account_id        uuid not null references public.corporate_accounts(id) on delete cascade,
  listing_id                  uuid not null references public.rental_listings(id) on delete restrict,
  permit_count                integer not null check (permit_count > 0),
  monthly_price_pence         integer not null check (monthly_price_pence >= 0),
  -- What share of the gross goes to the car park operator. Numeric percent
  -- (e.g. 70.00), not a rate, because it is a commercial term somebody types
  -- off a signed sheet and has to be able to read back.
  operator_share_pct          numeric(5,2) not null default 0
                                check (operator_share_pct >= 0 and operator_share_pct <= 100),
  start_date                  date not null,
  end_date                    date,
  status                      text not null default 'active'
                                check (status in ('active','paused','cancelled')),
  -- Stripe Billing. One subscription per block, quantity = permit_count.
  stripe_subscription_id      text unique,
  stripe_subscription_item_id text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint permit_block_dates_ok check (end_date is null or end_date >= start_date)
);

-- Staff. user_id is nullable on purpose: an employer invites by email long
-- before the person signs up, and the invite has to exist in the meantime.
create table if not exists public.corporate_members (
  id                   uuid primary key default gen_random_uuid(),
  corporate_account_id uuid not null references public.corporate_accounts(id) on delete cascade,
  user_id              uuid references auth.users(id) on delete set null,
  email                text not null,
  full_name            text,
  -- Not in the brief, but the employer admin screen it asks for needs somebody
  -- allowed to open it. Without this every member could see every colleague's
  -- email, plate and claim history.
  role                 text not null default 'member' check (role in ('admin','member')),
  status               text not null default 'invited'
                         check (status in ('invited','active','removed')),
  removed_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- One live membership per person per company. Partial, so a removed member can
-- be re-invited later without colliding with their own soft-deleted row.
create unique index if not exists corporate_members_live_email_uniq
  on public.corporate_members (corporate_account_id, lower(email))
  where status <> 'removed';
create index if not exists corporate_members_user_idx
  on public.corporate_members (user_id) where user_id is not null;

-- A member may register more than one vehicle; exactly one is primary.
create table if not exists public.member_vehicles (
  id                  uuid primary key default gen_random_uuid(),
  corporate_member_id uuid not null references public.corporate_members(id) on delete cascade,
  vrn                 text not null,
  is_primary          boolean not null default false,
  created_at          timestamptz not null default now()
);

create unique index if not exists member_vehicles_vrn_uniq
  on public.member_vehicles (corporate_member_id, vrn);
-- At most one primary per member, enforced rather than hoped for.
create unique index if not exists member_vehicles_one_primary
  on public.member_vehicles (corporate_member_id) where is_primary;

-- Normalise on the way in, always, whatever wrote the row.
create or replace function public.member_vehicles_normalise()
returns trigger language plpgsql as $$
begin
  new.vrn := public.normalise_vrn(new.vrn);
  if new.vrn is null then
    raise exception 'A vehicle registration is required.';
  end if;
  return new;
end $$;

drop trigger if exists member_vehicles_normalise_t on public.member_vehicles;
create trigger member_vehicles_normalise_t
  before insert or update of vrn on public.member_vehicles
  for each row execute function public.member_vehicles_normalise();

-- One claim = one member, one day, against one block.
create table if not exists public.permit_claims (
  id                       uuid primary key default gen_random_uuid(),
  corporate_permit_block_id uuid not null references public.corporate_permit_blocks(id) on delete cascade,
  corporate_member_id      uuid not null references public.corporate_members(id) on delete cascade,
  claim_date               date not null,
  -- Snapshot, not a foreign key. The plate handed to the operator for the 3rd
  -- must stay the plate that was on the list for the 3rd, even if the member
  -- changes car in April.
  vrn                      text not null,
  status                   text not null default 'claimed'
                             check (status in ('claimed','cancelled','no_show')),
  created_at               timestamptz not null default now(),
  cancelled_at             timestamptz
);

-- THE BRIEF ASKED FOR A PLAIN UNIQUE (block, member, claim_date). This is that
-- constraint made partial, and the difference matters: claims are soft-deleted
-- and never removed, so a member who cancels Tuesday and then changes their
-- mind would be permanently blocked from re-claiming Tuesday by a total
-- unique. Partial on status='claimed' keeps the rule that actually matters —
-- one LIVE claim per member per day — while leaving the cancel/re-claim
-- history intact, which is what soft delete was for.
create unique index if not exists permit_claims_live_uniq
  on public.permit_claims (corporate_permit_block_id, corporate_member_id, claim_date)
  where status = 'claimed';

-- The index the allocation count runs on, several times per claim.
create index if not exists permit_claims_block_date_idx
  on public.permit_claims (corporate_permit_block_id, claim_date) where status = 'claimed';
create index if not exists permit_claims_member_idx
  on public.permit_claims (corporate_member_id, claim_date desc);

-- Invoices, cached from Stripe so the settlement view has something to sum.
-- Stripe remains the source of truth; this is a readable copy.
create table if not exists public.corporate_invoices (
  id                       uuid primary key default gen_random_uuid(),
  corporate_account_id     uuid references public.corporate_accounts(id) on delete set null,
  corporate_permit_block_id uuid references public.corporate_permit_blocks(id) on delete set null,
  stripe_invoice_id        text unique not null,
  stripe_subscription_id   text,
  amount_due_pence         integer not null default 0,
  amount_paid_pence        integer not null default 0,
  currency                 text not null default 'gbp',
  status                   text not null,      -- Stripe's own: draft|open|paid|uncollectible|void
  period_start             timestamptz,
  period_end               timestamptz,
  hosted_invoice_url       text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists corporate_invoices_block_idx
  on public.corporate_invoices (corporate_permit_block_id, period_start);

--------------------------------------------------------------------------------
-- 3. THE ALLOCATION RULE
--------------------------------------------------------------------------------
-- Two people claiming the last permit at the same moment is the exact failure
-- that loses the customer, and it is not preventable in application code: a
-- count-then-insert from two Node processes interleaves and both see N-1.
--
-- A partial unique index cannot express "at most N rows", and an exclusion
-- constraint cannot count either. What does work is a row lock: every claim
-- against a block takes `SELECT ... FOR UPDATE` on that block's row first, so
-- the count and the insert are serialised per block. Claims against DIFFERENT
-- blocks never touch the same row and so never wait on each other.
--
-- This lives in the database and not behind an endpoint so that a future admin
-- tool, a backfill or a psql session cannot route around it.
create or replace function public.claim_permit(
  p_block_id   uuid,
  p_member_id  uuid,
  p_claim_date date,
  p_vrn        text
)
returns public.permit_claims
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_block   public.corporate_permit_blocks;
  v_member  public.corporate_members;
  v_claimed integer;
  v_vrn     text;
  v_row     public.permit_claims;
begin
  -- THE LOCK. Everything below runs one-at-a-time per block.
  select * into v_block
    from public.corporate_permit_blocks
   where id = p_block_id
   for update;

  if not found then
    raise exception 'block_not_found' using errcode = 'PE001';
  end if;
  if v_block.status <> 'active' then
    raise exception 'block_not_active' using errcode = 'PE002';
  end if;
  if p_claim_date < v_block.start_date
     or (v_block.end_date is not null and p_claim_date > v_block.end_date) then
    raise exception 'date_outside_block' using errcode = 'PE003';
  end if;

  select * into v_member
    from public.corporate_members
   where id = p_member_id;

  if not found or v_member.status <> 'active' then
    raise exception 'member_not_active' using errcode = 'PE004';
  end if;
  -- Company A's staff can never claim against company B's block, whatever the
  -- caller passes in.
  if v_member.corporate_account_id <> v_block.corporate_account_id then
    raise exception 'member_wrong_account' using errcode = 'PE005';
  end if;

  v_vrn := public.normalise_vrn(p_vrn);
  if v_vrn is null then
    raise exception 'vrn_required' using errcode = 'PE006';
  end if;

  select count(*) into v_claimed
    from public.permit_claims
   where corporate_permit_block_id = p_block_id
     and claim_date = p_claim_date
     and status = 'claimed';

  if v_claimed >= v_block.permit_count then
    raise exception 'fully_booked' using errcode = 'PE007';
  end if;

  insert into public.permit_claims
    (corporate_permit_block_id, corporate_member_id, claim_date, vrn, status)
  values
    (p_block_id, p_member_id, p_claim_date, v_vrn, 'claimed')
  returning * into v_row;

  return v_row;
exception
  -- The partial unique index is the second line of defence: it catches the
  -- same member double-claiming one date, which the count above does not.
  when unique_violation then
    raise exception 'already_claimed' using errcode = 'PE008';
end $$;

-- Cancelling. Frees the slot immediately — no cutoff and no charge, because
-- the block is paid monthly whether the permit is used or not, so there is
-- nothing to penalise and every reason to want the day handed back.
create or replace function public.cancel_permit_claim(p_claim_id uuid)
returns public.permit_claims
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row public.permit_claims;
begin
  update public.permit_claims
     set status = 'cancelled', cancelled_at = now()
   where id = p_claim_id and status = 'claimed'
  returning * into v_row;

  if not found then
    raise exception 'claim_not_cancellable' using errcode = 'PE009';
  end if;
  return v_row;
end $$;

--------------------------------------------------------------------------------
-- 4. Guardrails
--------------------------------------------------------------------------------

-- permit_count may be reduced mid-term, but never below the number of claims
-- ALREADY MADE on any future date. Checking only today would let an admin sell
-- the quota out from under next Tuesday's fifteen claims and discover it on
-- Tuesday morning, at the barrier.
create or replace function public.guard_permit_count_reduction()
returns trigger language plpgsql as $$
declare v_peak integer;
begin
  if new.permit_count >= old.permit_count then
    return new;
  end if;

  select coalesce(max(c), 0) into v_peak from (
    select count(*) as c
      from public.permit_claims
     where corporate_permit_block_id = old.id
       and status = 'claimed'
       and claim_date >= current_date
     group by claim_date
  ) peaks;

  if new.permit_count < v_peak then
    raise exception
      'Cannot reduce to % permits: % are already claimed on at least one future date. Cancel claims first.',
      new.permit_count, v_peak
      using errcode = 'PE010';
  end if;
  return new;
end $$;

drop trigger if exists guard_permit_count_reduction_t on public.corporate_permit_blocks;
create trigger guard_permit_count_reduction_t
  before update of permit_count on public.corporate_permit_blocks
  for each row execute function public.guard_permit_count_reduction();

-- Removing a member cancels their future claims and hands those days back to
-- the pool the same moment. Otherwise a leaver silently holds a permit their
-- colleagues cannot use for the rest of the term.
create or replace function public.release_claims_on_member_removal()
returns trigger language plpgsql as $$
begin
  if new.status = 'removed' and old.status <> 'removed' then
    new.removed_at := coalesce(new.removed_at, now());
    update public.permit_claims
       set status = 'cancelled', cancelled_at = now()
     where corporate_member_id = new.id
       and status = 'claimed'
       and claim_date >= current_date;
  end if;
  return new;
end $$;

drop trigger if exists release_claims_on_member_removal_t on public.corporate_members;
create trigger release_claims_on_member_removal_t
  before update of status on public.corporate_members
  for each row execute function public.release_claims_on_member_removal();

-- Never hard-delete a member or a claim: this is billing data and it is how an
-- invoice dispute gets settled six months later. Deletes are blocked outright
-- rather than left to a code review to catch.
create or replace function public.block_hard_delete()
returns trigger language plpgsql as $$
begin
  raise exception
    '% rows are billing data and are soft-deleted, never removed. Set status instead.',
    tg_table_name
    using errcode = 'PE011';
end $$;

drop trigger if exists corporate_members_no_delete on public.corporate_members;
create trigger corporate_members_no_delete
  before delete on public.corporate_members
  for each row execute function public.block_hard_delete();

drop trigger if exists permit_claims_no_delete on public.permit_claims;
create trigger permit_claims_no_delete
  before delete on public.permit_claims
  for each row execute function public.block_hard_delete();

--------------------------------------------------------------------------------
-- 5. Row Level Security
--------------------------------------------------------------------------------
-- A member of company A must never see company B's blocks, staff, plates or
-- invoices. The two helpers are SECURITY DEFINER because the membership test
-- reads corporate_members, and a policy on corporate_members that queried
-- corporate_members would recurse forever.
create or replace function public.is_corporate_member(p_account uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.corporate_members m
     where m.corporate_account_id = p_account
       and m.user_id = auth.uid()
       and m.status = 'active'
  );
$$;

create or replace function public.is_corporate_admin(p_account uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.corporate_members m
     where m.corporate_account_id = p_account
       and m.user_id = auth.uid()
       and m.status = 'active'
       and m.role = 'admin'
  );
$$;

alter table public.corporate_accounts       enable row level security;
alter table public.corporate_permit_blocks  enable row level security;
alter table public.corporate_members        enable row level security;
alter table public.member_vehicles          enable row level security;
alter table public.permit_claims            enable row level security;
alter table public.corporate_invoices       enable row level security;

-- EVERY POLICY BELOW IS SELECT ONLY. There is not a single insert, update or
-- delete policy in this feature, which means an authenticated user cannot write
-- to any of these tables directly no matter what they send. All writes go
-- through the service-role endpoints, where the allocation rule and the
-- guardrails live. Same posture as bookings and host_accounts.

drop policy if exists corporate_accounts_read on public.corporate_accounts;
create policy corporate_accounts_read on public.corporate_accounts
  for select using (public.is_corporate_member(id));

drop policy if exists permit_blocks_read on public.corporate_permit_blocks;
create policy permit_blocks_read on public.corporate_permit_blocks
  for select using (public.is_corporate_member(corporate_account_id));

-- Your own row always; everyone else's only if you administer the company.
-- A colleague's email address is not something an ordinary member needs.
drop policy if exists corporate_members_read on public.corporate_members;
create policy corporate_members_read on public.corporate_members
  for select using (
    user_id = auth.uid() or public.is_corporate_admin(corporate_account_id)
  );

-- Plates are personal data. Your own, or your company admin's view of them.
drop policy if exists member_vehicles_read on public.member_vehicles;
create policy member_vehicles_read on public.member_vehicles
  for select using (exists (
    select 1 from public.corporate_members m
     where m.id = member_vehicles.corporate_member_id
       and (m.user_id = auth.uid() or public.is_corporate_admin(m.corporate_account_id))
  ));

-- Your own claims, or all of them if you administer the company. Note what
-- this deliberately does NOT allow: an ordinary member reading the whole
-- block's claim list to work out availability. Availability comes from
-- /api/corporate/:blockId/availability, which returns counts and no names.
drop policy if exists permit_claims_read on public.permit_claims;
create policy permit_claims_read on public.permit_claims
  for select using (exists (
    select 1 from public.corporate_members m
     where m.id = permit_claims.corporate_member_id
       and (m.user_id = auth.uid() or public.is_corporate_admin(m.corporate_account_id))
  ));

-- Invoices are the admin's business, not the staff's.
drop policy if exists corporate_invoices_read on public.corporate_invoices;
create policy corporate_invoices_read on public.corporate_invoices
  for select using (public.is_corporate_admin(corporate_account_id));

-- GRANTS, STATED RATHER THAN INHERITED. Supabase hands anon and authenticated a
-- blanket grant on new tables in `public` through default privileges, so
-- relying on the default here would silently depend on a project setting nobody
-- in this repo can see. Corporate data is the last thing that should work that
-- way: anon is revoked outright, so a signed-out request is refused at the
-- permission layer before RLS is even consulted, and authenticated gets SELECT
-- only, filtered by the policies above.
revoke all on public.corporate_accounts, public.corporate_permit_blocks,
              public.corporate_members, public.member_vehicles,
              public.permit_claims, public.corporate_invoices
  from anon;
grant select on public.corporate_accounts, public.corporate_permit_blocks,
                public.corporate_members, public.member_vehicles,
                public.permit_claims, public.corporate_invoices
  to authenticated;

-- The claim/cancel functions are SECURITY DEFINER, so they must not be callable
-- straight from the browser with an arbitrary member id — that would let any
-- signed-in user claim as somebody else. Only the service role may execute
-- them, and the endpoints check that the caller owns the member row first.
revoke execute on function public.claim_permit(uuid, uuid, date, text) from public, anon, authenticated;
revoke execute on function public.cancel_permit_claim(uuid) from public, anon, authenticated;

--------------------------------------------------------------------------------
-- 6. operator_settlements
--------------------------------------------------------------------------------
-- What Marty reconciles by hand for the first three months, so: readable, not
-- clever. One row per block per calendar month, showing what came in, what the
-- operator is owed and what ParkEasy keeps.
--
-- IMPORTANT, AND THE WHOLE REASON THIS EXISTS: Stripe Billing does NOT split
-- this money the way a Connect destination charge does. The full invoice lands
-- in ParkEasy's balance and the operator's share has to leave by an explicit
-- Transfer or a bank payment against their invoice. Nothing pays it
-- automatically. This view is the list of what is owed and to whom.
create or replace view public.operator_settlements
with (security_invoker = true) as
select
  b.id                                   as block_id,
  ca.company_name,
  rl.title                               as car_park,
  date_trunc('month', i.period_start)::date as period_month,
  b.permit_count,
  b.operator_share_pct,
  sum(i.amount_paid_pence)               as gross_collected_pence,
  round(sum(i.amount_paid_pence) * b.operator_share_pct / 100)::bigint
                                         as operator_share_due_pence,
  sum(i.amount_paid_pence)
    - round(sum(i.amount_paid_pence) * b.operator_share_pct / 100)::bigint
                                         as parkeasy_net_pence,
  count(*)                               as invoices
from public.corporate_invoices i
join public.corporate_permit_blocks b on b.id = i.corporate_permit_block_id
join public.corporate_accounts ca     on ca.id = b.corporate_account_id
join public.rental_listings rl        on rl.id = b.listing_id
where i.status = 'paid'
group by b.id, ca.company_name, rl.title, date_trunc('month', i.period_start),
         b.permit_count, b.operator_share_pct;

-- security_invoker so the view obeys the RLS above rather than running as its
-- owner and handing every company's numbers to anyone who selects from it.
grant select on public.operator_settlements to authenticated;
