#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-https://api.wx.2000gallery.art}"
ADMIN_BASE_URL="${ADMIN_BASE_URL:-https://wx.ht.2000gallery.art}"

echo "==> API health: ${API_BASE_URL}/api/health"
HEALTH_BODY="$(curl -sf "${API_BASE_URL}/api/health")"
echo "$HEALTH_BODY"
echo "$HEALTH_BODY" | grep -q '"status"'
echo "$HEALTH_BODY" | grep -q 'ok'

echo "==> CORS preflight"
CORS_HEADERS="$(curl -sf -D - -o /dev/null -X OPTIONS \
  "${API_BASE_URL}/api/health" \
  -H "Origin: ${ADMIN_BASE_URL}" \
  -H "Access-Control-Request-Method: GET")"
echo "$CORS_HEADERS" | grep -qi 'access-control-allow-origin'

echo "==> Admin homepage: ${ADMIN_BASE_URL}/"
curl -sf "${ADMIN_BASE_URL}/" | grep -qi '<!DOCTYPE html'

echo "==> All smoke tests passed"
