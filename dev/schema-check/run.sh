#!/usr/bin/env bash
# Manual integration check; requires Docker and Git, but no local psql or database.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
check_dir="$repo_root/dev/schema-check"
baseline=b35a235
container="pf-schema-check-$$-$RANDOM"
scratch=$(mktemp -d)
started=false
cleanup() {
  if "$started"; then docker rm -f "$container" >/dev/null 2>&1 || true; fi
  rm -rf "$scratch"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Pin the pre-owner-keys schema so this keeps exercising a real upgrade after merge.
git -C "$repo_root" show "$baseline:backend/supabase/schema.sql" > "$scratch/original.sql"
docker run --detach --rm --name "$container" --network none \
  --tmpfs /var/lib/postgresql/data:rw \
  --env POSTGRES_PASSWORD=schema-check-fixture postgres:16 > /dev/null
started=true
ready=false
for ((attempt=0; attempt<60; attempt++)); do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if ! "$ready"; then
  docker logs "$container" >&2
  echo 'Postgres did not become ready.' >&2
  exit 1
fi

run_sql() {
  local database=$1 label=$2 input=$3
  if ! docker exec -i "$container" psql -X --quiet -v ON_ERROR_STOP=1 \
      -U postgres -d "$database" < "$input" > "$scratch/$label.log" 2>&1; then
    cat "$scratch/$label.log" >&2
    echo "FAIL: $label" >&2
    exit 1
  fi
}

cat > "$scratch/setup.sql" <<'SQL'
create role anon nologin;
create role authenticated nologin;
create database schema_upgrade;
create database schema_fresh;
SQL
run_sql postgres setup "$scratch/setup.sql"

for path in upgrade fresh; do
  database="schema_$path"
  if [[ $path == upgrade ]]; then
    run_sql "$database" original "$scratch/original.sql"
    run_sql "$database" seed-upgrade "$check_dir/seed.sql"
  fi
  run_sql "$database" "$path-install" "$repo_root/backend/supabase/schema.sql"
  run_sql "$database" "$path-idempotent" "$repo_root/backend/supabase/schema.sql"
  if [[ $path == fresh ]]; then
    run_sql "$database" seed-fresh "$check_dir/seed.sql"
  fi
  run_sql "$database" "$path-assertions" "$check_dir/assertions.sql"
  count=$(awk '/SCHEMA_CHECK_PASS/ { n++ } END { print n+0 }' "$scratch/$path-assertions.log")
  echo "PASS: $path ($count assertions; schema applied twice)"
done
echo 'PASS: Postgres 16 fresh install and in-place upgrade; throwaway container removed on exit.'
