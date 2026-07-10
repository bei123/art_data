#!/usr/bin/env bash
# Restart art_data via Baota Node project script (non-PM2).
set -euo pipefail

BT_PROJECT_NAME="${BT_NODE_PROJECT_NAME:-art_data}"
BT_SCRIPT="/www/server/nodejs/vhost/scripts/${BT_PROJECT_NAME}.sh"
BT_PID_FILE="/www/server/nodejs/vhost/pids/${BT_PROJECT_NAME}.pid"
PORT="${ART_DATA_PORT:-2000}"

if [ ! -f "$BT_SCRIPT" ]; then
  echo "ERROR: Baota start script not found: $BT_SCRIPT"
  echo "Run: ls /www/server/nodejs/vhost/scripts/"
  exit 1
fi

echo "==> Stopping ${BT_PROJECT_NAME}"

if [ -f "$BT_PID_FILE" ]; then
  OLD_PID="$(cat "$BT_PID_FILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    kill "$OLD_PID" 2>/dev/null || true
    sleep 2
    if kill -0 "$OLD_PID" 2>/dev/null; then
      kill -9 "$OLD_PID" 2>/dev/null || true
    fi
  fi
fi

# npm run start may leave node listening after npm parent exits
if command -v pgrep >/dev/null 2>&1; then
  for pid in $(pgrep -f "node index.js" 2>/dev/null || true); do
    cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)"
    if [ "$cwd" = "/www/wwwroot/art_data" ]; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  sleep 1
fi

if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
elif command -v lsof >/dev/null 2>&1; then
  lsof -ti:"${PORT}" | xargs -r kill -9 2>/dev/null || true
fi

sleep 1

echo "==> Starting ${BT_PROJECT_NAME}"
bash "$BT_SCRIPT"
sleep 3

echo "==> Health check on https://127.0.0.1:${PORT}/api/health"
if ! curl -skf "https://127.0.0.1:${PORT}/api/health" | grep -q '"status"'; then
  echo "ERROR: API health check failed after restart"
  tail -n 30 "/www/wwwlogs/nodejs/${BT_PROJECT_NAME}.log" 2>/dev/null || true
  exit 1
fi

echo "==> Restart complete"
