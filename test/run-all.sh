#!/bin/sh
# Runs the whole project suite: editor (Node) + firmware (native gcc).
#
#   sh test/run-all.sh
#
# The firmware tests need neither the ARM toolchain nor the board: everything
# marked "C portable" (vm/, storage/, proto/) compiles with the host's gcc.
#
# There is deliberately NO package.json: this repo deploys as a static site
# (vercel.json), and adding one would change Vercel's build detection.
set -e

ROOT=$(cd "$(dirname "$0")/.." && pwd)

# Only *.test.js. Passing the directory makes node treat every .js under it as a
# test file, so the helpers and fixtures ran as suites with zero tests — noise that
# makes a genuinely empty file impossible to spot.
echo "=== Editor (node:test) ==="
node --test "$ROOT"/test/*.test.js

echo
echo "=== Firmware (host tests) ==="
make -C "$ROOT/firmware/tests/host" test

echo
echo "OK: the whole suite passed."
