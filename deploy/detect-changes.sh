#!/usr/bin/env bash
# Detect frontend / backend path changes between BEFORE and AFTER commits.
# Env:
#   BEFORE          - older SHA (optional)
#   AFTER           - newer SHA (default: HEAD)
#   FORCE_FULL      - if "true", treat as full deploy
#   OUTPUT_FILE     - write KEY=VALUE lines (default: stdout via DETECT_*)
# Prints and optionally writes: frontend=true|false, backend=true|false, mode=...

set -euo pipefail

FORCE_FULL="${FORCE_FULL:-false}"
AFTER="${AFTER:-$(git rev-parse HEAD)}"
BEFORE="${BEFORE:-}"
OUTPUT_FILE="${OUTPUT_FILE:-}"

if [ "$FORCE_FULL" = "true" ]; then
  frontend=true
  backend=true
  mode=full
else
  if [ -z "$BEFORE" ] || [[ "$BEFORE" =~ ^0+$ ]]; then
    BEFORE="$(git rev-parse "${AFTER}^" 2>/dev/null || true)"
  fi

  if [ -z "$BEFORE" ] || [[ "$BEFORE" =~ ^0+$ ]]; then
    echo "No usable before SHA, default to full deploy" >&2
    frontend=true
    backend=true
    mode=full
  else
    mapfile -t FILES < <(git diff --name-only "$BEFORE" "$AFTER" || true)
    echo "Diff $BEFORE..$AFTER (${#FILES[@]} files)" >&2
    printf '  %s\n' "${FILES[@]:-}" >&2

    frontend=false
    backend=false

    is_frontend() {
      case "$1" in
        src/*|public/*|index.html|vite.config.js|components.json|tsconfig.json|favicon.ico)
          return 0 ;;
        package.json|package-lock.json)
          return 0 ;;
        *)
          return 1 ;;
      esac
    }

    is_backend() {
      case "$1" in
        index.js|auth.js|db.js|schema.sql|.nvmrc|.env.production.example)
          return 0 ;;
        routes/*|services/*|middleware/*|utils/*|config/*|sql/*|scripts/*)
          return 0 ;;
        package.json|package-lock.json)
          return 0 ;;
        *)
          return 1 ;;
      esac
    }

    for f in "${FILES[@]:-}"; do
      [ -z "$f" ] && continue
      if is_frontend "$f"; then frontend=true; fi
      if is_backend "$f"; then backend=true; fi
    done

    if [ "$frontend" = "true" ] && [ "$backend" = "true" ]; then
      mode=full
    elif [ "$frontend" = "true" ]; then
      mode=frontend
    elif [ "$backend" = "true" ]; then
      mode=backend
    else
      mode=pull-only
    fi
  fi
fi

echo "Deploy mode=$mode frontend=$frontend backend=$backend" >&2

RESULT="$(cat <<EOF
frontend=$frontend
backend=$backend
mode=$mode
EOF
)"

if [ -n "$OUTPUT_FILE" ]; then
  printf '%s\n' "$RESULT" > "$OUTPUT_FILE"
fi

printf '%s\n' "$RESULT"
