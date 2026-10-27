#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUTPUT=${1:-"$ROOT/../校园余额.app"}
VERSION=${APP_VERSION:-1.0.0}
if ! printf '%s' "$VERSION" | grep -Eq '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'; then echo 'Invalid APP_VERSION' >&2; exit 1; fi
BUILD_VERSION=$(printf '%s' "$VERSION" | awk -F. '{print ($1 * 1000000) + ($2 * 1000) + $3}')
SPARKLE_DIR=$(sh "$ROOT/desktop/prepare-sparkle.sh")
if [ -e "$OUTPUT" ]; then echo "Output already exists: $OUTPUT" >&2; exit 1; fi
mkdir -p "$OUTPUT/Contents/MacOS" "$OUTPUT/Contents/Resources/app" "$OUTPUT/Contents/Frameworks"
cp "$ROOT/desktop/Info.plist" "$OUTPUT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$OUTPUT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_VERSION" "$OUTPUT/Contents/Info.plist"
cp -R "$SPARKLE_DIR/Sparkle.framework" "$OUTPUT/Contents/Frameworks/"
cp "$(command -v node)" "$OUTPUT/Contents/Resources/node"
chmod 755 "$OUTPUT/Contents/Resources/node"
cp "$ROOT/dev.js" "$OUTPUT/Contents/Resources/app/"
cp -R "$ROOT/api" "$ROOT/lib" "$ROOT/public" "$ROOT/node_modules" "$OUTPUT/Contents/Resources/app/"
swiftc -O -target arm64-apple-macosx13.5 -F "$OUTPUT/Contents/Frameworks" -framework Sparkle -framework AppKit -framework WebKit -framework Security -Xlinker -rpath -Xlinker @executable_path/../Frameworks "$ROOT/desktop/main.swift" -o "$OUTPUT/Contents/MacOS/CampusBalance"
codesign --force --deep --sign - "$OUTPUT" >/dev/null
echo "Built: $OUTPUT"
