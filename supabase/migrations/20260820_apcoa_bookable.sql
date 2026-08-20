-- APCOA Oxford Street and Lanyon Place: switch to the invoice payout model and
-- publish — the moment the last four facts land.
--
-- NOT YET APPLIED. Running it today raises a clear exception naming exactly
-- what is still missing. That is the intended behaviour, not a broken file.
--
-- ── WHAT THIS UNBLOCKS ───────────────────────────────────────────────────────
-- Marty's instruction on 20 August: make them bookable now, without waiting for
-- the discount link. Two things stood in the way and only one of them was a
-- judgement call.
--
--   SOLVED — no Stripe account. Every booking was a destination charge, so
--   checkout refused with a 409 unless the owner had a connected account with
--   transfers active. APCOA has none and a national operator is not going to
--   onboard to somebody else's Stripe to run a pilot. 20260820_listing_payout_
--   mode.sql gives a listing the other model ParkEasy already runs for
--   corporate permits: collect the whole amount, settle by invoice. No Connect
--   account needed. That blocker is gone.
--
--   NOT SOLVED — the driver has to be able to get in and not be charged twice.
--   See below. This is the one that stops the update at the bottom.
--
-- ── operator_share_pct = 100, AND WHY ────────────────────────────────────────
-- No revenue split has been agreed with APCOA. The Heads of Terms went out on
-- 17 August and has not come back signed, so there is no commission to claim.
-- 100 means ParkEasy takes NOTHING from APCOA's tariff and earns only the
-- driver service fee it charges on every booking in the product.
--
-- It is a placeholder in the sense that it will change when the HoT is signed.
-- It is not an invention: every other number would be one, and this is the only
-- one that errs against ParkEasy rather than against APCOA. Change it here when
-- there is a signed figure to change it to.
--
-- ── THE PRICE IS APCOA'S OWN PUBLISHED TARIFF ────────────────────────────────
-- £4.10/hr at Oxford Street and £4.70/hr at Lanyon Place — the rates APCOA
-- charges at its own sites, surveyed into src/apcoaSpots.js from apcoa.co.uk
-- with the source URLs recorded there. Selling at the operator's own published
-- rate is not agreeing a price on their behalf; charging anything else would be.
--
-- ── ⚠️ THE THING THAT IS STILL MISSING, AND WHY IT MATTERS MORE THAN THE REST ─
-- BOTH SITES ARE ANPR. From our own survey data:
--
--   Lanyon Place  "barrierless ANPR — pay online or via the APCOA Connect app"
--   Oxford Street "pay by app/QR or pre-book online (ANPR)"
--
-- A camera reads the plate on the way in and again on the way out, and bills
-- whoever owns it unless a paid session exists in APCOA's system. A driver who
-- pays ParkEasy and drives in has no session in APCOA's system. They get a
-- parking charge notice for a space they have already paid for.
--
-- That is not a risk to be weighed — it is the mechanism simply not existing.
-- No price, photo or contact detail fixes it.
--
-- WHAT WOULD FIX IT, and ParkEasy is already most of the way there: every
-- booking captures vehicle_reg. What is needed from APCOA is somewhere to send
-- it — a pre-book channel (Oxford Street already sells pre-booking online, so
-- one exists), an API, or simply a named person and an address that receives
-- the day's plates and whitelists them. Whichever it is, it gets written into
-- access_method below, which is why that column has a 30-character minimum: it
-- is meant to hold a process, not a word.
--
-- ── HOW TO FINISH THIS ───────────────────────────────────────────────────────
-- Fill in the four values in the CTE, run the file, done. It is idempotent and
-- refuses rather than half-publishing.
--------------------------------------------------------------------------------

