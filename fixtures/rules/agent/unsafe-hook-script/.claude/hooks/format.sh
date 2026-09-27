#!/bin/sh
# ok: comment lines are skipped, even when they mention rm -rf $DIR/
rm -rf "$BUILD_DIR" # ok: quoted variable
rm -rf $OUT_DIR/* # expect-warn: agent/unsafe-hook-script
npx prettier --write "$1" # ok: formatter
