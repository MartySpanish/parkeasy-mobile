-- Why won't this listing publish?
--
-- NOT YET APPLIED to production.
--
-- THE PROBLEM THIS SOLVES. rental_listings has ELEVEN separate check
-- constraints gating status='active', and Postgres tells you about exactly one
-- of them at a time — whichever it hits first. So publishing a half-finished
-- listing is a guessing game: flip it, read one constraint name, fix that,
-- flip it again, read the next. On an organisation listing that is a
-- twelve-round loop with a cryptic error each time.
--
-- Marty asked to "make APCOA live" and the honest answer is a list, not a no.
-- This is that list, for any listing, produced without having to attempt the
-- update at all.
--
-- Reusable on purpose. APCOA is the case today; Belfast Royal Academy, the next
-- GAA club and every driveway after that hit the same wall, and "what is this
-- listing still missing" is the question every one of them asks.
create or replace view public.listing_publish_readiness
with (security_invoker = true) as
select
  l.id,
  l.title,
  l.status,
  l.host_type,
  -- Each entry is one unmet requirement, named the way a person would say it
  -- rather than the way the constraint is spelled.
  array_remove(array[
    case when char_length(coalesce(l.instructions,'')) < 30
         then 'instructions (need 30+ characters of how to get in)' end,
    case when cardinality(coalesce(l.photos,'{}')) < (case when l.host_type = 'organization' then 5 else 3 end)
         then 'photos (have ' || cardinality(coalesce(l.photos,'{}')) || ', need '
              || (case when l.host_type = 'organization' then 5 else 3 end) || ')' end,
    case when l.lat is null or l.lng is null then 'coordinates' end,
    case when coalesce(l.contact_phone,'') = '' then 'contact_phone' end,
    case when l.availability is null then 'availability (Always / Weekdays / Weekends / Event dates only)' end,
    -- The one that matters most commercially: a listing with no price is a
    -- listing nobody has agreed a price for.
    case when coalesce(l.price_per_hour, l.price_per_day, l.price_per_month) is null
         then 'a price — no rate has been agreed' end,
    case when l.host_type = 'organization' and coalesce(l.org_name,'') = ''
         then 'org_name' end,
    case when l.host_type = 'organization' and l.org_type is null
         then 'org_type (school / church / sports club / business / community centre / other)' end,
    case when l.host_type = 'organization' and coalesce(l.org_registration,'') = ''
         then 'org_registration (company or charity number)' end,
    case when l.host_type = 'organization' and coalesce(l.access_contact_name,'') = ''
         then 'access_contact_name' end,
    case when l.host_type = 'organization' and coalesce(l.access_contact_phone,'') = ''
         then 'access_contact_phone' end,
    case when l.host_type = 'organization' and char_length(coalesce(l.access_method,'')) < 30
         then 'access_method (30+ characters — how a driver actually gets in)' end,
    case when l.host_type = 'organization' and l.approved_by_founder is not true
         then 'founder approval' end
  ], null) as missing,
  -- NOT A CHECK CONSTRAINT, AND THE ONE THAT BITES AFTER THE OTHERS PASS.
  -- api/checkout/create-session.js needs host_accounts.stripe_account_id to
  -- build the destination charge. A listing can satisfy every constraint above,
  -- go live, show a Reserve & pay button — and then fail at the till, which is
  -- the worst place to discover it. Reported here so it is seen at the same
  -- time as everything else.
  exists (
    select 1 from public.host_accounts ha
     where ha.host_id = l.owner_id and ha.transfers_active
  ) as can_be_paid_out
from public.rental_listings l;

grant select on public.listing_publish_readiness to authenticated;

comment on view public.listing_publish_readiness is
  'For any listing: which of the publish requirements it still fails, and whether '
  'its host could actually be paid. `missing` empty AND can_be_paid_out true is '
  'the only state in which status=''active'' both succeeds and means anything.';