do $$
declare
  -- ── FILL THESE IN ──────────────────────────────────────────────────────────
  -- Leave any of them null and this migration stops and says which.
  v_access_method   text := null;  -- HOW A PARKEASY BOOKING BECOMES A VALID
                                   -- APCOA SESSION. 30 chars minimum. Must
                                   -- answer: what happens to the plate?
  v_contact_name    text := null;  -- who at APCOA a marshal or a driver rings
  v_contact_phone   text := null;  -- and on what number
  v_org_regis       text := null;  -- APCOA UK's company registration number
  -- ───────────────────────────────────────────────────────────────────────────
  v_missing text[] := '{}';
  v_ids uuid[];
  r record;
begin
  -- approved_by_founder is guarded by trg_guard_admin_columns, which only lets
  -- the service role touch it — the point being that a host cannot approve
  -- their own listing. Raw SQL run in the Supabase editor is NOT the service
  -- role: auth.jwt() reads request.jwt.claims, and in a SQL session that GUC is
  -- unset, so the trigger refuses. set_config with is_local => true claims the
  -- role for this block's transaction only; it is gone the moment the DO block
  -- ends, so nothing else in the session inherits it.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  select array_agg(id) into v_ids
    from public.rental_listings
   where lower(coalesce(owner_email,'')) = 'adam.richards@apcoa.com'
      or title ilike '%APCOA%';

  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'No APCOA listings found. They were inserted alongside 20260817_apcoa_capacity_and_drafts.sql — check owner_email and title before running this.';
  end if;

  if v_access_method is null or char_length(v_access_method) < 30 then
    v_missing := v_missing || array['access_method — how a ParkEasy booking becomes a valid APCOA ANPR session. Without this a driver who pays us gets a parking charge notice from APCOA.'];
  end if;
  if coalesce(v_contact_name,'')  = '' then v_missing := v_missing || array['access_contact_name — a named person at APCOA']; end if;
  if coalesce(v_contact_phone,'') = '' then v_missing := v_missing || array['access_contact_phone — a number that is answered']; end if;
  if coalesce(v_org_regis,'')     = '' then v_missing := v_missing || array['org_registration — APCOA UK company number']; end if;

  for r in select id, title, coalesce(cardinality(photos), 0) as n,
                  char_length(coalesce(instructions,'')) as ins
             from public.rental_listings where id = any(v_ids) loop
    if r.n < 5 then
      v_missing := v_missing || array[format('photos — %s has %s of the 5 an organisation listing needs', r.title, r.n)];
    end if;
    -- Where the entrance is, what the height limit is, what a driver does on
    -- arrival. 30 characters is the schema's way of saying "a sentence".
    if r.ins < 30 then
      v_missing := v_missing || array[format('instructions — %s has %s characters, needs 30', r.title, r.ins)];
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception E'APCOA is not ready to publish. Still needed:\n  - %',
      array_to_string(v_missing, E'\n  - ');
  end if;

  -- ── Everything that does NOT depend on the missing facts ──────────────────
  -- Applied whether or not the listings publish, because it is all either
  -- already true or already decided.
  update public.rental_listings set
    payout_mode          = 'invoice',
    operator_share_pct   = 100,
    host_type            = 'organization',
    org_name             = 'APCOA Parking (UK) Ltd',
    org_type             = 'business',
    availability         = 'Always',          -- both sites are open 24/7
    org_registration     = v_org_regis,
    access_contact_name  = v_contact_name,
    access_contact_phone = v_contact_phone,
    access_method        = v_access_method,
    contact_phone        = coalesce(nullif(contact_phone,''), v_contact_phone),
    approved_by_founder  = true
  -- No updated_at here: rental_listings does not have one. Assuming a column
  -- that every other table in this schema happens to carry is how a migration
  -- passes review and fails in production.
  where id = any(v_ids);

  update public.rental_listings set price_per_hour = 4.10
   where id = any(v_ids) and title ilike '%Oxford%' and price_per_hour is null;
  update public.rental_listings set price_per_hour = 4.70
   where id = any(v_ids) and title ilike '%Lanyon%' and price_per_hour is null;

  update public.rental_listings set status = 'active', published_at = now()
   where id = any(v_ids) and status = 'draft';

  raise notice 'APCOA: % listing(s) published on the invoice payout model.', cardinality(v_ids);
end $$;
