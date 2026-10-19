// Hevy's CSV export → lift rows (queue item 6). Hevy is read from its own export file only (Settings → Export data in
// the Hevy app), never scraped. One CSV row is one set; warm-up sets are skipped, and so are rows with no reps (cardio,
// timed holds). Every set gets a source_ref ("hevy|<workout start>|<exercise>|<set>") so importing the same file again
// adds nothing twice. Pure: no database.
import { DEFAULT_EXERCISES, exerciseOf, findExercise, keyOf, normWords } from './catalogue'
import { LB } from './parse'
import { prOf, prShort } from './progress'
import { DEFAULT_PREFS, type Exercise, type GymPrefs, type LiftRow, type NewLift } from './types'

export const MAX_BYTES = 2_000_000
export const MAX_ROWS = 20_000

/** RFC 4180 CSV: commas, "quoted, fields", "" for a quote inside quotes, line breaks inside quotes, CRLF or LF, a BOM. */
export function parseCsv(text: string): string[][] {
  const out: string[][] = []
  let row: string[] = [], field = '', quoted = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++ } else quoted = false }
      else field += c
      continue
    }
    if (c === '"' && field === '') { quoted = true; continue }
    if (c === ',') { row.push(field); field = ''; continue }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((x) => x !== '')) out.push(row)
      row = []
      continue
    }
    field += c
  }
  row.push(field)
  if (row.some((x) => x !== '')) out.push(row)
  return out
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number) => String(n).padStart(2, '0')
const valid = (y: number, m: number, d: number) => y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 && new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d

/**
 * A Hevy time as a date and time: "19 Oct 2026, 18:05", "2026-10-19 18:05:00", "2026-10-19T18:05:00",
 * "Oct 19, 2026, 6:05 PM", "19/10/2026 18:05". null = not a date.
 */
export function hevyTime(raw: string): { date: string; time: string } | null {
  const s = raw.trim().toLowerCase()
  let y = 0, mo = 0, d = 0, h = 0, mi = 0
  let m: RegExpMatchArray | null
  const clock = (rest: string) => {
    const c = rest.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/)
    if (!c) return
    h = Number(c[1]); mi = Number(c[2])
    if (c[3] === 'pm' && h < 12) h += 12
    if (c[3] === 'am' && h === 12) h = 0
  }
  if ((m = s.match(/^(\d{1,2}) ([a-z]{3})[a-z]* (\d{4})(.*)$/))) { d = Number(m[1]); mo = MONTHS.indexOf(m[2]) + 1; y = Number(m[3]); clock(m[4]) }
  else if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/))) { y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]); clock(m[4]) }
  else if ((m = s.match(/^([a-z]{3})[a-z]* (\d{1,2}),? (\d{4})(.*)$/))) { mo = MONTHS.indexOf(m[1]) + 1; d = Number(m[2]); y = Number(m[3]); clock(m[4]) }
  else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/))) { d = Number(m[1]); mo = Number(m[2]); y = Number(m[3]); clock(m[4]) }
  else return null
  if (!valid(y, mo, d) || h > 23 || mi > 59) return null
  return { date: `${y}-${pad(mo)}-${pad(d)}`, time: `${pad(h)}:${pad(mi)}` }
}

/** Hevy's exercise title → the catalogue's ("Bench Press (Barbell)" → bench press; "Incline Bench Press (Dumbbell)" → incline dumbbell press). */
export function hevyExercise(title: string, list: Exercise[] = DEFAULT_EXERCISES): Exercise | null {
  const m = title.match(/^(.*?)\s*\(([^)]*)\)\s*$/)
  const base = (m ? m[1] : title).split(/\s+-\s+/)[0].trim()
  const equip = normWords(m?.[2] ?? '').replace(/^smith machine$/, 'machine').replace(/^bodyweight$|^weighted$|^assisted$/, '')
  const short = equip === 'dumbbell' ? 'db' : equip
  const tries = equip ? [`${equip} ${base}`, `${short} ${base}`, `${base} ${equip}`, base] : [base]
  for (const t of tries) { const e = findExercise(t, list); if (e) return e }
  return null
}

