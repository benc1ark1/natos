// A test clock: makes `new Date()` and `Date.now()` return a chosen moment (and tick on from it), so a conversation can
// happen "on Wednesday at 16:30". Only ever set to a moment in the PAST: the database stamps rows with its own real
// clock, and the bot's windows ("cards from the last 30 minutes") must still find them.
const Real = Date
let offset = 0

class FakeDate extends Real {
  constructor(...args) {
    if (args.length === 0) super(Real.now() + offset)
    else super(...args)
  }
  static now() { return Real.now() + offset }
}

/** Set the clock to this moment (an ISO string or a Date); null puts the real clock back. */
export function setClock(at) {
  if (at == null) { offset = 0; globalThis.Date = Real; return }
  const t = typeof at === 'string' ? Real.parse(at) : at.getTime()
  if (t > Real.now()) throw new Error('the test clock only goes back in time')
  offset = t - Real.now()
  globalThis.Date = FakeDate
}
