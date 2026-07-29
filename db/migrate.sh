#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
dir="$(cd "$(dirname "$0")" && pwd)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
  "CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
for f in "$dir"/migrations/*.sql; do
  name="$(basename "$f")"
  if [ -z "$(psql "$DATABASE_URL" -Atc "SELECT 1 FROM schema_migrations WHERE filename='$name'")" ]; then
    echo "applying $name"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f "$f" -c "INSERT INTO schema_migrations(filename) VALUES ('$name')"
  else
    echo "skip $name (applied)"
  fi
done
echo "migrations up to date"
