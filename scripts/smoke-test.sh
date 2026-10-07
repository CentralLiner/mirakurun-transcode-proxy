#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

# The container loopback works even when the host port is bound only to a
# Tailscale address. An explicit URL additionally checks the published port.
if [ "$#" -gt 1 ]; then
  echo 'Usage: ./scripts/smoke-test.sh [http://HOST:40773]' >&2
  exit 2
fi

base_url=${1:-}
if [ -n "$base_url" ]; then
  curl --fail --show-error --silent --connect-timeout 5 --max-time 15 "${base_url%/}/healthz"
  echo
  curl --fail --show-error --silent --connect-timeout 5 --max-time 15 "${base_url%/}/api/version"
  echo
else
  docker compose exec -T proxy curl --fail --show-error --silent --connect-timeout 5 --max-time 15 http://127.0.0.1:40773/healthz
  echo
  docker compose exec -T proxy curl --fail --show-error --silent --connect-timeout 5 --max-time 15 http://127.0.0.1:40773/api/version
  echo
fi
docker compose exec -T proxy qsvencc --check-hw
