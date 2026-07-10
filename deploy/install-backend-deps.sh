#!/usr/bin/env bash
# Install production dependencies on the server; skip when package-lock.json is unchanged.
set -euo pipefail

ROOT_DIR="${1:-/www/wwwroot/art_data}"
LOCK_HASH_FILE="${ROOT_DIR}/.deploy-package-lock.sha256"

cd "$ROOT_DIR"

if [ ! -f package-lock.json ]; then
  echo "ERROR: package-lock.json not found in $ROOT_DIR"
  exit 1
fi

NEW_HASH="$(sha256sum package-lock.json | awk '{print $1}')"
OLD_HASH=""
if [ -f "$LOCK_HASH_FILE" ]; then
  OLD_HASH="$(cat "$LOCK_HASH_FILE")"
fi

if [ "$NEW_HASH" = "$OLD_HASH" ] && [ -d node_modules ]; then
  echo "==> package-lock.json unchanged, skip npm ci"
  exit 0
fi

echo "==> Installing production dependencies (package-lock changed or node_modules missing)"
# Limit Node heap during install on small-memory servers (e.g. 4GB VPS)
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1024}"
export npm_config_audit=false
export npm_config_fund=false

npm ci --omit=dev

echo "$NEW_HASH" > "$LOCK_HASH_FILE"
echo "==> Dependencies installed"
