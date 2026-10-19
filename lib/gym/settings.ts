// Settings for gym progress (item 6): editable on the Settings page and by chat ("setting" change), stored in profiles.planning.
// Each entry: the usual setting spec plus its default (lib/settings.ts merges these in). Pure: no database.
import type { ExtraSpec } from '../settings-extra'
import { DEFAULT_PREFS, type GymPrefs } from './types'

export const GYM_SETTINGS: Record<string, ExtraSpec> = {
  bodyweightKg: { label: 'Your bodyweight in kg (pull-ups and dips count it; 0 = not set)', kind: 'number', group: 'gym', min: 0, max: 200, default: 0,
    help: 'Only used for the estimated 1RM of bodyweight moves.' },
  liftUnit: { label: 'A weight you send without kg or lbs is in', kind: 'choice', group: 'gym', choices: ['kg', 'lbs'], default: 'kg' },
  repsCompound: { label: 'Rep range for big lifts (more weight once every set hits the top)', kind: 'text', group: 'gym', max: 10, default: '5-8',
    help: 'Two numbers, e.g. “5-8”. Squat, bench, deadlift, OHP, rows, pull-ups…' },
  repsAccessory: { label: 'Rep range for the other exercises', kind: 'text', group: 'gym', max: 10, default: '8-12', help: 'Two numbers, e.g. “8-12”.' },
  stallSessions: { label: 'Sessions without progress before a deload', kind: 'number', group: 'gym', min: 2, max: 8, default: 3 },
  deloadPct: { label: 'A deload takes this % off the weight', kind: 'number', group: 'gym', min: 5, max: 30, default: 10 },
}

const obj = (raw: unknown) => (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
const range = (v: unknown, fallback: [number, number]): [number, number] => {
  const m = typeof v === 'string' ? v.match(/^\s*(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*$/) : null
  const a = m ? Number(m[1]) : 0, b = m ? Number(m[2]) : 0
  return m && a >= 1 && b > a && b <= 50 ? [a, b] : fallback
}
const int = (v: unknown, lo: number, hi: number, fallback: number) => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : fallback)

/** His gym settings as the maths uses them (anything missing or odd = the default). */
export function gymPrefs(planning: unknown): GymPrefs {
  const o = obj(planning)
  return {
    bodyweightKg: int(o.bodyweightKg, 0, 200, DEFAULT_PREFS.bodyweightKg),
    unit: o.liftUnit === 'lbs' ? 'lbs' : 'kg',
    compound: range(o.repsCompound, DEFAULT_PREFS.compound),
    accessory: range(o.repsAccessory, DEFAULT_PREFS.accessory),
    stall: int(o.stallSessions, 2, 8, DEFAULT_PREFS.stall),
    deloadPct: int(o.deloadPct, 5, 30, DEFAULT_PREFS.deloadPct),
  }
}
