#!/bin/sh
# Production entrypoint: prepare data dir, sync schema, optional demo seed, start API (serves the web app too).
set -e
DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR/uploads"
export DATABASE_URL="${DATABASE_URL:-file:$DATA_DIR/sink.db}"
export UPLOAD_DIR="${UPLOAD_DIR:-$DATA_DIR/uploads}"
echo "Sink on Set: syncing database schema ($DATABASE_URL)"
npx prisma db push --skip-generate
if [ "$SEED_DEMO" = "true" ]; then
  echo "Sink on Set: seeding demo production (idempotent)"
  node dist/prisma/seed.js || true
fi
exec node dist/src/index.js
