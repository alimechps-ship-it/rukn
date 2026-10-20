#!/usr/bin/env bash
# Applies the Supabase shim + all migrations to a throw-away local database
# and runs the RLS / permission test-suite.
# Requires a local PostgreSQL superuser connection, e.g.:
#   PGUSER=postgres PGHOST=localhost PGPASSWORD=... npm run test:db
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${TEST_DB:-rukn_test}
dropdb --if-exists "$DB"
createdb "$DB"
P="psql -X -q -v ON_ERROR_STOP=1 -d $DB"
$P -f tests/db/shim.sql >/dev/null
for f in supabase/migrations/*.sql; do
  echo "→ applying $(basename "$f")"
  $P -f "$f" >/dev/null
done
echo "→ running RLS & permission tests"
$P -f tests/db/rls_tests.sql
