#!/usr/bin/env bash
# Local release build, for when the GitHub release cannot be used (artifact
# space full): the four versioned zips and the PDF guide in build/release-<version>/.
# On Linux the macOS arm64 program cannot be signed: the app launcher signs it
# ad hoc on the Mac the first time (codesign ships with macOS).
#
# usage: scripts/build-release-local.sh   (from any folder; needs zip and Chrome/Chromium)
set -euo pipefail

cd "$(dirname "$0")/.."
VERSION="$(node -p "require('./package.json').version")"
OUT="build/release-$VERSION"
mkdir -p "$OUT"
npm test
python3 -m unittest discover -s remote-script/tests
# OpenSet icon and version in the Windows program (patches pkg's base binary).
# The binary patched by an earlier build goes first, or pkg-fetch would reuse it
rm -f "${PKG_CACHE_PATH:-$HOME/.pkg-cache}"/v3.4/built-v18*-win-x64
npx -y pkg-fetch@3.4.2 -n node18 -p win -a x64
npm install --no-save resedit@3.1.0
node scripts/win-icon.mjs
npx -y pkg@5.8.1 . --targets node18-linux-x64,node18-win-x64,node18-macos-x64 --out-path build
# an x64 host cannot compile arm64 bytecode (pkg would drop every file): plain sources instead
npx -y pkg@5.8.1 . --targets node18-macos-arm64 --output build/openset-macos-arm64 --no-bytecode --public-packages "*" --public
node scripts/win-icon.mjs --check build/openset-win.exe
node scripts/build-guide.js "$OUT/OpenSet-$VERSION-Guida.pdf"
bash scripts/assemble-release.sh "$VERSION" build "$OUT"
