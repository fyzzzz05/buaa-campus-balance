#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TEST_BINARY=$(mktemp "${TMPDIR:-/tmp}/campus-native-tests.XXXXXX")
BRIDGE_BINARY=$(mktemp "${TMPDIR:-/tmp}/campus-native-bridge.XXXXXX")
trap 'rm -f "$TEST_BINARY" "$BRIDGE_BINARY"' EXIT HUP INT TERM
xcrun swiftc "$ROOT/desktop/native/CampusHistory.swift" "$ROOT/desktop/native/SchoolHTTP.swift" "$ROOT/desktop/native/SchoolHTML.swift" "$ROOT/desktop/native/SchoolClient.swift" "$ROOT/desktop/native/Electricity.swift" "$ROOT/desktop/native/LocalSettings.swift" "$ROOT/tests/native/main.swift" -o "$TEST_BINARY"
"$TEST_BINARY"
xcrun swiftc -parse-as-library "$ROOT/desktop/native/WidgetBridge.swift" -o "$BRIDGE_BINARY"
cd "$ROOT"
CAMPUS_NATIVE_BRIDGE="$BRIDGE_BINARY" node --test tests/widget-bridge.test.js
