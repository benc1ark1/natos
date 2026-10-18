#!/bin/bash
# Put one part of the Gmail watcher on the clipboard, ready to paste into Apps Script (never shown on screen).
# Usage: ./scripts/mail-script.sh school manifest | school code | personal manifest | personal code
#   manifest = appsscript.json (the permissions: read-only Gmail, calling Nat OS; school also the fallback calendar)
#   code     = Code.gs, with this account's name and the app's key (MAIL_SECRET from .env.local) filled in
set -euo pipefail
cd "$(dirname "$0")/.."
ACCOUNT="${1:-}"; PART="${2:-}"
[[ "$ACCOUNT" == school || "$ACCOUNT" == personal ]] && [[ "$PART" == manifest || "$PART" == code ]] \
  || { echo "Usage: ./scripts/mail-script.sh school|personal manifest|code"; exit 1; }
if [ "$PART" == manifest ]; then
  pbcopy < "google-apps-script/mail-watcher-$ACCOUNT.appsscript.json"
  echo "✓ The $ACCOUNT manifest (appsscript.json) is on your clipboard."
  exit 0
fi
SECRET="$(grep '^MAIL_SECRET=' .env.local | head -1 | cut -d= -f2-)"
[ -n "$SECRET" ] || { echo "No MAIL_SECRET in .env.local yet: run ./scripts/gen-mail-secret.sh first."; exit 1; }
FALLBACK=""
[ "$ACCOUNT" == school ] && FALLBACK="c_8025b5881d60c98f20d3fe87ec7b8c09a47b02e0118018a303270cc6acca6dec@group.calendar.google.com"
sed -e "s/__ACCOUNT__/$ACCOUNT/" -e "s/__MAIL_SECRET__/$SECRET/" -e "s/__FALLBACK__/$FALLBACK/" google-apps-script/mail-watcher.gs | pbcopy
echo "✓ The $ACCOUNT watcher code (Code.gs) is on your clipboard."
