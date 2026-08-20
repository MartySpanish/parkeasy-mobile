-- Columns that exist in the production database but that NO migration in this
-- repo creates.
--
-- They were applied by hand, in the Supabase SQL editor or through the table
-- editor, and never written down. That is worth knowing about rather than
-- papering over: it means `supabase/migrations/*` is not, today, sufficient to
-- rebuild the database from nothing, and anybody who assumes it is will find out
-- at the worst moment.
--
-- Applied by tests/db/run.sh AFTER the harness and BEFORE the migrations under
-- test, so a test exercising the real chain does not fail on somebody else's
-- undocumented column. Every entry here is a small debt; the fix is a migration
-- that creates it properly, not a longer list.
--
--   spot_submissions.photo_url — referenced by spots_public in
--   20260728_public_approved_spots.sql, created by nothing.
do $$
begin
  if to_regclass('public.spot_submissions') is not null then
    alter table public.spot_submissions add column if not exists photo_url text;
  end if;
end $$;

--   promo_redemptions.user_id — declared NOT NULL by 20260707_promo_codes.sql
--   and NULLABLE in production. It had to be: Premium bought through a Stripe
--   payment link is linked by the email typed at checkout, and one of the ten
--   live STRIPE-SUB rows has no auth user behind it. Somebody dropped the
--   constraint by hand and did not write it down, so a database rebuilt from
--   this repo would reject a paying subscriber.
--
--   This is the THIRD instance of the same problem, after spot_submissions
--   .photo_url and the nine columns missing from listings_public. Worth saying
--   plainly: supabase/migrations/* cannot currently rebuild this database.
do $$
begin
  if to_regclass('public.promo_redemptions') is not null then
    alter table public.promo_redemptions alter column user_id drop not null;
  end if;
end $$;
