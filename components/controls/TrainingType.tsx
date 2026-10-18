'use client'
// Training type for a calendar session or weekly target: what the training rules use. Empty = not set yet (the
// Telegram bot asks once); the guess from the name is only shown as a suggestion. The types are his own list
// (Settings → Training types).
import { useState } from 'react'
import { NOT_TRAINING, activeTypes, defaultLoad, guessType, labelOf, trainingTypes } from '@/lib/training'
import { usePlanning } from '@/lib/usePlanning'
import Select from './Select'

/** The type fields' state. A rename clears a type that wasn't just picked, so the bot asks again. */
export function useTrainingType(initial: { name: string; training_type?: string | null; load?: string | null } | null) {
  const types = trainingTypes(usePlanning())
  const start = initial?.training_type ?? ''
  const [type, setTypeRaw] = useState(start)
  const [load, setLoad] = useState(initial?.load ?? '')
  const [picked, setPicked] = useState(false)
  return {
    type, load, picked, types,
    setType: (v: string) => { setTypeRaw(v); setPicked(true); if (v && v !== NOT_TRAINING) setLoad(defaultLoad(v, types)) },
    setLoad,
    /** Call when the name changes. */
    renamed: (name: string) => { if (initial && !picked) setTypeRaw(name.trim() === initial.name ? start : '') },
    /** What to save. */
    values: () => ({ training_type: type || null, load: type && type !== NOT_TRAINING ? load || defaultLoad(type, types) : null }),
  }
}

export default function TrainingTypeFields({ name, state }: { name: string; state: ReturnType<typeof useTrainingType> }) {
  const { types } = state
  const guess = guessType(name, types)
  const typed = state.type && state.type !== NOT_TRAINING
  // an archived type a session already has stays in the list, so it isn't lost by opening the form
  const options = types.filter((t) => !t.archived || t.key === state.type)
  return (
    <>
      <Select label="Training type" value={state.type} onChange={state.setType}
        options={[{ value: '', label: 'Not set (the bot asks)' }, ...options.map((t) => ({ value: t.key, label: t.label })), { value: NOT_TRAINING, label: 'Not training' }]} />
      {typed
        ? <Select label="Load" value={state.load || defaultLoad(state.type, types)} onChange={state.setLoad}
            options={[{ value: 'hard', label: 'Hard' }, { value: 'light', label: 'Light' }]} />
        : <p className="usub" style={{ margin: 0, alignSelf: 'end' }}>{!state.type && guess && activeTypes(types).length ? `Suggested from the name: ${labelOf(guess.type, types)}` : ''}</p>}
    </>
  )
}
