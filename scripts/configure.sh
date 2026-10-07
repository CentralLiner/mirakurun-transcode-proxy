#!/bin/sh
set -eu
umask 077

cd "$(dirname "$0")/.."

if [ -e .env ]; then
  echo '.env already exists; it was not changed.' >&2
  exit 0
fi

if [ ! -e /dev/dri/renderD128 ]; then
  echo '/dev/dri/renderD128 was not found. Check that the i915 driver is loaded.' >&2
  exit 1
fi

video_device=/dev/dri/card0
if [ ! -e "$video_device" ]; then
  video_device=/dev/dri/renderD128
fi

video_gid=$(stat -c '%g' "$video_device")
render_gid=$(stat -c '%g' /dev/dri/renderD128)

sed \
  -e "s/^VIDEO_GID=.*/VIDEO_GID=${video_gid}/" \
  -e "s/^RENDER_GID=.*/RENDER_GID=${render_gid}/" \
  .env.example > .env

echo "Created .env (VIDEO_GID=${video_gid}, RENDER_GID=${render_gid})."
echo 'Review MIRAKURUN_URL and BIND_ADDRESS before starting the proxy.'
