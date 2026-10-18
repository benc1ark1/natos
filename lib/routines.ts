import type { Habit, HabitItem } from './types'
import { isoDow } from './time'

// Routines are reference guides: no ticking, no progress, nothing goes overdue.

export const routinesForDay = (habits: Habit[], day: string) =>
  habits.filter((h) => h.is_active && (h.days_of_week ?? []).includes(isoDow(day)))
    .sort((a, b) => a.sort_order - b.sort_order)

/** A routine's blocks in order. Blocks limited to certain days are kept but flagged. */
export const blocksOf = (habitId: string, items: HabitItem[]) =>
  items.filter((i) => i.habit_id === habitId).sort((a, b) => a.sort_order - b.sort_order)
