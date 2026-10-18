#!/bin/bash
# Make TOKEN_KEY (random, never shown): the key that encrypts sign-ins to Google and Whoop before they're stored.
# Saves it to .env.local and Vercel (production, hidden). Run once; running it again makes a new key, after which
# Google and Whoop need connecting again (the old sign-ins can't be read with a new key).
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
if grep -q '^TOKEN_KEY=' .env.local 2>/dev/null && [ "${1:-}" != "--new" ]; then echo "TOKEN_KEY already exists (use --new to replace it)."; exit 0; fi
VALUE="$(openssl rand -hex 32)"
grep -v '^TOKEN_KEY=' .env.local > .env.local.tmp 2>/dev/null || true
printf 'TOKEN_KEY=%s\n' "$VALUE" >> .env.local.tmp
mv .env.local.tmp .env.local
chmod 600 .env.local
printf '%s' "$VALUE" | npx vercel env add TOKEN_KEY production --sensitive --force >/dev/null 2>&1 \
  && echo "✓ TOKEN_KEY made and saved to .env.local and Vercel (hidden)." \
  || { echo "Saved to .env.local, but Vercel didn't take it. Run: npx vercel env add TOKEN_KEY production"; exit 1; }
