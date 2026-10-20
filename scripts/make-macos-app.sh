#!/usr/bin/env bash
# Wraps the macOS program in "OpenSet <version>.app": Finder icon, version in
# the name, and a launcher that opens Terminal, so the log stays visible and
# Ctrl+C (or closing the window) quits the server.
# The program, public/ and the other assets go in Contents/Resources: the
# server looks for them next to its own executable.
#
# usage: scripts/make-macos-app.sh <out dir> <version> <program> <asset>...
set -euo pipefail

OUT="$1"; VERSION="$2"; PROGRAM="$3"; shift 3
HERE="$(cd "$(dirname "$0")/.." && pwd)"
APP="$OUT/OpenSet $VERSION.app"
RES="$APP/Contents/Resources"

mkdir -p "$APP/Contents/MacOS" "$RES"
cp "$PROGRAM" "$RES/openset-$VERSION"
chmod +x "$RES/openset-$VERSION"
cp -R "$@" "$RES/"
cp "$HERE/docs/brand/openset.icns" "$RES/OpenSet.icns"
sed "s/{{VERSION}}/$VERSION/g" "$HERE/dist-extras/Info.plist" > "$APP/Contents/Info.plist"

cat > "$APP/Contents/MacOS/OpenSet" <<EOF
#!/bin/bash
exec open -a Terminal "\$(cd "\$(dirname "\$0")/../Resources" && pwd)/openset-$VERSION"
EOF
chmod +x "$APP/Contents/MacOS/OpenSet"
echo "$APP"
