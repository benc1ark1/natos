#!/bin/bash
# Make the webhook and tick secrets (random, never shown), save them to .env.local and Vercel,
# and write the Supabase Vault SQL to supabase/step9-vault.local.sql (git-ignored, safe to re-run:
# it creates telegram_tick_secret if it's missing, otherwise replaces its value).
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077   # .env.local and the SQL file hold secrets: only you can read them
for NAME in TELEGRAM_WEBHOOK_SECRET TELEGRAM_TICK_SECRET; do
  VALUE="$(openssl rand -hex 32)"
  grep -v "^$NAME=" .env.local > .env.local.tmp || true
  printf '%s=%s\n' "$NAME" "$VALUE" >> .env.local.tmp
  mv .env.local.tmp .env.local
  chmod 600 .env.local
  printf '%s' "$VALUE" | npx vercel env add "$NAME" production --sensitive --force >/dev/null 2>&1
  echo "✓ $NAME made and saved (hidden)."
done
TICK="$(grep '^TELEGRAM_TICK_SECRET=' .env.local | cut -d= -f2-)"
cat > supabase/step9-vault.local.sql <<SQL
-- Step 9: stores the tick secret in Supabase Vault. Contains a secret: never commit or share.
-- Safe to re-run: creates the secret if it isn't there, otherwise replaces its value.
do \$\$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'telegram_tick_secret';
  if v_id is null then
    perform vault.create_secret('$TICK', 'telegram_tick_secret', 'Nat OS: lets pg_cron call /api/telegram/tick');
  else
    perform vault.update_secret(v_id, '$TICK', 'telegram_tick_secret', 'Nat OS: lets pg_cron call /api/telegram/tick');
  end if;
end
\$\$;
SQL
chmod 600 supabase/step9-vault.local.sql
echo "✓ Wrote supabase/step9-vault.local.sql (run it in Supabase's SQL Editor)"
