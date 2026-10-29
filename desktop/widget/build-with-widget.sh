#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
APP_VERSION=${APP_VERSION:-$(cat "$ROOT/VERSION")}
export APP_VERSION
OUTPUT=${1:-"$ROOT/../校园余额-v$APP_VERSION.app"}
DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
export DEVELOPER_DIR
if [ ! -x "$DEVELOPER_DIR/usr/bin/xcodebuild" ]; then echo '需要安装完整版 Xcode。' >&2; exit 1; fi
if [ -e "$OUTPUT" ]; then echo "Output already exists: $OUTPUT" >&2; exit 1; fi
BUILD_DIR=$(mktemp -d "${TMPDIR:-/tmp}/campus-widget-build.XXXXXX")
trap 'rm -rf "$BUILD_DIR"' EXIT HUP INT TERM
xcodebuild -project "$ROOT/desktop/widget/CampusBalanceWidget.xcodeproj" -target CampusBalanceWidget -configuration Release -sdk macosx ARCHS=arm64 CODE_SIGNING_ALLOWED=NO SYMROOT="$BUILD_DIR/products" OBJROOT="$BUILD_DIR/objects" build
WIDGET="$BUILD_DIR/products/Release/CampusBalanceWidget.appex"
if [ ! -d "$WIDGET/Contents/Resources/Metadata.appintents" ]; then echo '组件缺少 App Intents 元数据。' >&2; exit 1; fi
"$ROOT/desktop/build.sh" "$OUTPUT"
mkdir -p "$OUTPUT/Contents/PlugIns"
cp -R "$WIDGET" "$OUTPUT/Contents/PlugIns/"
xcrun swiftc -parse-as-library -O -target arm64-apple-macosx13.5 "$ROOT/desktop/native/WidgetBridge.swift" -o "$OUTPUT/Contents/Resources/CampusWidgetBridge"
codesign --force --sign - "$OUTPUT/Contents/Resources/CampusWidgetBridge"
TOKEN=$(openssl rand -hex 32)
printf '%s' "$TOKEN" > "$OUTPUT/Contents/Resources/widget-token"
chmod 600 "$OUTPUT/Contents/Resources/widget-token"
/usr/libexec/PlistBuddy -c "Add :CampusWidgetToken string $TOKEN" "$OUTPUT/Contents/PlugIns/CampusBalanceWidget.appex/Contents/Info.plist"
xcrun swiftc -target arm64-apple-macosx14.0 -parse-as-library "$ROOT/desktop/widget/SnapshotMerge.swift" "$ROOT/desktop/widget/WriteWidgetSnapshot.swift" -o "$OUTPUT/Contents/Resources/CampusWidgetSnapshot"
codesign --force --sign - "$OUTPUT/Contents/Resources/CampusWidgetSnapshot"
codesign --force --sign - --entitlements "$ROOT/desktop/widget/Widget.entitlements" "$OUTPUT/Contents/PlugIns/CampusBalanceWidget.appex"
codesign --force --sign - --entitlements "$ROOT/desktop/widget/Shared.entitlements" "$OUTPUT"
codesign --verify --deep --strict "$OUTPUT"
echo "Built: $OUTPUT"
