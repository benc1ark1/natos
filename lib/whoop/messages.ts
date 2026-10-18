// What the Settings page says after connecting Whoop (the address only carries a short code, never text).
export const WHOOP_MESSAGES: Record<string, string> = {
  connected: 'Whoop connected. Your last two weeks are coming in now.',
  'not-set-up': 'Whoop isn’t set up on the server yet (the Whoop client ID and secret are missing).',
  cancelled: 'You cancelled on Whoop’s page, so nothing was connected.',
  failed: 'Whoop didn’t connect. Try again.',
  expired: 'That sign-in had expired or wasn’t started from this app. Try Connect again.',
  rejected: 'Whoop didn’t accept the sign-in. Try Connect again.',
  scopes: 'Whoop needs every box ticked (recovery, sleep, strain, workouts, profile, and “offline”). Try Connect again.',
  save: 'Connected on Whoop’s side, but saving it here failed. Try again.',
}
