#!/usr/bin/env bash
# Write deploy SSH key and known_hosts for Jenkins agent.
# Requires: SSH_PRIVATE_KEY, SSH_HOST

set -euo pipefail

if [ -z "${SSH_PRIVATE_KEY:-}" ] || [ -z "${SSH_HOST:-}" ]; then
  echo "setup-ssh: SSH_PRIVATE_KEY and SSH_HOST are required" >&2
  exit 1
fi

mkdir -p ~/.ssh
printf '%s\n' "$SSH_PRIVATE_KEY" > ~/.ssh/deploy_key
chmod 600 ~/.ssh/deploy_key
ssh-keyscan -H "$SSH_HOST" >> ~/.ssh/known_hosts 2>/dev/null || true
echo "setup-ssh: ready for $SSH_HOST"
