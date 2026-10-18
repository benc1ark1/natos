// Build 2, phase L (guides): plain checks, no database. Run: npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relevantGuides } from '../lib/guides-search.ts'
import { guideArea } from '../lib/guides.ts'

const g = (title, body = '') => ({ id: title, title, body })
const guides = [
  g('Skincare & Grooming', '## Recovery night\n1. Cleanser\n2. Retinol\n## Morning\nSPF'),
  g('Sleep', 'Lights out 22:30. No screens after 22:00.'),
  g('Gym Training', 'Upper A: bench, rows. Lower: squats.'),
  g('Fragrances', 'Spray twice on the neck.'),
]

test('a question finds the guide it’s about (title words count most); small talk finds none', () => {
  assert.deepEqual(relevantGuides(guides, 'What’s my recovery-night skincare?').map((x) => x.title)[0], 'Skincare & Grooming')
  assert.deepEqual(relevantGuides(guides, 'when should I go to sleep?').map((x) => x.title), ['Sleep'])
  assert.equal(relevantGuides(guides, 'what are my upper sessions?')[0].title, 'Gym Training', 'from the text, not just the title')
  assert.deepEqual(relevantGuides(guides, 'thanks, sounds good'), [])
})

test('guides are grouped by area: his choice, else guessed from the title', () => {
  const cats = [{ id: 's', name: 'Study' }, { id: 'a', name: 'Athletic' }, { id: 'p', name: 'Personal' }]
  assert.deepEqual(guideArea({ title: 'Athletic & Lower', category_id: null }, cats), { id: 'a', name: 'Athletic', guessed: true })
  assert.deepEqual(guideArea({ title: 'Skincare & Grooming', category_id: null }, cats), { id: 'p', name: 'Personal', guessed: true })
  assert.deepEqual(guideArea({ title: 'Skincare & Grooming', category_id: 's' }, cats), { id: 's', name: 'Study', guessed: false })
})
