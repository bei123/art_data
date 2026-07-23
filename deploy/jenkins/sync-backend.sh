#!/usr/bin/env bash
# SSH to production and sync backend repo; optionally npm ci + Baota restart.
# Requires: SSH_USER, SSH_HOST; key at ~/.ssh/deploy_key
# Env:
#   BACKEND_DEPLOY_PATH   default /www/wwwroot/art_data
#   BT_NODE_PROJECT_NAME  default art_data
#   NEED_BACKEND_RESTART  true|false
#   BACKEND_REF           git ref to reset to (default: origin/main)
#   NODE_AUTH_TOKEN       optional, for GitHub Packages

set -euo pipefail

SSH_USER="${SSH_USER:?}"
SSH_HOST="${SSH_HOST:?}"
BACKEND_DEPLOY_PATH="${BACKEND_DEPLOY_PATH:-/www/wwwroot/art_data}"
BT_NODE_PROJECT_NAME="${BT_NODE_PROJECT_NAME:-art_data}"
NEED_BACKEND_RESTART="${NEED_BACKEND_RESTART:-false}"
BACKEND_REF="${BACKEND_REF:-origin/main}"

REMOTE_SCRIPT=$(cat <<'EOS'
set -euo pipefail
BACKEND="$1"
NEED_RESTART="$2"
BT_NAME="$3"
REF="$4"

cd "$BACKEND"
git fetch origin --tags
git fetch origin main
git reset --hard "$REF"
echo "==> Server repo synced to $(git rev-parse --short HEAD) ($REF)"

if [ "$NEED_RESTART" = "true" ]; then
  chmod +x deploy/*.sh
  bash deploy/install-backend-deps.sh "$BACKEND"
  BT_NODE_PROJECT_NAME="$BT_NAME" bash deploy/restart-baota-node.sh
else
  echo "==> No backend runtime change, skip npm ci / Baota restart"
fi
EOS
)

SSH_OPTS=(-i ~/.ssh/deploy_key -o StrictHostKeyChecking=yes)
if [ -n "${NODE_AUTH_TOKEN:-}" ]; then
  # Export token into remote non-interactive shell for @bei123 packages
  ssh "${SSH_OPTS[@]}" "${SSH_USER}@${SSH_HOST}" \
    "export NODE_AUTH_TOKEN=$(printf '%q' "$NODE_AUTH_TOKEN"); bash -s -- $(printf '%q' "$BACKEND_DEPLOY_PATH") $(printf '%q' "$NEED_BACKEND_RESTART") $(printf '%q' "$BT_NODE_PROJECT_NAME") $(printf '%q' "$BACKEND_REF")" \
    <<< "$REMOTE_SCRIPT"
else
  ssh "${SSH_OPTS[@]}" "${SSH_USER}@${SSH_HOST}" \
    "bash -s -- $(printf '%q' "$BACKEND_DEPLOY_PATH") $(printf '%q' "$NEED_BACKEND_RESTART") $(printf '%q' "$BT_NODE_PROJECT_NAME") $(printf '%q' "$BACKEND_REF")" \
    <<< "$REMOTE_SCRIPT"
fi
