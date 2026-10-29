#!/usr/bin/env bash
# Build the production image and fail unless GET /healthz returns ok.
# Uses a dummy SESSION_SECRET (at least 32 characters, not a demo value),
# NODE_ENV=production, and a temporary directory mounted at /data.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not installed; cannot run pnpm smoke:docker"
  exit 1
fi

image="${SMOKE_IMAGE:-ai-use:smoke}"
name="ai-use-smoke-$$"
port="${SMOKE_PORT:-18765}"
secret="${SMOKE_SESSION_SECRET:-smoke-docker-session-secret-0123456789abcdef}"
secret_lower="$(printf '%s' "$secret" | tr '[:upper:]' '[:lower:]')"

if [ "${#secret}" -lt 32 ]; then
  echo "SESSION_SECRET must be at least 32 characters"
  exit 1
fi
case "$secret_lower" in
  dev-only* | change-me* | changeme*)
    echo "SESSION_SECRET must not be a demo value"
    exit 1
    ;;
esac

data="$(mktemp -d)"
cleanup() {
  # The process chowns /data to uid 1001, so the host user may not own this directory.
  set +e
  docker rm -f "$name" >/dev/null 2>&1
  if [ -n "${data:-}" ] && [ -e "$data" ]; then
    rm -rf "$data" 2>/dev/null
    if [ -e "$data" ]; then
      sudo -n rm -rf "$data" 2>/dev/null
    fi
  fi
}
trap cleanup EXIT

echo "building ${image}"
docker build -t "$image" .

echo "starting ${name} on 127.0.0.1:${port} (NODE_ENV=production, temporary /data)"
docker run -d --name "$name" \
  -e NODE_ENV=production \
  -e SESSION_SECRET="$secret" \
  -e SEED_DEMO_USERS=false \
  -p "127.0.0.1:${port}:3000" \
  -v "$data:/data" \
  "$image" >/dev/null

body=""
for attempt in $(seq 1 30); do
  running="$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || echo false)"
  if [ "$running" != "true" ]; then
    echo "container exited before /healthz returned ok"
    docker logs "$name" || true
    exit 1
  fi
  body="$(curl -fsS --max-time 5 "http://127.0.0.1:${port}/healthz" || true)"
  if printf '%s' "$body" | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true'; then
    printf '%s\n' "$body"
    echo "healthz ok"
    exit 0
  fi
  echo "healthz not ok (attempt ${attempt}/30); retrying in 1s"
  sleep 1
done

echo "http://127.0.0.1:${port}/healthz did not return ok"
printf '%s\n' "$body"
docker logs "$name" || true
exit 1
