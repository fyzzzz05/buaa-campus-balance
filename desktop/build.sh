#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
VERSION=${APP_VERSION:-$(cat "$ROOT/VERSION")}
OUTPUT=${1:-"$ROOT/../校园余额-v$VERSION.app"}
if ! printf '%s' "$VERSION" | grep -Eq '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'; then echo 'Invalid APP_VERSION' >&2; exit 1; fi
BUILD_VERSION=$(printf '%s' "$VERSION" | awk -F. '{print ($1 * 1000000) + ($2 * 1000) + $3}')
SPARKLE_DIR=$(sh "$ROOT/desktop/prepare-sparkle.sh")
if [ -e "$OUTPUT" ]; then echo "Output already exists: $OUTPUT" >&2; exit 1; fi
mkdir -p "$OUTPUT/Contents/MacOS" "$OUTPUT/Contents/Resources/app" "$OUTPUT/Contents/Frameworks"
cp "$ROOT/desktop/Info.plist" "$OUTPUT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$OUTPUT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_VERSION" "$OUTPUT/Contents/Info.plist"
cp -R "$SPARKLE_DIR/Sparkle.framework" "$OUTPUT/Contents/Frameworks/"
cp -R "$ROOT/public" "$OUTPUT/Contents/Resources/app/"
ICON_DIR=$(mktemp -d "${TMPDIR:-/tmp}/campus-icon.XXXXXXXX")
trap 'rm -rf "$ICON_DIR"' EXIT HUP INT TERM
swift "$ROOT/desktop/make-icon.swift" "$ROOT/desktop/assets/campus-balance-icon.svg" "$ICON_DIR/AppIcon.iconset"
iconutil -c icns "$ICON_DIR/AppIcon.iconset" -o "$OUTPUT/Contents/Resources/AppIcon.icns"
NATIVE_SOURCES="$ROOT/desktop/native"
swiftc -O -parse-as-library -target arm64-apple-macosx13.5 "$NATIVE_SOURCES/CampusHistory.swift" "$NATIVE_SOURCES/Diagnostics.swift" "$NATIVE_SOURCES/SchoolHTTP.swift" "$NATIVE_SOURCES/SchoolHTML.swift" "$NATIVE_SOURCES/SchoolClient.swift" "$NATIVE_SOURCES/Electricity.swift" "$NATIVE_SOURCES/LocalSettings.swift" "$NATIVE_SOURCES/CardFallback.swift" "$NATIVE_SOURCES/NativeDashboard.swift" "$NATIVE_SOURCES/WidgetAgents.swift" "$NATIVE_SOURCES/WidgetSnapshots.swift" "$NATIVE_SOURCES/RefreshBatches.swift" "$NATIVE_SOURCES/NativeServer.swift" -o "$OUTPUT/Contents/Resources/CampusServer"
swiftc -O -parse-as-library -target arm64-apple-macosx13.5 "$NATIVE_SOURCES/CampusHistory.swift" "$NATIVE_SOURCES/Diagnostics.swift" "$NATIVE_SOURCES/SchoolHTTP.swift" "$NATIVE_SOURCES/SchoolHTML.swift" "$NATIVE_SOURCES/SchoolClient.swift" "$NATIVE_SOURCES/Electricity.swift" "$NATIVE_SOURCES/LocalSettings.swift" "$NATIVE_SOURCES/CardFallback.swift" "$NATIVE_SOURCES/NativeDashboard.swift" "$NATIVE_SOURCES/WidgetSnapshots.swift" "$NATIVE_SOURCES/WidgetRefresh.swift" -o "$OUTPUT/Contents/Resources/CampusWidgetRefresh"
swiftc -O -target arm64-apple-macosx13.5 -F "$OUTPUT/Contents/Frameworks" -framework Sparkle -framework AppKit -framework WebKit -framework Security -Xlinker -rpath -Xlinker @executable_path/../Frameworks "$ROOT/desktop/main.swift" -o "$OUTPUT/Contents/MacOS/CampusBalance"
codesign --force --deep --sign - "$OUTPUT" >/dev/null
echo "Built: $OUTPUT"
