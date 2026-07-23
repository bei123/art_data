#!/usr/bin/env bash
# rsync local dist/ to admin static path on Baota server.
# Requires: SSH_USER, SSH_HOST, ADMIN_DEPLOY_PATH; key at ~/.ssh/deploy_key

set -euo pipefail

SSH_USER="${SSH_USER:?}"
SSH_HOST="${SSH_HOST:?}"
ADMIN_DEPLOY_PATH="${ADMIN_DEPLOY_PATH:-/www/wwwroot/wx.ht.2000gallery.art/}"

if [ ! -d dist ]; then
  echo "rsync-admin: dist/ missing" >&2
  exit 1
fi

rsync -avzr --delete \
  --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r \
  --exclude='.user.ini' \
  --filter='protect .user.ini' \
  -e "ssh -i ~/.ssh/deploy_key -o StrictHostKeyChecking=yes" \
  dist/ \
  "${SSH_USER}@${SSH_HOST}:${ADMIN_DEPLOY_PATH}"
