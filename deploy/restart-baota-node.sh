#!/usr/bin/env bash
# Restart art_data via Baota Node project script (non-PM2).
set -euo pipefail

BT_PROJECT_NAME="${BT_NODE_PROJECT_NAME:-art_data}"
BT_SCRIPT="/www/server/nodejs/vhost/scripts/${BT_PROJECT_NAME}.sh"
BT_PID_FILE="/www/server/nodejs/vhost/pids/${BT_PROJECT_NAME}.pid"
PORT="${ART_DATA_PORT:-2000}"
BACKEND_DIR="${BACKEND_DIR:-/www/wwwroot/art_data}"
HEALTH_LIVE_URL="https://127.0.0.1:${PORT}/api/health/live"
HEALTH_MAX_ATTEMPTS="${HEALTH_MAX_ATTEMPTS:-36}"
HEALTH_INTERVAL_SEC="${HEALTH_INTERVAL_SEC:-5}"

if [ ! -f "$BT_SCRIPT" ]; then
  echo "ERROR: Baota start script not found: $BT_SCRIPT"
  echo "Run: ls /www/server/nodejs/vhost/scripts/"
  exit 1
fi

is_port_in_use() {
  if command -v ss >/dev/null 2>&1; then
    ss -tlnp 2>/dev/null | grep -q ":${PORT} "
    return $?
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti:"${PORT}" >/dev/null 2>&1
    return $?
  fi
  curl -sk --connect-timeout 1 "$HEALTH_LIVE_URL" >/dev/null 2>&1
}

stop_node_processes() {
  if [ -f "$BT_PID_FILE" ]; then
    local old_pid
    old_pid="$(cat "$BT_PID_FILE" 2>/dev/null || true)"
    if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
      kill -TERM "$old_pid" 2>/dev/null || true
    fi
  fi

  if command -v pgrep >/dev/null 2>&1; then
    for pid in $(pgrep -f "node index.js" 2>/dev/null || true); do
      cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)"
      if [ "$cwd" = "$BACKEND_DIR" ]; then
        kill -TERM "$pid" 2>/dev/null || true
      fi
    done
  fi
}

wait_for_port_free() {
  local attempt=0
  local max_attempts=30

  while [ "$attempt" -lt "$max_attempts" ]; do
    if ! is_port_in_use; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  echo "WARN: port ${PORT} still in use after ${max_attempts}s, forcing kill"
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${PORT}/tcp" 2>/dev/null || true
  elif command -v lsof >/dev/null 2>&1; then
    lsof -ti:"${PORT}" | xargs -r kill -9 2>/dev/null || true
  fi
  sleep 2
}

wait_for_health_live() {
  local attempt=0

  while [ "$attempt" -lt "$HEALTH_MAX_ATTEMPTS" ]; do
    if curl -skf "$HEALTH_LIVE_URL" 2>/dev/null | grep -q '"status"'; then
      echo "==> API live after $((attempt * HEALTH_INTERVAL_SEC))s"
      return 0
    fi
    attempt=$((attempt + 1))
    echo "==> Waiting for API live... ${attempt}/${HEALTH_MAX_ATTEMPTS}"
    sleep "$HEALTH_INTERVAL_SEC"
  done

  return 1
}

echo "==> Stopping ${BT_PROJECT_NAME}"
stop_node_processes
wait_for_port_free

echo "==> Starting ${BT_PROJECT_NAME}"
bash "$BT_SCRIPT"

echo "==> Health check on ${HEALTH_LIVE_URL}"
if ! wait_for_health_live; then
  echo "ERROR: API did not become live in time"
  tail -n 50 "/www/wwwlogs/nodejs/${BT_PROJECT_NAME}.log" 2>/dev/null || true
  exit 1
fi

echo "==> Restart complete"
