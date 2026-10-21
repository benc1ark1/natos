// Settings for the email watcher: editable on the Settings page and by chat ("setting" change), stored in
// profiles.planning (lib/settings-extra.ts merges them in). Pure: no database.
import type { ExtraSpec } from '../settings-extra'

export const MAIL_SETTINGS: Record<string, ExtraSpec> = {
  // his tutors' addresses are his data, never in the code (the repo is public)
  mailHomeworkFrom: {
    label: 'Homework senders (their emails always become homework tasks)', kind: 'list', group: 'messages', max: 500, default: '',
    help: 'Email addresses or @domains, separated by commas (“tutor@example.com, @tutoring.co.uk”). Teachers at your school’s own domain count already.',
  },
  // fix round 21: a tutor's homework that is only for his next lesson (lib/mail/expire.ts). Names, not code: his data
  homeworkUntilLesson: {
    label: 'Tutors whose homework expires after their next lesson', kind: 'list', group: 'messages', max: 200, default: 'CS tutor',
    help: 'A tutor’s name or task source, separated by commas (“Sam, CS tutor”), or “none”. Their open homework is archived (never deleted) once their next lesson in your calendar has passed.',
  },
}
