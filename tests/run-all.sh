#!/usr/bin/env bash
# Everything, in one command.
#
#   tests/run-all.sh
#
# The database tests need a Postgres binary (they spin up a throwaway cluster on
# a socket in /var/tmp and drop it again). Where there isn't one they SKIP loudly
# rather than passing quietly — a suite that silently tests nothing is worse than
# no suite.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0

echo "── Unit ─────────────────────────────────────────────────────────────"
for t in tests/unit/*.test.mjs; do
  node "$t" || fail=1
done

echo "── Database ─────────────────────────────────────────────────────────"
if [ -x "${PGBIN:-/usr/lib/postgresql/16/bin}/initdb" ]; then
  tests/db/run.sh supabase/migrations/20260820_corporate_permits.sql \
                  tests/db/corporate_permits.test.sql              > /tmp/pe-t1.log 2>&1 \
    && echo "  corporate permits      $(grep -c 'PASS  ' /tmp/pe-t1.log) checks" \
    || { fail=1; echo "  corporate permits      FAILED"; grep -m3 -E 'FAIL|ERROR' /tmp/pe-t1.log; }

  tests/db/run.sh supabase/migrations/20260720_spot_submissions.sql \
                  supabase/migrations/20260728_public_approved_spots.sql \
                  supabase/migrations/20260820_hotspot_moderation.sql \
                  tests/db/hotspot_moderation.test.sql              > /tmp/pe-t2.log 2>&1 \
    && echo "  hotspot moderation     $(grep -c 'PASS  ' /tmp/pe-t2.log) checks" \
    || { fail=1; echo "  hotspot moderation     FAILED"; grep -m3 -E 'FAIL|ERROR' /tmp/pe-t2.log; }

  tests/db/run.sh supabase/migrations/20260724_stripe_connect.sql \
                  supabase/migrations/20260820_corporate_permits.sql \
                  supabase/migrations/20260820_car_wash.sql \
                  tests/db/car_wash.test.sql                        > /tmp/pe-t3.log 2>&1 \
    && echo "  car wash               $(grep -c 'PASS  ' /tmp/pe-t3.log) checks" \
    || { fail=1; echo "  car wash               FAILED"; grep -m3 -E 'FAIL|ERROR' /tmp/pe-t3.log; }

  tests/db/run.sh supabase/migrations/20260820_spot_photos.sql \
                  tests/db/spot_photos.test.sql                     > /tmp/pe-t4.log 2>&1 \
    && echo "  spot photos            $(grep -c 'PASS  ' /tmp/pe-t4.log) checks" \
    || { fail=1; echo "  spot photos            FAILED"; grep -m3 -E 'FAIL|ERROR' /tmp/pe-t4.log; }

  tests/db/run.sh supabase/migrations/20260707_promo_codes.sql \
                  supabase/migrations/20260720_spot_submissions.sql \
                  supabase/migrations/20260820_hidden_gems.sql \
                  tests/db/hidden_gems.test.sql                     > /tmp/pe-t5.log 2>&1 \
    && echo "  hidden gems            $(grep -c 'PASS  ' /tmp/pe-t5.log) checks" \
    || { fail=1; echo "  hidden gems            FAILED"; grep -m3 -E 'FAIL|ERROR' /tmp/pe-t5.log; }

  # The seed test needs the seed on disk at the path the test \i-includes.
  cp supabase/migrations/20260820_hidden_gems_seed.sql /tmp/pe-seed.sql
  tests/db/run.sh supabase/migrations/20260707_promo_codes.sql \
                  supabase/migrations/20260720_spot_submissions.sql \
                  supabase/migrations/20260820_hidden_gems.sql \
                  supabase/migrations/20260820_hidden_gems_seed.sql \
                  tests/db/hidden_gems_seed.test.sql                > /tmp/pe-t6.log 2>&1 \
    && echo "  hidden gems seed       $(grep -c 'PASS  ' /tmp/pe-t6.log) checks" \
    || { fail=1; echo "  hidden gems seed       FAILED"; grep -m3 -E 'FAIL|ERROR' /tmp/pe-t6.log; }

  tests/db/run.sh supabase/migrations/20260724_stripe_connect.sql \
                  supabase/migrations/20260725_bookings_functional.sql \
                  supabase/migrations/20260820_overnight_fee_columns.sql \
                  supabase/migrations/20260820_listing_payout_mode.sql \
                  tests/db/listing_payout_mode.test.sql              > /tmp/pe-t7.log 2>&1 \
    && echo "  listing payout mode    $(grep -c 'PASS  ' /tmp/pe-t7.log) checks" \
    || { fail=1; echo "  listing payout mode    FAILED"; grep -m3 -E 'FAIL|ERROR' /tmp/pe-t7.log; }

  tests/db/run.sh supabase/migrations/20260821_partners_table.sql \
                  supabase/migrations/20260803_partners_online.sql \
                  supabase/migrations/20260817_partners_geo_verified.sql \
                  supabase/migrations/20260821_partner_photos_bucket.sql \
                  tests/db/partner_photos.test.sql                   > /tmp/pe-t9.log 2>&1 \
    && echo "  partner photos         $(grep -c 'PASS  ' /tmp/pe-t9.log) checks" \
    || { fail=1; echo "  partner photos         FAILED"; grep -m3 -E 'FAIL|ERROR' /tmp/pe-t9.log; }

  # The APCOA test runs the migration file's real bytes, twice: once as
  # committed (it must refuse) and once with the four missing facts filled in
  # the way a human would fill them (it must publish). The sed is that human.
  cp supabase/migrations/20260820_apcoa_bookable.sql /tmp/pe-apcoa.sql
  sed -e "s/v_access_method   text := null;/v_access_method text := 'Book on ParkEasy; we send your plate to APCOA before 6pm the day before and their ANPR lets you in.';/" \
      -e "s/v_contact_name    text := null;/v_contact_name text := 'A Person';/" \
      -e "s/v_contact_phone   text := null;/v_contact_phone text := '028 9000 0000';/" \
      -e "s/v_org_regis       text := null;/v_org_regis text := '02572793';/" \
      /tmp/pe-apcoa.sql > /tmp/pe-apcoa-filled.sql
  chmod 644 /tmp/pe-apcoa.sql /tmp/pe-apcoa-filled.sql
  tests/db/run.sh supabase/migrations/20260625_rental_listings.sql \
                  supabase/migrations/20260704_listing_requirements.sql \
                  supabase/migrations/20260724_stripe_connect.sql \
                  supabase/migrations/20260725_bookings_functional.sql \
                  supabase/migrations/20260817_apcoa_capacity_and_drafts.sql \
                  supabase/migrations/20260820_overnight_fee_columns.sql \
                  supabase/migrations/20260820_listing_payout_mode.sql \
                  tests/db/apcoa_bookable.test.sql                   > /tmp/pe-t8.log 2>&1 \
    && echo "  apcoa publish gate     $(grep -c 'PASS  ' /tmp/pe-t8.log) checks" \
    || { fail=1; echo "  apcoa publish gate     FAILED"; grep -m3 -E 'FAIL|ERROR' /tmp/pe-t8.log; }

  # The seed goes in BEFORE the region migration on purpose: it is what gives
  # the backfill rows to act on. Without it every row is classified by the
  # trigger instead and a bounding-box backfill passes.
  tests/db/run.sh supabase/migrations/20260707_promo_codes.sql \
                  supabase/migrations/20260720_spot_submissions.sql \
                  supabase/migrations/20260820_hidden_gems.sql \
                  supabase/migrations/20260823_no_free_tasters.sql \
                  tests/db/gem_region_seed.sql \
                  supabase/migrations/20260902_gem_region.sql \
                  tests/db/gem_region.test.sql                      > /tmp/pe-t10.log 2>&1 \
    && echo "  gem region             $(grep -c 'PASS  ' /tmp/pe-t10.log) checks" \
    || { fail=1; echo "  gem region             FAILED"; grep -m3 -E 'FAIL|ERROR' /tmp/pe-t10.log; }

  # The seed goes in BEFORE the migration so its backfill has rows to act on.
  tests/db/run.sh supabase/migrations/20260625_rental_listings.sql \
                  supabase/migrations/20260724_stripe_connect.sql \
                  supabase/migrations/20260725_bookings_functional.sql \
                  supabase/migrations/20260728_booking_vehicle_reg.sql \
                  supabase/migrations/20260820_booking_from_hotspot.sql \
                  tests/db/host_approval_seed.sql \
                  supabase/migrations/20260907_host_approval.sql \
                  tests/db/host_approval.test.sql                   > /tmp/pe-t11.log 2>&1 \
    && echo "  host approval          $(grep -c 'PASS  ' /tmp/pe-t11.log) checks" \
    || { fail=1; echo "  host approval          FAILED"; grep -m3 -E 'FAIL|ERROR' /tmp/pe-t11.log; }

  # Seed first: the grandfathering backfill needs partners that predate it.
  tests/db/run.sh supabase/migrations/20260821_partners_table.sql \
                  tests/db/partner_tiers_seed.sql \
                  supabase/migrations/20260907_partner_tiers.sql \
                  tests/db/partner_tiers.test.sql                   > /tmp/pe-t12.log 2>&1 \
    && echo "  partner tiers          $(grep -c 'PASS  ' /tmp/pe-t12.log) checks" \
    || { fail=1; echo "  partner tiers          FAILED"; grep -m3 -E 'FAIL|ERROR' /tmp/pe-t12.log; }

  tests/db/run.sh supabase/migrations/20260821_partners_table.sql \
                  supabase/migrations/20260907_partner_tiers.sql \
                  supabase/migrations/20260907_partner_stats.sql \
                  tests/db/partner_stats.test.sql                  > /tmp/pe-t13.log 2>&1 \
    && echo "  partner stats          $(grep -c 'PASS  ' /tmp/pe-t13.log) checks" \
    || { fail=1; echo "  partner stats          FAILED"; grep -m3 -E 'FAIL|ERROR' /tmp/pe-t13.log; }

  tests/db/run.sh supabase/migrations/20260625_rental_listings.sql \
                  tests/db/event_pricing_seed.sql \
                  supabase/migrations/20260907_event_pricing.sql \
                  tests/db/event_pricing.test.sql                  > /tmp/pe-t15.log 2>&1 \
    && echo "  event pricing          $(grep -c 'PASS  ' /tmp/pe-t15.log) checks" \
    || { fail=1; echo "  event pricing          FAILED"; grep -m3 -E 'FAIL|ERROR' /tmp/pe-t15.log; }

  tests/db/run.sh supabase/migrations/20260625_rental_listings.sql \
                  supabase/migrations/20260724_stripe_connect.sql \
                  supabase/migrations/20260725_bookings_functional.sql \
                  supabase/migrations/20260728_booking_vehicle_reg.sql \
                  supabase/migrations/20260820_booking_from_hotspot.sql \
                  supabase/migrations/20260707_promo_codes.sql \
                  supabase/migrations/20260720_spot_submissions.sql \
                  supabase/migrations/20260820_hidden_gems.sql \
                  tests/db/hotspot_conversion_seed.sql \
                  supabase/migrations/20260915_hotspot_conversion.sql \
                  tests/db/hotspot_conversion.test.sql             > /tmp/pe-t16.log 2>&1 \
    && echo "  hotspot conversion     $(grep -c 'PASS  ' /tmp/pe-t16.log) checks" \
    || { fail=1; echo "  hotspot conversion     FAILED"; grep -m3 -E 'FAIL|ERROR' /tmp/pe-t16.log; }

  tests/db/run.sh supabase/migrations/20260625_rental_listings.sql \
                  supabase/migrations/20260819_parking_requests.sql \
                  supabase/migrations/20260728_spot_occupancy.sql \
                  supabase/migrations/20260812_spot_claims_heading.sql \
                  tests/db/demand_map_seed.sql \
                  supabase/migrations/20260707_promo_codes.sql \
                  supabase/migrations/20260720_spot_submissions.sql \
                  supabase/migrations/20260820_hidden_gems.sql \
                  supabase/migrations/20260915_demand_map.sql \
                  tests/db/demand_map.test.sql                     > /tmp/pe-t17.log 2>&1 \
    && echo "  demand map             $(grep -c 'PASS  ' /tmp/pe-t17.log) checks" \
    || { fail=1; echo "  demand map             FAILED"; grep -m3 -E 'FAIL|ERROR' /tmp/pe-t17.log; }

  tests/db/run.sh supabase/migrations/20260625_rental_listings.sql \
                  supabase/migrations/20260724_stripe_connect.sql \
                  supabase/migrations/20260725_bookings_functional.sql \
                  supabase/migrations/20260725_season_passes.sql \
                  supabase/migrations/20260728_booking_vehicle_reg.sql \
                  supabase/migrations/20260820_booking_from_hotspot.sql \
                  supabase/migrations/20260907_host_approval.sql \
                  supabase/migrations/20260915_pass_approval.sql \
                  tests/db/pass_approval.test.sql                  > /tmp/pe-t18.log 2>&1 \
    && echo "  pass approval          $(grep -c 'PASS  ' /tmp/pe-t18.log) checks" \
    || { fail=1; echo "  pass approval          FAILED"; grep -m3 -E 'FAIL|ERROR' /tmp/pe-t18.log; }

  tests/db/run.sh tests/db/qr_landing_seed.sql \
                  supabase/migrations/20260907_qr_landing.sql \
                  tests/db/qr_landing.test.sql                     > /tmp/pe-t14.log 2>&1 \
    && echo "  qr landing             $(grep -c 'PASS  ' /tmp/pe-t14.log) checks" \
    || { fail=1; echo "  qr landing             FAILED"; grep -m3 -E 'FAIL|ERROR' /tmp/pe-t14.log; }

  tests/db/run.sh supabase/migrations/20260902_app_events_ingest.sql \
                  tests/db/app_events.test.sql                      > /tmp/pe-t9.log 2>&1 \
    && echo "  app events ingest      $(grep -c 'PASS  ' /tmp/pe-t9.log) checks" \
    || { fail=1; echo "  app events ingest      FAILED"; grep -m3 -E 'FAIL|ERROR' /tmp/pe-t9.log; }

  tests/db/run.sh tests/db/push_subscriptions_seed.sql \
                  supabase/migrations/20260915_push_subscriptions.sql \
                  tests/db/push_subscriptions.test.sql             > /tmp/pe-t19.log 2>&1 \
    && echo "  push subscriptions     $(grep -c 'PASS  ' /tmp/pe-t19.log) checks" \
    || { fail=1; echo "  push subscriptions     FAILED"; grep -m3 -E 'FAIL|ERROR' /tmp/pe-t19.log; }

  tests/db/run.sh tests/db/referrals_seed.sql \
                  supabase/migrations/20260707_promo_codes.sql \
                  supabase/migrations/20260720_spot_submissions.sql \
                  supabase/migrations/20260820_hidden_gems.sql \
                  supabase/migrations/20260918_contribution_points.sql \
                  supabase/migrations/20260918_referrals.sql \
                  tests/db/referrals.test.sql                      > /tmp/pe-t23.log 2>&1 \
    && echo "  referrals              $(grep -c 'PASS  ' /tmp/pe-t23.log) checks" \
    || { fail=1; echo "  referrals              FAILED"; grep -m3 -E 'FAIL|ERROR' /tmp/pe-t23.log; }

  tests/db/run.sh tests/db/contribution_points_seed.sql \
                  supabase/migrations/20260707_promo_codes.sql \
                  supabase/migrations/20260720_spot_submissions.sql \
                  supabase/migrations/20260820_hidden_gems.sql \
                  supabase/migrations/20260918_contribution_points.sql \
                  tests/db/contribution_points.test.sql            > /tmp/pe-t22.log 2>&1 \
    && echo "  contribution points    $(grep -c 'PASS  ' /tmp/pe-t22.log) checks" \
    || { fail=1; echo "  contribution points    FAILED"; grep -m3 -E 'FAIL|ERROR' /tmp/pe-t22.log; }

  tests/db/run.sh tests/db/spot_signals_seed.sql \
                  supabase/migrations/20260720_spot_submissions.sql \
                  supabase/migrations/20260728_public_approved_spots.sql \
                  supabase/migrations/20260820_hotspot_moderation.sql \
                  supabase/migrations/20260917_spot_signals.sql \
                  tests/db/spot_signals.test.sql                   > /tmp/pe-t21.log 2>&1 \
    && echo "  spot signals           $(grep -c 'PASS  ' /tmp/pe-t21.log) checks" \
    || { fail=1; echo "  spot signals           FAILED"; grep -m3 -E 'FAIL|ERROR' /tmp/pe-t21.log; }

  tests/db/run.sh tests/db/parking_timers_seed.sql \
                  supabase/migrations/20260917_parking_timers.sql \
                  tests/db/parking_timers.test.sql                 > /tmp/pe-t20.log 2>&1 \
    && echo "  parking timers         $(grep -c 'PASS  ' /tmp/pe-t20.log) checks" \
    || { fail=1; echo "  parking timers         FAILED"; grep -m3 -E 'FAIL|ERROR' /tmp/pe-t20.log; }

  echo "── Concurrency ──────────────────────────────────────────────────────"
  tests/db/concurrency.sh 2>&1 | grep -E 'permits,|PASSED|FAIL' || fail=1
  tests/db/points_concurrency.sh 2>&1 | grep -E 'redeems|PASSED|FAIL' || fail=1
else
  echo "  SKIPPED — no Postgres at ${PGBIN:-/usr/lib/postgresql/16/bin}."
  echo "  The permit quota and the moderation rules are NOT covered by this run."
fi

echo ""
[ "$fail" = 0 ] && echo "ALL SUITES PASSED" || echo "SOMETHING FAILED"
exit "$fail"
