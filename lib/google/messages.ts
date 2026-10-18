// What the Settings page says after connecting Google (the address only carries a short code, never text).
export const CONNECT_MESSAGES: Record<string, string> = {
  connected: 'Google Calendar connected. The first sync is running: your Life OS calendar appears in Google in a minute.',
  'not-set-up': 'Google isn’t set up on the server yet (the Google client ID and secret are missing).',
  cancelled: 'You cancelled on Google’s page, so nothing was connected.',
  failed: 'Google didn’t connect. Try again.',
  expired: 'That sign-in had expired or wasn’t started from this app. Try Connect again.',
  rejected: 'Google didn’t accept the sign-in. Try Connect again.',
  scopes: 'Google needs every box ticked (your calendars, and making the Life OS calendar). Try Connect again and tick them all.',
  'no-refresh': 'Google didn’t give a lasting sign-in. Remove Nat OS at myaccount.google.com/permissions, then Connect again.',
  save: 'Connected on Google’s side, but saving it here failed. Try again.',
}
