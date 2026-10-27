#!/bin/sh
set -eu
VERSION=2.10.1
SHA256=1a856d2a9edb8e628de88121d7be04cf0e2167f8641650b78fca00b14244cf27
DEST=${SPARKLE_ROOT:-"$HOME/Library/Caches/CampusBalance/Sparkle-$VERSION"}
if [ ! -f "$DEST/Sparkle.framework/Versions/B/Sparkle" ] || [ ! -x "$DEST/bin/sign_update" ]; then
  archive=$(mktemp "${TMPDIR:-/tmp}/campus-sparkle.XXXXXXXX")
  trap 'rm -f "$archive"' EXIT HUP INT TERM
  curl --fail --location --silent --show-error --retry 2 "https://github.com/sparkle-project/Sparkle/releases/download/$VERSION/Sparkle-$VERSION.tar.xz" -o "$archive"
  printf '%s  %s\n' "$SHA256" "$archive" | shasum -a 256 -c >/dev/null
  mkdir -p "$DEST"
  tar -xJf "$archive" -C "$DEST"
fi
printf '%s\n' "$DEST"
