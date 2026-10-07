#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

profile=${1:-}
case "$profile" in
  stable|low-load|low-bandwidth)
    ;;
  *)
    echo 'Usage: ./scripts/set-tuning-profile.sh stable|low-load|low-bandwidth' >&2
    exit 2
    ;;
esac

if [ ! -f .env ]; then
  echo '.env was not found. Run ./scripts/configure.sh first.' >&2
  exit 1
fi

timestamp=$(date '+%Y%m%d-%H%M%S')
backup=".env.before-${profile}-${timestamp}"
cp .env "$backup"

temporary=$(mktemp "${TMPDIR:-/tmp}/mirakurun-profile.XXXXXX")
trap 'rm -f "$temporary"' EXIT HUP INT TERM

# Remove legacy per-option values so they cannot silently override the named
# profile.  Network, device, logging, crop, and concurrency settings remain.
awk '
  !/^(TRANSCODE_TUNING_PROFILE|TRANSCODE_RATE_CONTROL|TRANSCODE_BITRATE_KBPS|TRANSCODE_MAX_BITRATE_KBPS|TRANSCODE_VBV_BUFFER_KBITS|TRANSCODE_QVBR_QUALITY|TRANSCODE_GOP_LENGTH|TRANSCODE_QUALITY|TRANSCODE_DEINTERLACE|QSVENC_DECODER|QSVENC_INPUT_ANALYZE_SECONDS|QSVENC_INPUT_PROBESIZE|TSREPLACE_REMOVE_TYPED)=/
' .env > "$temporary"

printf '\nTRANSCODE_TUNING_PROFILE=%s\n' "$profile" >> "$temporary"
mv "$temporary" .env
trap - EXIT HUP INT TERM

echo "Applied ${profile}; previous settings were saved to ${backup}."
echo 'Run: docker compose up -d --force-recreate'