export type HevyPreview = {
  rows: NewLift[]                // the sets to save (one row each)
  workouts: number; sets: number; exercises: string[]; unknown: string[]
  from: string | null; to: string | null
  skipped: { warmup: number; notLifts: number; bad: number }
  problem: string | null         // the whole file couldn't be read
}

export type ImportSummary = {
  workouts: number; sets: number; exercises: number; names: string[]; unknown: string[]; from: string | null; to: string | null
  skipped: HevyPreview['skipped']; fresh: number; restore: number; already: number; prs: string[]
}

/**
 * What importing would do, against what he already has: new sets, sets he removed before (they come back), sets
 * already there (skipped), and the PRs the new sets would set (vs his best before them; a first log isn't a PR).
 */
export function importSummary(p: HevyPreview, existing: Pick<LiftRow, 'exercise_key' | 'weight_kg' | 'reps' | 'done_on' | 'source_ref'>[], refs: Map<string, { archived: boolean }>,
  list: Exercise[] = DEFAULT_EXERCISES, prefs: GymPrefs = DEFAULT_PREFS): ImportSummary {
  const seen = new Set<string>()
  const unique = p.rows.filter((r) => r.source_ref && !seen.has(r.source_ref) && seen.add(r.source_ref))
  const fresh = unique.filter((r) => !refs.has(r.source_ref!))
  const restore = unique.filter((r) => refs.get(r.source_ref!)?.archived).length
  const prs: string[] = []
  for (const key of [...new Set(fresh.map((r) => r.exercise_key))]) {
    const ex = exerciseOf(key, list, fresh.find((r) => r.exercise_key === key)?.exercise)
    const mine = fresh.filter((r) => r.exercise_key === key)
    const before = existing.filter((r) => r.exercise_key === key && r.done_on <= mine[mine.length - 1].done_on)
    const pr = prOf(mine, before, ex, prefs)
    if (pr && pr.kind !== 'first') prs.push(`${ex.name} ${prShort(pr, ex)}`)
  }
  return {
    workouts: p.workouts, sets: p.sets, exercises: p.exercises.length, names: p.exercises.slice(0, 12), unknown: p.unknown.slice(0, 12), from: p.from, to: p.to,
    skipped: p.skipped, fresh: fresh.length, restore, already: unique.length - fresh.length - restore + (p.rows.length - unique.length), prs: prs.slice(0, 10),
  }
}

const COLS = ['title', 'start_time', 'exercise_title', 'set_index', 'set_type', 'reps']

