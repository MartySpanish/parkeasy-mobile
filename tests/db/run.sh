#!/usr/bin/env bash
# Spin a throwaway Postgres, apply a migration, run a .sql test file against it.
#
#   tests/db/run.sh supabase/migrations/20260820_corporate_permits.sql tests/db/corporate_permits.test.sql
#
# Exists because the one rule this feature cannot get wrong — never issue more
# permits for a date than the block holds — is a CONCURRENCY rule, and a
# concurrency rule asserted in prose is a concurrency rule nobody has tested.
#   tests/db/run.sh a.sql b.sql c.sql tests/db/x.test.sql
#
# Every argument but the last is a migration, applied in order; the last is the
# test. Several because a migration that ALTERs a table needs the migration that
# created it, and applying the real chain is the only way to find out that an
# ALTER references a column somebody renamed two files ago.
set -euo pipefail
if [ "$#" -lt 2 ]; then
  echo "usage: run.sh <migration.sql> [more.sql ...] <test.sql>" >&2; exit 2
fi
MIGRATIONS=("${@:1:$#-1}")
TEST="${!#}"

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="${PGDATA:-/var/tmp/pe-pg-test}"
PGPORT="${PGPORT:-5433}"
PGSOCK="${PGSOCK:-/var/tmp}"
export PGHOST="$PGSOCK" PGPORT PGUSER=postgres

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

DB="t$(date +%s)$$"
psql -q -c "create database $DB;"
trap 'psql -q -c "drop database if exists $DB;" >/dev/null 2>&1 || true' EXIT

# The harness carries a thin rental_listings stub for the suites that only need
# a table to point a foreign key at. When the REAL migration is in the chain the
# stub has to stand down, or `create table if not exists` no-ops and every later
# ALTER lands on the stub's six columns. Told to the harness through a GUC, so
# the caller never has to remember a flag.
case " ${MIGRATIONS[*]} " in
  *20260625_rental_listings.sql*) export PGOPTIONS="${PGOPTIONS:-} -c parkeasy.real_listings=1" ;;
esac

psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$(dirname "$0")/harness.sql"
for m in "${MIGRATIONS[@]}"; do
  psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$m"
  # Re-applied after each migration: known-drift can only add a column to a
  # table once that table exists, and the tables arrive part-way through the
  # chain. Idempotent, so running it repeatedly costs nothing.
  psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$(dirname "$0")/known-drift.sql"
done
psql    -d "$DB" -v ON_ERROR_STOP=1 -f "$TEST"
