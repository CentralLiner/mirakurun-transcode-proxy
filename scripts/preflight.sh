#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo 'docker was not found.' >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo 'Docker Compose v2 was not found.' >&2
  exit 1
fi

if [ ! -r /dev/dri/renderD128 ] || [ ! -w /dev/dri/renderD128 ]; then
  echo '/dev/dri/renderD128 is not readable/writable by the current user.' >&2
  exit 1
fi

docker compose config --quiet
docker compose build
docker compose run --rm --no-deps proxy qsvencc --check-hw

echo 'Compose, image build, and Intel QSV detection succeeded.'
