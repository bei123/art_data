#!/usr/bin/env bash
# Full backend deploy on the Baota server (git sync + deps + restart).
set -euo pipefail

BACKEND_DIR="${BACKEND_DEPLOY_PATH:-/www/wwwroot/art_data}"
BT_NODE_PROJECT_NAME="${BT_NODE_PROJECT_NAME:-art_data}"
GIT_REF="${GIT_REF:-origin/main}"

cd "$BACKEND_DIR"

echo "==> Sync code to ${GIT_REF}"
git fetch origin --tags
git reset --hard "$GIT_REF"

chmod +x deploy/*.sh

bash deploy/install-backend-deps.sh "$BACKEND_DIR"

BT_NODE_PROJECT_NAME="$BT_NODE_PROJECT_NAME" bash deploy/restart-baota-node.sh
