#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUTPUT=${1:-"$ROOT/../校园余额.app"}
if [ -e "$OUTPUT" ]; then echo "Output already exists: $OUTPUT" >&2; exit 1; fi
mkdir -p "$OUTPUT/Contents/MacOS" "$OUTPUT/Contents/Resources/app"
cp "$ROOT/desktop/Info.plist" "$OUTPUT/Contents/Info.plist"
cp "$(command -v node)" "$OUTPUT/Contents/Resources/node"
chmod 755 "$OUTPUT/Contents/Resources/node"
cp "$ROOT/dev.js" "$OUTPUT/Contents/Resources/app/"
cp -R "$ROOT/api" "$ROOT/lib" "$ROOT/public" "$ROOT/node_modules" "$OUTPUT/Contents/Resources/app/"
swiftc -O -framework AppKit -framework WebKit -framework Security "$ROOT/desktop/main.swift" -o "$OUTPUT/Contents/MacOS/CampusBalance"
codesign --force --deep --sign - "$OUTPUT" >/dev/null
echo "Built: $OUTPUT"
