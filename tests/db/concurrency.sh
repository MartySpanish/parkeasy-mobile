#!/usr/bin/env bash
# THE TEST THE BRIEF SINGLES OUT: fire simultaneous claims at a 1-permit block
# and assert exactly one succeeds.
#
# This cannot be written inside a single .sql file. One psql session is one
# connection, and the race being tested only exists between connections — so
# this opens N of them, holds them all at a barrier, and releases them at once.
#
# The barrier is an advisory lock: every worker blocks on pg_advisory_lock(1) in
# a separate connection, the parent releases it, and they all pile into
# claim_permit within microseconds of each other. Without the barrier the
# workers start milliseconds apart and the first one is finished before the
# second connects, which is a test that passes whether or not the lock works.
set -euo pipefail

# rental_listings comes from its own migrations now that the harness no longer
# stubs it — corporate_permit_blocks has a foreign key to it.
MIGRATIONS="${MIGRATIONS:-supabase/migrations/20260625_rental_listings.sql supabase/migrations/20260704_listing_requirements.sql supabase/migrations/20260820_corporate_permits.sql}"
WORKERS="${WORKERS:-20}"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="${PGDATA:-/var/tmp/pe-pg-test}"
PGPORT="${PGPORT:-5433}"
PGSOCK="${PGSOCK:-/var/tmp}"
export PGHOST="$PGSOCK" PGPORT PGUSER=postgres
HERE="$(cd "$(dirname "$0")" && pwd)"

if ! "$PGBIN/pg_isready" -q 2>/dev/null; then
  rm -rf "$PGDATA"; mkdir -p "$PGDATA"
  if id postgres >/dev/null 2>&1 && [ "$(id -u)" = "0" ]; then
    chown postgres:postgres "$PGDATA"; chmod 700 "$PGDATA"
    su postgres -c "$PGBIN/initdb -D $PGDATA -A trust -U postgres" >/dev/null
    su postgres -c "$PGBIN/pg_ctl -D $PGDATA -o '-p $PGPORT -k $PGSOCK' -l $PGDATA.log start" >/dev/null
  else
    "$PGBIN/initdb" -D "$PGDATA" -A trust -U postgres >/dev/null
    "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PGPORT -k $PGSOCK" -l "$PGDATA.log" start >/dev/null
  fi
fi

DB="c$(date +%s)$$"
psql -q -c "create database $DB;"
trap 'psql -q -c "drop database if exists $DB;" >/dev/null 2>&1 || true' EXIT
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$HERE/harness.sql"
for m in $MIGRATIONS; do psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$m"; done

run_case () {              # run_case <permits> <workers> <expected winners>
  local permits="$1" workers="$2" expect="$3"
  local out; out="$(mktemp -d)"

  psql -q -d "$DB" -v ON_ERROR_STOP=1 <<EOSQL
-- TRUNCATE, not DELETE. The no-hard-delete trigger on members and claims is
-- doing its job and refuses a DELETE; truncate does not fire row triggers, so
-- the fixture reset works without weakening the guard being relied on
-- everywhere else.
truncate public.permit_claims, public.member_vehicles, public.corporate_members,
         public.corporate_permit_blocks, public.corporate_accounts,
         public.rental_listings, auth.users cascade;

insert into public.rental_listings (id, title, address, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001','Lanyon Place Car Park','Lanyon Place, Belfast','draft');
insert into public.corporate_accounts (id, company_name, billing_contact_email) values
  ('c0000000-0000-0000-0000-000000000001','Acme Ltd','billing@acme.test');
insert into public.corporate_permit_blocks
  (id, corporate_account_id, listing_id, permit_count, monthly_price_pence, operator_share_pct, start_date)
values
  ('b0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', $permits, 12000, 70.00, current_date - 1);
insert into public.corporate_members (corporate_account_id, email, full_name, status)
select 'c0000000-0000-0000-0000-000000000001',
       'staff' || g || '@acme.test', 'Staff ' || g, 'active'
  from generate_series(1, $workers) g;
EOSQL

  # Hold the barrier before any worker starts.
  psql -q -d "$DB" -c "select pg_advisory_lock(1);" >/dev/null &
  local holder=$!
  sleep 0.3

  local i
  for i in $(seq 1 "$workers"); do
    (
      psql -q -d "$DB" -At <<EOSQL >"$out/$i" 2>"$out/$i.err" || true
select pg_advisory_lock(1);
select pg_advisory_unlock(1);
select (public.claim_permit(
          'b0000000-0000-0000-0000-000000000001',
          (select id from public.corporate_members
            where email = 'staff$i@acme.test'),
          current_date + 1,
          'BT21X$i')).id;
EOSQL
    ) &
  done

  sleep 0.6
  kill "$holder" 2>/dev/null || true      # drops the barrier; all workers charge
  wait 2>/dev/null || true

  local claimed
  claimed="$(psql -d "$DB" -At -c \
    "select count(*) from public.permit_claims
      where corporate_permit_block_id='b0000000-0000-0000-0000-000000000001'
        and claim_date = current_date + 1 and status='claimed';")"
  local refused
  # `|| true`: grep exits 1 when nothing matches, and under `set -e -o pipefail`
  # that kills the script — on the one case where NOTHING is refused, which is
  # the case that is supposed to pass.
  refused="$( { grep -l 'fully_booked' "$out"/*.err 2>/dev/null || true; } | wc -l | tr -d ' ')"

  printf '  %2d permits, %2d simultaneous claims -> %s claimed, %s refused as full ... ' \
    "$permits" "$workers" "$claimed" "$refused"
  if [ "$claimed" = "$expect" ]; then
    echo "PASS"
  else
    echo "FAIL (expected $expect)"
    cat "$out"/*.err 2>/dev/null | sort | uniq -c | head
    rm -rf "$out"; exit 1
  fi
  rm -rf "$out"
}

echo ""
echo "Concurrent claims against a fixed quota"
run_case 1 "$WORKERS" 1      # the case that loses the customer
run_case 3 "$WORKERS" 3      # a normal small block
run_case 25 "$WORKERS" "$WORKERS"   # quota above demand: everyone gets one
echo ""
echo "ALL CONCURRENCY CHECKS PASSED"
