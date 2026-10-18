#!/bin/bash
# Save a secret to .env.local AND Vercel (production) without it ever showing on screen.
# Usage: ./scripts/add-secret.sh NAME     (then paste the value and press Enter)
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077   # any file made here (the .env.local copy) is readable by you only
NAME="${1:?Usage: ./scripts/add-secret.sh NAME}"
read -rsp "Paste $NAME and press Enter (it won't show): " VALUE; echo
VALUE="$(printf '%s' "$VALUE" | tr -d '[:space:]')"
[ -n "$VALUE" ] || { echo "Nothing pasted, nothing saved."; exit 1; }
# .env.local: replace the line if it's there, otherwise add it
touch .env.local
grep -v "^$NAME=" .env.local > .env.local.tmp || true
printf '%s=%s\n' "$NAME" "$VALUE" >> .env.local.tmp
mv .env.local.tmp .env.local
chmod 600 .env.local
# Vercel: stored as a Secret (nobody can read it back)
printf '%s' "$VALUE" | npx vercel env add "$NAME" production --sensitive --force >/dev/null 2>&1 \
  && echo "✓ $NAME saved to .env.local and Vercel (hidden)." \
  || { echo "Saved to .env.local, but Vercel didn't take it. Run: npx vercel env add $NAME production"; exit 1; }
