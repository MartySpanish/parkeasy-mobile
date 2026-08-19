#!/usr/bin/env bash
# Spin a throwaway Postgres, apply a migration, run a .sql test file against it.
#
#   tests/db/run.sh supabase/migrations/20260820_corporate_permits.sql tests/db/corporate_permits.test.sql
#
# Exists because the one rule this feature cannot get wrong — never issue more
# permits for a date than the block holds — is a CONCURRENCY rule, and a
# concurrency rule asserted in prose is a concurrency rule nobody has tested.
set -euo pipefail
MIGRATION="${1:?usage: run.sh <migration.sql> <test.sql>}"
TEST="${2:?usage: run.sh <migration.sql> <test.sql>}"

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

psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$(dirname "$0")/harness.sql"
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$MIGRATION"
psql    -d "$DB" -v ON_ERROR_STOP=1 -f "$TEST"
