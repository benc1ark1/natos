#!/bin/bash
# Make MAIL_SECRET (random, never shown): the key the Gmail scripts send with each batch of emails, so only they can
# post to /api/mail/incoming. Saves it to .env.local and Vercel (production, hidden). Running it again with --new makes
# a new key; then both Gmail scripts need pasting again (scripts/mail-script.sh).
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
if grep -q '^MAIL_SECRET=' .env.local 2>/dev/null && [ "${1:-}" != "--new" ]; then echo "MAIL_SECRET already exists (use --new to replace it)."; exit 0; fi
VALUE="$(openssl rand -hex 32)"
grep -v '^MAIL_SECRET=' .env.local > .env.local.tmp 2>/dev/null || true
printf 'MAIL_SECRET=%s\n' "$VALUE" >> .env.local.tmp
mv .env.local.tmp .env.local
chmod 600 .env.local
printf '%s' "$VALUE" | npx vercel env add MAIL_SECRET production --sensitive --force >/dev/null 2>&1 \
  && echo "✓ MAIL_SECRET made and saved to .env.local and Vercel (hidden)." \
  || { echo "Saved to .env.local, but Vercel didn't take it. Run: npx vercel env add MAIL_SECRET production"; exit 1; }
