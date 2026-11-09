#!/bin/sh
# Integration test using a disposable signing key, never the release private key.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
APP=${1:?Pass a built macOS app bundle}
SPARKLE_DIR=$(sh "$ROOT/desktop/prepare-sparkle.sh")
WORK=$(mktemp -d "${TMPDIR:-/tmp}/campus-update-test.XXXXXXXX")
trap 'rm -rf "$WORK"' EXIT HUP INT TERM
mkdir "$WORK/content" "$WORK/updates"
cp -R "$APP" "$WORK/content/CampusBalance.app"
PLIST="$WORK/content/CampusBalance.app/Contents/Info.plist"
cat > "$WORK/key.swift" <<'SWIFT'
import Foundation
import CryptoKit
let key = Curve25519.Signing.PrivateKey()
try key.rawRepresentation.base64EncodedString().write(toFile: CommandLine.arguments[1], atomically: true, encoding: .utf8)
print(key.publicKey.rawRepresentation.base64EncodedString())
SWIFT
PUBLIC_KEY=$(swift "$WORK/key.swift" "$WORK/private-key")
/usr/libexec/PlistBuddy -c "Set :SUPublicEDKey $PUBLIC_KEY" "$PLIST"
codesign --force --deep --sign - "$WORK/content/CampusBalance.app"
hdiutil create -volname CampusUpdateTest -srcfolder "$WORK/content" -format UDZO "$WORK/updates/update.dmg" >/dev/null
PREFIX=https://github.com/fyzzzz05/buaa-campus-balance/releases/download/test/
"$SPARKLE_DIR/bin/generate_appcast" --ed-key-file "$WORK/private-key" --maximum-deltas 0 --download-url-prefix "$PREFIX" "$WORK/updates"
"$SPARKLE_DIR/bin/sign_update" --ed-key-file "$WORK/private-key" --verify "$WORK/updates/appcast.xml"
swift "$ROOT/desktop/verify-update.swift" "$PLIST" "$WORK/updates/appcast.xml" "$WORK/updates/update.dmg" "$PREFIX"

# A valid signature made by a different key must not be trusted by the app.
if swift "$ROOT/desktop/verify-update.swift" "$APP/Contents/Info.plist" "$WORK/updates/appcast.xml" "$WORK/updates/update.dmg" "$PREFIX"; then
    echo 'Wrong signing key was accepted' >&2; exit 1
fi

# Change a byte without changing the archive length to exercise signature verification.
python3 - "$WORK/updates/update.dmg" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
data = bytearray(p.read_bytes())
data[0] ^= 1
p.write_bytes(data)
PY
if swift "$ROOT/desktop/verify-update.swift" "$PLIST" "$WORK/updates/appcast.xml" "$WORK/updates/update.dmg" "$PREFIX"; then
    echo 'Modified update archive was accepted' >&2; exit 1
fi
python3 - "$WORK/updates/appcast.xml" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
p.write_text(p.read_text().replace('/download/test/', '/download/modified/'))
PY
if "$SPARKLE_DIR/bin/sign_update" --ed-key-file "$WORK/private-key" --verify "$WORK/updates/appcast.xml"; then
    echo 'Modified update feed was accepted' >&2; exit 1
fi
echo 'Update signing, wrong-key rejection and tamper rejection tests passed'
