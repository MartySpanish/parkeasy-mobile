-- Partner tiers: the columns have been there for months and nothing sets them.
--
-- partners already carries tier, price_pence, billing_period, sold_at,
-- renewal_due_at, invoice_email and priority. All eleven partners have every
-- one of them null, so today every partner gets the same card for nothing.
--
-- THE TIERS
--   listed     free    — name and pin only. NO card.
--   featured   £25/mo  — card with logo, tagline, photo and link.
--   sponsored  £60/mo  — featured, plus it sorts first inside radius_m, and it
--                        is the one eligible for the booking-confirmation slot
--                        that local_offers was built for.
--
-- THE ONE DANGEROUS PART OF THIS CHANGE, and why the backfill below exists.
--
-- Eleven partners are live, active and in-window right now: Tara Lodge, Paul's
-- Barbers, Gransha Grill, APCOA and the rest. Their tier is null. If null falls
-- through to 'listed' — which is what a sensible default would do — then the
-- moment this ships, every one of those cards disappears from the app. Nobody
-- asked for that, the businesses were not told, and the first anybody would
-- hear of it is a barber ringing to ask where his listing went.
--
-- So they are GRANDFATHERED to 'featured' explicitly, as a row change that can
-- be read in the table rather than an implicit default that has to be reasoned
-- about. What they pay is a separate conversation Marty can have one at a time;
-- what this migration must not do is change what a driver sees today.
--
-- New partners default to 'listed', because a partner who has not agreed to pay
-- should not arrive holding a paid placement.

begin;

-- FIRST: the column already meant something else.
--
-- 20260821_partners_table.sql defined tier as
-- ('local','town','county','event','founding') — a reach-based vocabulary
-- (a partner shown across a town costs more than one shown on a street). It
-- was never populated: all eleven partners have tier null, and no code reads
-- it. So nothing is lost by replacing it, and carrying two tier columns to
-- keep an idea nobody has used would be worse than picking one.
--
-- This migration repurposes it to the pricing vocabulary in the build brief.
-- If the reach idea comes back it belongs in its own column beside radius_m,
-- which is where the reach actually lives today.
alter table public.partners drop constraint if exists partners_tier_chk;

alter table public.partners
  add column if not exists stripe_customer_id     text,
  add column if not exists stripe_subscription_id text,
  -- Set when a payment fails. The tier is not dropped on the first failure —
  -- a card expiring on a Tuesday is not a cancellation — but after the grace
  -- window in the webhook it falls back to 'listed'.
  add column if not exists payment_failed_at      timestamptz;

-- Grandfather the live ones FIRST, before the default exists, so the update
-- cannot be confused with rows that arrived carrying it.
update public.partners
   set tier = 'featured'
 where tier is null
   and active = true;

-- Anything left (inactive, never launched) is a free listing.
update public.partners set tier = 'listed' where tier is null;

alter table public.partners alter column tier set default 'listed';
alter table public.partners alter column tier set not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'partners_tier_chk') then
    alter table public.partners add constraint partners_tier_chk
      check (tier in ('listed', 'featured', 'sponsored'));
  end if;
end $$;

comment on column public.partners.tier is
  'listed (free, no card) | featured (£25/mo, card) | sponsored (£60/mo, card + '
  'sorts first + booking-confirmation slot). Defaults to listed: a partner who '
  'has not agreed to pay does not arrive holding a paid placement.';

-- The card query is "a paying tier, near this listing, live right now".
create index if not exists partners_paid_tier_idx
  on public.partners (tier)
  where tier in ('featured', 'sponsored');

do $$
declare n integer;
begin
  select count(*) into n from public.partners where tier is null;
  if n > 0 then raise exception '% partners still have no tier', n; end if;

  -- The check that matters: nobody who had a card yesterday lost it today.
  select count(*) into n from public.partners
   where active = true and tier not in ('featured', 'sponsored');
  if n > 0 then
    raise exception '% active partners were downgraded out of a card by this migration', n;
  end if;
  raise notice 'partner tiers: % active partners grandfathered to featured',
    (select count(*) from public.partners where active and tier = 'featured');
end $$;

commit;
