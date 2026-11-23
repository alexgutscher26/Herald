#!/usr/bin/env bash
#
# Gate: tests must exercise real code.
#
# The unit suite is pure logic and the integration suite uses a real
# Postgres database; neither needs a mocked module, a stubbed import or a spy
# in place of an implementation. A match here means a test replaced the thing
# it claims to verify, so the gate fails with the offending lines.
#
# Run from anywhere: `bun run check:no-mocks` or `bash scripts/check-no-mocks.sh`.

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d tests ]; then
  echo "check-no-mocks: tests/ is missing; refusing to pass." >&2
  exit 1
fi

matches=$(
  grep -RnE \
    --include='*.ts' \
    --include='*.tsx' \
    -e '(vi|jest)\.mock[[:space:]]*\(' \
    -e 'mock\.module[[:space:]]*\(' \
    -e '(^|[^A-Za-z0-9_.])mock[[:space:]]*\(' \
    -e 'import[^;]*[[:space:]]mock[[:space:]][^;]*from[[:space:]]*["'"'"']bun:test' \
    tests || true
)

if [ -n "$matches" ]; then
  echo "check-no-mocks: tests must use real implementations, not mocks." >&2
  echo "Found:" >&2
  echo "$matches" >&2
  exit 1
fi

file_count=$(find tests -type f \( -name '*.ts' -o -name '*.tsx' \) | wc -l | tr -d '[:space:]')
echo "check-no-mocks: clean (${file_count} test files scanned)"
