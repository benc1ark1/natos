// Settings for the email watcher: editable on the Settings page and by chat ("setting" change), stored in
// profiles.planning (lib/settings-extra.ts merges them in). Pure: no database.
import type { ExtraSpec } from '../settings-extra'

export const MAIL_SETTINGS: Record<string, ExtraSpec> = {
  // his tutors' addresses are his data, never in the code (the repo is public)
  mailHomeworkFrom: {
    label: 'Homework senders (their emails always become homework tasks)', kind: 'list', group: 'messages', max: 500, default: '',
    help: 'Email addresses or @domains, separated by commas (“tutor@example.com, @tutoring.co.uk”). Teachers at your school’s own domain count already.',
  },
}
