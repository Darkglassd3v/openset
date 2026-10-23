#!/usr/bin/env bash
# Local release build, for when the GitHub release cannot be used (artifact
# space full): the four versioned zips and the PDF guide in build/release-<version>/.
# The programs are Node single executables (scripts/build-sea.mjs). Built on Linux the
# Mac programs cannot be signed: the app launcher signs them ad hoc on the Mac the first time.
#
# usage: scripts/build-release-local.sh   (from any folder; needs zip and Chrome/Chromium)
set -euo pipefail

cd "$(dirname "$0")/.."
VERSION="$(node -p "require('./package.json').version")"
OUT="build/release-$VERSION"
mkdir -p "$OUT"
npm test
python3 -m unittest discover -s remote-script/tests
node scripts/build-sea.mjs --out build
node scripts/win-icon.mjs --check build/openset-win.exe
node scripts/build-guide.js "$OUT/OpenSet-$VERSION-Guida.pdf"
bash scripts/assemble-release.sh "$VERSION" build "$OUT"
