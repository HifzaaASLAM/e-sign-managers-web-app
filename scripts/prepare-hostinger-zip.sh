#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCHIVE_PATH="$(dirname "$PROJECT_ROOT")/esign-saas-hostinger.tar.gz"
STAGING="$(mktemp -d /tmp/esign-saas-hostinger-XXXXXX)"

echo "Staging at $STAGING"
tar -C "$PROJECT_ROOT" \
  --exclude=node_modules \
  --exclude=.next \
  --exclude=.git \
  --exclude=out \
  --exclude=build \
  --exclude=dist \
  --exclude='*.zip' \
  --exclude=.env \
  --exclude=.env.local \
  --exclude=.env.development.local \
  --exclude=.env.test.local \
  --exclude=.env.production.local \
  --exclude=.env.production \
  -cf - . | tar -C "$STAGING" -xf -
find "$STAGING/scripts" -maxdepth 1 -type d -name '.check-work*' -exec rm -rf {} + 2>/dev/null || true

rm -f "$ARCHIVE_PATH"
tar -C "$STAGING" -czf "$ARCHIVE_PATH" .
rm -rf "$STAGING"
echo "Created $ARCHIVE_PATH ($(stat -c%s "$ARCHIVE_PATH") bytes)"
