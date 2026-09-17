#!/usr/bin/env bash
# Two taps on Redeem, at the same instant, with exactly one reward's worth of
# points in the ledger.
#
# THIS IS THE ONE THAT COSTS MONEY. redeem_points() reads a balance, then writes
# a spend. Between those two statements a second transaction can read the same
# balance, and both grant thirty days. A hundred points becomes sixty days, and
# a driver who works out that it repeats never pays for Premium again.
#
# It cannot be written inside a single .sql file: one psql session is one
# connection, and the race only exists between connections. So this opens N of
# them, holds them all at a barrier, and releases them at once. Without the
# barrier the workers start milliseconds apart and the first is finished before
# the second connects — a test that passes whether or not the lock works. Same
# construction as concurrency.sh, which tests the permit quota.
set -euo pipefail

WORKERS="${WORKERS:-8}"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="${PGDATA:-/var/tmp/pe-pg-test}"
PGPORT="${PGPORT:-5433}"
PGSOCK="${PGSOCK:-/var/tmp}"
export PGHOST="$PGSOCK" PGPORT PGUSER=postgres
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

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

DB="p$(date +%s)$$"
psql -q -c "create database $DB;"
trap 'psql -q -c "drop database if exists $DB;" >/dev/null 2>&1 || true' EXIT
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$HERE/harness.sql"
for m in 20260707_promo_codes 20260720_spot_submissions 20260820_hidden_gems \
         20260918_contribution_points; do
  psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/migrations/$m.sql"
done

UID_="f0000000-0000-0000-0000-000000000001"

run_case () {              # run_case <rewards affordable> <workers>
  local affordable="$1" workers="$2"
  local out; out="$(mktemp -d)"

  psql -q -d "$DB" -v ON_ERROR_STOP=1 <<EOSQL
truncate public.contribution_points, public.promo_redemptions, auth.users cascade;
insert into auth.users (id, email) values ('$UID_', 'racer@test.local');
-- Exactly enough for \$affordable rewards and not a point more, awarded through
-- the real function so the ledger is the shape production's would be.
select public.award_points('$UID_', 'spot_approved', 'sub-' || g)
  from generate_series(1, (public.point_reward_cost() * $affordable) / 25) g;
EOSQL

  psql -q -d "$DB" -c "select pg_advisory_lock(1);" >/dev/null &
  local holder=$!
  sleep 0.3

  local i
  for i in $(seq 1 "$workers"); do
    (
      psql -q -d "$DB" -At <<EOSQL >"$out/$i" 2>"$out/$i.err" || true
select pg_advisory_lock(1);
select pg_advisory_unlock(1);
select set_config('request.jwt.claim.sub', '$UID_', false);
select set_config('request.jwt.claims', '{"sub":"$UID_","email":"racer@test.local"}', false);
select public.redeem_points() ->> 'ok';
EOSQL
    ) &
  done

  sleep 0.6
  kill "$holder" 2>/dev/null || true      # drops the barrier; all workers charge
  wait 2>/dev/null || true

  local granted balance days
  granted="$(psql -d "$DB" -At -c \
    "select count(*) from public.contribution_points
      where user_id='$UID_' and kind='redeemed';")"
  balance="$(psql -d "$DB" -At -c \
    "select coalesce(sum(points),0) from public.contribution_points where user_id='$UID_';")"
  # The days actually handed out, which is what the race would give away.
  days="$(psql -d "$DB" -At -c \
    "select coalesce(round(extract(epoch from (max(expires_at) - now())) / 86400)::int, 0)
       from public.promo_redemptions where user_id='$UID_' and code='POINTS';")"

  printf '  %d reward(s) affordable, %2d simultaneous redeems -> %s granted, %s days, balance %s ... ' \
    "$affordable" "$workers" "$granted" "$days" "$balance"

  local want_days=$(( affordable * 30 ))
  if [ "$granted" = "$affordable" ] && [ "$days" -le "$want_days" ] && [ "$balance" -ge 0 ]; then
    echo "PASS"
  else
    echo "FAIL (expected $affordable granted, at most $want_days days, balance >= 0)"
    cat "$out"/*.err 2>/dev/null | sort | uniq -c | head
    rm -rf "$out"; exit 1
  fi
  rm -rf "$out"
}

echo ""
echo "Concurrent redemptions against one balance"
run_case 1 "$WORKERS"   # the case that gives Premium away
run_case 2 "$WORKERS"   # enough for two, and not for three
echo ""
echo "ALL POINTS CONCURRENCY CHECKS PASSED"
