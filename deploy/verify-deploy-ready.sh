#!/usr/bin/env bash
# Pre-flight checks before enabling auto-deploy. Run on server after git pull.
set -euo pipefail

BACKEND_DIR="${BACKEND_DIR:-/www/wwwroot/art_data}"
ADMIN_DIR="${ADMIN_DIR:-/www/wwwroot/wx.ht.2000gallery.art}"
API_URL="${API_BASE_URL:-https://api.wx.2000gallery.art}"
ADMIN_URL="${ADMIN_BASE_URL:-https://wx.ht.2000gallery.art}"

PASS=0
FAIL=0

pass() { echo "[PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "[FAIL] $1"; FAIL=$((FAIL + 1)); }

echo "=== art_data deploy readiness ==="

[ -d "$BACKEND_DIR" ] && pass "Backend dir" || fail "Backend dir missing"
[ -f "$BACKEND_DIR/.env" ] && pass ".env" || fail ".env missing"
[ -f "$BACKEND_DIR/ssl/api.wx.2000gallery.art.key" ] && pass "SSL key" || fail "SSL key missing"
[ -f "$BACKEND_DIR/ssl/api.wx.2000gallery.art.pem" ] && pass "SSL cert" || fail "SSL cert missing"
[ -f "/www/server/nodejs/vhost/scripts/art_data.sh" ] && pass "Baota art_data.sh" || fail "Baota script missing"
[ -x "$BACKEND_DIR/deploy/restart-baota-node.sh" ] && pass "restart script" || fail "restart script missing/not executable"
[ -d "$ADMIN_DIR" ] && pass "Admin dir" || fail "Admin dir missing"

if curl -skf "https://127.0.0.1:2000/api/health" | grep -q '"status"'; then
  pass "Local API health (127.0.0.1:2000)"
else
  fail "Local API health (127.0.0.1:2000)"
fi

if curl -sf "${API_URL}/api/health" | grep -q '"status"'; then
  pass "Public API health ($API_URL)"
else
  fail "Public API health ($API_URL)"
fi

if curl -sf "${ADMIN_URL}/" | grep -qi '<!DOCTYPE html'; then
  pass "Admin homepage ($ADMIN_URL)"
else
  fail "Admin homepage ($ADMIN_URL)"
fi

echo ""
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
