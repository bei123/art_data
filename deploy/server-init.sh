#!/usr/bin/env bash
# One-time server bootstrap for art_data CI/CD (Baota Node project, non-PM2).
# Run on the Baota server as root: bash deploy/server-init.sh
set -euo pipefail

BACKEND_DIR="${BACKEND_DIR:-/www/wwwroot/art_data}"
ADMIN_DIR="${ADMIN_DIR:-/www/wwwroot/wx.ht.2000gallery.art}"
BT_PROJECT_NAME="${BT_NODE_PROJECT_NAME:-art_data}"
BT_SCRIPT="/www/server/nodejs/vhost/scripts/${BT_PROJECT_NAME}.sh"
REPO_URL="${REPO_URL:-https://github.com/bei123/art_data.git}"

echo "=== art_data deploy server init ==="

check_ok() { echo "  OK: $1"; }
check_fail() { echo "  FAIL: $1"; exit 1; }

# 1. Backend directory
if [ -d "$BACKEND_DIR" ]; then
  check_ok "Backend dir exists: $BACKEND_DIR"
else
  echo "Creating $BACKEND_DIR ..."
  mkdir -p "$BACKEND_DIR"
fi

# 2. Git repo
if [ -d "$BACKEND_DIR/.git" ]; then
  check_ok "Git repo present"
  cd "$BACKEND_DIR"
  git remote -v
else
  echo "Cloning repo into $BACKEND_DIR ..."
  git clone "$REPO_URL" "$BACKEND_DIR"
  cd "$BACKEND_DIR"
fi

# 3. Production env
if [ -f "$BACKEND_DIR/.env" ]; then
  check_ok ".env exists"
else
  echo "WARN: .env missing — copy from env.example and fill production values:"
  echo "  cp $BACKEND_DIR/env.example $BACKEND_DIR/.env"
fi

# 4. SSL certs (index.js reads these)
for f in api.wx.2000gallery.art.key api.wx.2000gallery.art.pem; do
  if [ -f "$BACKEND_DIR/ssl/$f" ]; then
    check_ok "ssl/$f"
  else
    echo "WARN: missing $BACKEND_DIR/ssl/$f"
  fi
done

# 5. Baota Node start script
if [ -f "$BT_SCRIPT" ]; then
  check_ok "Baota script: $BT_SCRIPT"
  head -n 5 "$BT_SCRIPT"
else
  check_fail "Baota Node script not found: $BT_SCRIPT"
fi

# 6. Admin static dir
if [ -d "$ADMIN_DIR" ]; then
  check_ok "Admin dir exists: $ADMIN_DIR"
else
  echo "WARN: admin dir missing, creating: $ADMIN_DIR"
  mkdir -p "$ADMIN_DIR"
fi

# 7. Node version
NODE_BIN="/www/server/nodejs/v24.18.0/bin/node"
if [ -x "$NODE_BIN" ]; then
  check_ok "Node: $($NODE_BIN -v)"
else
  echo "WARN: expected Node at $NODE_BIN"
  node -v || true
fi

# 8. Install production deps
cd "$BACKEND_DIR"
echo "==> npm ci --omit=dev"
npm ci --omit=dev

# 9. Deploy SSH key for GitHub Actions
DEPLOY_KEY="$HOME/.ssh/github_actions_deploy"
if [ -f "$DEPLOY_KEY" ]; then
  check_ok "Deploy key already exists: $DEPLOY_KEY"
else
  echo "==> Generating deploy SSH key for GitHub Actions"
  ssh-keygen -t ed25519 -C "github-actions-deploy-art_data" -f "$DEPLOY_KEY" -N ""
  cat "${DEPLOY_KEY}.pub" >> "$HOME/.ssh/authorized_keys"
  chmod 600 "$HOME/.ssh/authorized_keys"
  echo ""
  echo "Add this private key to GitHub Secret SSH_PRIVATE_KEY:"
  echo "----------------------------------------"
  cat "$DEPLOY_KEY"
  echo "----------------------------------------"
fi

# 10. Make deploy scripts executable
chmod +x "$BACKEND_DIR"/deploy/*.sh 2>/dev/null || true

echo ""
echo "=== Server init complete ==="
echo "Next steps:"
echo "  1. GitHub repo → Settings → Secrets: SSH_HOST, SSH_USER=root, SSH_PRIVATE_KEY"
echo "  2. GitHub repo → Settings → Environments → production (optional vars)"
echo "  3. Test restart: cd $BACKEND_DIR && bash deploy/restart-baota-node.sh"
echo "  4. Test smoke:   bash deploy/smoke-test.sh"
echo "  5. Push deploy workflows to main (triggers first auto-deploy)"
