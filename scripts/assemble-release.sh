#!/usr/bin/env bash
# Builds one zip per platform from the pkg programs: the program named with the
# version (inside "OpenSet <version>.app" on macOS), the app assets, the
# Remote Script without its tests, VERSION.txt, INSTALL.txt and the PDF guide.
# Used by the release workflow and by scripts/build-release-local.sh.
#
# usage: scripts/assemble-release.sh <version> <dir with openset-linux,
#        openset-win.exe, openset-macos, openset-macos-arm64> <out dir with
#        OpenSet-<version>-Guida.pdf>
set -euo pipefail

VERSION="$1"; BIN="$(cd "$2" && pwd)"; OUT="$(cd "$3" && pwd)"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"
for PLAT in linux-x64 win-x64 macos-x64 macos-arm64; do
  DIR="$(mktemp -d)"
  case "$PLAT" in
    win-x64)     SRC="$BIN/openset-win.exe" ;;
    macos-arm64) SRC="$BIN/openset-macos-arm64" ;;
    *)           SRC="$BIN/openset-${PLAT%-x64}" ;;
  esac
  # app assets (the Remote Script without its tests)
  cp -r public lyrics remote-script README.md "$DIR/"
  rm -rf "$DIR/remote-script/tests"
  find "$DIR/remote-script" -name __pycache__ -prune -exec rm -rf {} +
  # program, named with the version
  case "$PLAT" in
    macos-*)
      # "OpenSet <version>.app" with the icon; the assets go inside it
      bash scripts/make-macos-app.sh "$DIR" "$VERSION" "$SRC" "$DIR/public" "$DIR/lyrics" "$DIR/remote-script" > /dev/null
      rm -rf "$DIR/public" "$DIR/lyrics" ;;
    win-x64) cp "$SRC" "$DIR/openset-$VERSION.exe" ;;
    *)       cp "$SRC" "$DIR/openset-$VERSION"; chmod +x "$DIR/openset-$VERSION" ;;
  esac
  echo "$VERSION" > "$DIR/openset_$VERSION"
  echo "$VERSION" > "$DIR/VERSION.txt"
  case "$PLAT" in
    linux-*) GUIDE=dist-extras/INSTALL-linux.txt ;;
    win-*)   GUIDE=dist-extras/INSTALL-windows.txt ;;
    macos-*) GUIDE=dist-extras/INSTALL-macos.txt ;;
  esac
  sed "s/{{VERSION}}/$VERSION/g" "$GUIDE" > "$DIR/INSTALL.txt"
  cp "$OUT/OpenSet-$VERSION-Guida.pdf" "$DIR/"
  rm -f "$OUT/openset-$VERSION-$PLAT.zip"
  ( cd "$DIR" && zip -rqy "$OUT/openset-$VERSION-$PLAT.zip" . )
  rm -rf "$DIR"
done
ls -la "$OUT"
