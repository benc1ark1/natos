// Gym progress (queue item 6): the shapes every gym file shares. Pure: no database.

/** The muscle groups weekly volume is counted in. */
export type Muscle = 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps' | 'quads' | 'hamstrings' | 'glutes' | 'calves' | 'core'
export const MUSCLES: readonly Muscle[] = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'core']
export const UPPER_MUSCLES: readonly Muscle[] = ['chest', 'back', 'shoulders', 'biceps', 'triceps']

/** push / pull: the upper-body balance check; legs and core: the rest. */
export type Pattern = 'push' | 'pull' | 'legs' | 'core'

/**
 * One exercise in the catalogue. primary muscles count a full set each, secondary half a set. lower: the +5 kg
 * jump (upper +2.5 kg). bodyweight: the weight he logs is what he adds (a belt, a vest), on top of his bodyweight.
 * compound: big lifts use the compound rep range, the rest the accessory range (settings).
 */
export type Exercise = {
  key: string; name: string; primary: Muscle[]; secondary: Muscle[]; pattern: Pattern
  lower: boolean; compound: boolean; bodyweight?: boolean; aliases: string[]
}

/** A row of lift_sets (supabase/gym.sql): one exercise in one session, at one weight and rep count. */
export type LiftRow = {
  id: string; done_on: string; exercise: string; exercise_key: string
  weight_kg: number; reps: number; sets: number; rpe: number | null
  source: 'chat' | 'hevy' | 'app'; source_ref: string | null; notes: string | null
  archived_at?: string | null; created_at?: string; updated_at?: string
}

/** A row to insert (the database fills in id, user and times). */
export type NewLift = Pick<LiftRow, 'done_on' | 'exercise' | 'exercise_key' | 'weight_kg' | 'reps' | 'sets' | 'rpe' | 'source' | 'source_ref' | 'notes'>

/** The bits of a lift the maths needs (rows from the database or a card that isn't saved yet). */
export type Lift = Pick<LiftRow, 'done_on' | 'exercise_key' | 'weight_kg' | 'reps' | 'sets'> & { id?: string; exercise?: string; created_at?: string }

/** His gym settings (lib/gym/settings.ts), as the maths uses them. */
export type GymPrefs = {
  bodyweightKg: number          // 0 = not set: bodyweight moves have no e1RM, only reps
  unit: 'kg' | 'lbs'            // what a weight without a unit means
  compound: [number, number]    // rep range for big lifts (double progression)
  accessory: [number, number]   // rep range for the rest
  stall: number                 // sessions without progress before a deload
  deloadPct: number             // how much a deload takes off
}

export const DEFAULT_PREFS: GymPrefs = { bodyweightKg: 0, unit: 'kg', compound: [5, 8], accessory: [8, 12], stall: 3, deloadPct: 10 }
