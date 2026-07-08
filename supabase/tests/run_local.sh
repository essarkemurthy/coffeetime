#!/usr/bin/env bash
# Runs the migrations + smoke test against a throwaway local
# PostgreSQL database. Usage:  bash supabase/tests/run_local.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

DB=coffeetime_test
RUN="su postgres -c"

$RUN "dropdb --if-exists $DB"
$RUN "createdb $DB"

echo "--- applying local Supabase stub"
$RUN "psql -v ON_ERROR_STOP=1 -q -d $DB -f supabase/tests/00_local_stub.sql"

for f in supabase/migrations/*.sql; do
  echo "--- applying $f"
  $RUN "psql -v ON_ERROR_STOP=1 -q -d $DB -f $f"
done

echo "--- running smoke test"
$RUN "psql -v ON_ERROR_STOP=1 -q -d $DB -f supabase/tests/01_smoke_test.sql"
