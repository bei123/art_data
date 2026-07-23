#!/usr/bin/env bash
# Write deploy SSH key and known_hosts for Jenkins agent.
# Prefer SSH_KEY_FILE (Jenkins credential path) so the private key is never echoed.
# Fallback: SSH_PRIVATE_KEY (content). Requires SSH_HOST.

set -euo pipefail

if [ -z "${SSH_HOST:-}" ]; then
  echo "setup-ssh: SSH_HOST is required" >&2
  exit 1
fi

mkdir -p ~/.ssh
chmod 700 ~/.ssh

# Disable xtrace while handling secret material
set +x
if [ -n "${SSH_KEY_FILE:-}" ] && [ -f "$SSH_KEY_FILE" ]; then
  cp "$SSH_KEY_FILE" ~/.ssh/deploy_key
elif [ -n "${SSH_PRIVATE_KEY:-}" ]; then
  printf '%s\n' "$SSH_PRIVATE_KEY" > ~/.ssh/deploy_key
else
  echo "setup-ssh: SSH_KEY_FILE or SSH_PRIVATE_KEY is required" >&2
  exit 1
fi
chmod 600 ~/.ssh/deploy_key
set -x

ssh-keyscan -H "$SSH_HOST" >> ~/.ssh/known_hosts 2>/dev/null || true
echo "setup-ssh: ready for $SSH_HOST"
