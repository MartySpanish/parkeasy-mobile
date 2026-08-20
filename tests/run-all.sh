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

  echo "── Concurrency ──────────────────────────────────────────────────────"
  tests/db/concurrency.sh 2>&1 | grep -E 'permits,|PASSED|FAIL' || fail=1
else
  echo "  SKIPPED — no Postgres at ${PGBIN:-/usr/lib/postgresql/16/bin}."
  echo "  The permit quota and the moderation rules are NOT covered by this run."
fi

echo ""
[ "$fail" = 0 ] && echo "ALL SUITES PASSED" || echo "SOMETHING FAILED"
exit "$fail"
