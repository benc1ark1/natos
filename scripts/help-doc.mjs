// Writes docs/HOW-TO-USE.md from lib/help.ts (the one source for /help, the Help page and this doc).
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs scripts/help-doc.mjs
import { writeFileSync } from 'node:fs'
const { helpMarkdown } = await import('../lib/help.ts')
writeFileSync(new URL('../docs/HOW-TO-USE.md', import.meta.url), helpMarkdown())
console.log('docs/HOW-TO-USE.md written')