/** Read a Hevy CSV export into rows to import (nothing is saved here). */
export function readHevy(text: string, list: Exercise[] = DEFAULT_EXERCISES): HevyPreview {
  const empty: HevyPreview = { rows: [], workouts: 0, sets: 0, exercises: [], unknown: [], from: null, to: null, skipped: { warmup: 0, notLifts: 0, bad: 0 }, problem: null }
  if (text.length > MAX_BYTES) return { ...empty, problem: `That file is too big (over ${MAX_BYTES / 1_000_000} MB). Export a shorter date range from Hevy.` }
  const table = parseCsv(text)
  if (!table.length) return { ...empty, problem: 'That file is empty.' }
  const head = table[0].map((h) => h.trim().toLowerCase())
  const col = (name: string) => head.indexOf(name)
  const missing = COLS.filter((c) => col(c) < 0)
  const wkg = col('weight_kg'), wlb = col('weight_lbs')
  if (missing.length || (wkg < 0 && wlb < 0)) return { ...empty, problem: `That doesn’t look like a Hevy export (missing ${[...missing, ...(wkg < 0 && wlb < 0 ? ['weight_kg'] : [])].join(', ')}). In Hevy: Profile → Settings → Export & import data → Export workouts.` }
  if (table.length - 1 > MAX_ROWS) return { ...empty, problem: `That file has more than ${MAX_ROWS} sets. Export a shorter date range from Hevy.` }
  const out = { ...empty, rows: [] as NewLift[], skipped: { warmup: 0, notLifts: 0, bad: 0 } }
  const workouts = new Set<string>(), names = new Set<string>(), unknown = new Set<string>()
  const counter = new Map<string, number>()
  const block = new Map<string, { title: string; n: number }>()   // workout start → the exercise block it's on
  const noted = new Set<string>()
  const num = (v: string | undefined) => { const t = (v ?? '').trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : NaN }
  for (const r of table.slice(1)) {
    const get = (name: string) => (col(name) >= 0 ? (r[col(name)] ?? '').trim() : '')
    const when = hevyTime(get('start_time'))
    const title = get('exercise_title').slice(0, 80)
    if (!when || !title) { out.skipped.bad++; continue }
    // the ref: workout start | the exercise block's place in the workout | exercise | set number — no workout title
    // (renaming a workout in Hevy doesn't re-import it), and an exercise done twice in one workout stays two blocks
    const workout = `${when.date}T${when.time}`
    const was = block.get(workout)
    const pos = !was ? 0 : was.title === title ? was.n : was.n + 1
    block.set(workout, { title, n: pos })
    const type = get('set_type').toLowerCase().replace(/[^a-z]/g, '')
    if (type === 'warmup') { out.skipped.warmup++; continue }
    // assisted pull-ups / dips: the weight is help, not load (no negative load yet): not counted as a lift
    if (/\bassisted\b/i.test(title)) { out.skipped.notLifts++; continue }
    const reps = num(get('reps'))
    if (reps == null || reps === 0) { out.skipped.notLifts++; continue }
    const kg = wkg >= 0 ? num(r[wkg]) : null
    const lb = kg == null && wlb >= 0 ? num(r[wlb]) : null
    const weight = kg != null ? kg : lb != null ? Math.round(lb * LB * 100) / 100 : 0
    if (!Number.isInteger(reps) || reps < 1 || reps > 100 || Number.isNaN(weight) || weight < 0 || weight > 500) { out.skipped.bad++; continue }
    const ex = hevyExercise(title, list)
    const slot = `${workout}|${pos}|${title}`
    const idx = get('set_index') !== '' ? get('set_index') : String(counter.get(slot) ?? 0)
    counter.set(slot, (counter.get(slot) ?? 0) + 1)
    const rpeN = num(get('rpe'))
    const notes = get('exercise_notes').replace(/\r\n?/g, '\n').slice(0, 500)
    out.rows.push({
      done_on: when.date, exercise: title, exercise_key: ex?.key ?? keyOf(title), weight_kg: Math.round(weight * 100) / 100, reps, sets: 1,
      rpe: rpeN != null && !Number.isNaN(rpeN) && rpeN >= 1 && rpeN <= 10 ? Math.round(rpeN * 10) / 10 : null,
      source: 'hevy', source_ref: `hevy|${slot}|${idx}`.slice(0, 300), notes: notes && !noted.has(slot) ? notes : null,
    })
    if (notes) noted.add(slot)
    workouts.add(workout)
    names.add(ex?.name ?? title)
    if (!ex) unknown.add(title)
  }
  const dates = out.rows.map((x) => x.done_on).sort()
  return { ...out, workouts: workouts.size, sets: out.rows.length, exercises: [...names].sort(), unknown: [...unknown].sort(), from: dates[0] ?? null, to: dates[dates.length - 1] ?? null }
}

/** A request body as text, or null once it passes `max` bytes (reading stops there; the content-length isn't trusted). */
export async function readCapped(request: Request, max: number): Promise<string | null> {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) { await reader.cancel().catch(() => null); return null }
    parts.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const p of parts) { all.set(p, at); at += p.byteLength }
  return new TextDecoder().decode(all)
}
