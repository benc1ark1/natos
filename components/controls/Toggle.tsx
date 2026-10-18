'use client'

/** On/off switch in the design's style (replaces the browser checkbox). */
export default function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="toggle" onClick={() => onChange(!checked)}>
      <span className={`swt ${checked ? 'on' : ''}`} aria-hidden="true"><span className="knob" /></span>
      <span>{label}</span>
    </button>
  )
}
