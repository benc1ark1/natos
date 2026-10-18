#!/bin/bash
# Save a TEST database setting to .env.testdb.local (git-ignored, owner-only) without it showing on screen.
# For the second Supabase project "nat-os-test" only. Never goes to Vercel; the real app never reads it.
# Usage: ./scripts/add-test-secret.sh NAME     (then paste the value and press Enter)
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077   # the file is readable by you only
NAME="${1:?Usage: ./scripts/add-test-secret.sh NAME}"
case "$NAME" in TEST_*) ;; *) echo "Test settings start with TEST_ (e.g. TEST_SUPABASE_URL)."; exit 1 ;; esac
read -rsp "Paste $NAME and press Enter (it won't show): " VALUE; echo
VALUE="$(printf '%s' "$VALUE" | tr -d '[:space:]')"
[ -n "$VALUE" ] || { echo "Nothing pasted, nothing saved."; exit 1; }
touch .env.testdb.local
grep -v "^$NAME=" .env.testdb.local > .env.testdb.local.tmp || true
printf '%s=%s\n' "$NAME" "$VALUE" >> .env.testdb.local.tmp
mv .env.testdb.local.tmp .env.testdb.local
chmod 600 .env.testdb.local
echo "✓ $NAME saved to .env.testdb.local (hidden)."
