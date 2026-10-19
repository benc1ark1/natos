// The bot plug-in registry (plans/contracts.md §2): every plug-in is registered once, their ops don't clash with
// each other or the built-in ones, the brain's schema allows them, and a plug-in's command / tap is found.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DIR = fileURLToPath(new URL('../lib/telegram/plugins/', import.meta.url))

test('every plug-in file is registered once, with its own name', async () => {
  const { PLUGINS } = await import('../lib/telegram/plugins/index.ts')
  const files = readdirSync(DIR).filter((f) => f.endsWith('.ts') && f !== 'index.ts').map((f) => f.replace(/\.ts$/, '')).sort()
  assert.deepEqual(PLUGINS.map((p) => p.name).sort(), files)
  assert.equal(new Set(PLUGINS.map((p) => p.name)).size, PLUGINS.length)
})

test('plug-in ops are in the brain schema and never clash with the built-in ones', async () => {
  const { OPS, BUILTIN_OPS, ACTION_SCHEMA } = await import('../lib/telegram/actions.ts')
  const { PLUGIN_OPS } = await import('../lib/telegram/plugins/index.ts')
  for (const op of PLUGIN_OPS) {
    assert.ok(!BUILTIN_OPS.includes(op), `${op} is already a built-in op`)
    assert.ok(OPS.includes(op))
    assert.ok(ACTION_SCHEMA.properties.op.enum.includes(op))
  }
  assert.equal(new Set(OPS).size, OPS.length)
})

test('plug-in commands and taps are found by name / prefix; built-in single-letter taps are not', async () => {
  const { PLUGINS, pluginCommand, pluginTap } = await import('../lib/telegram/plugins/index.ts')
  for (const p of PLUGINS) {
    for (const c of p.commands ?? []) {
      assert.match(c.command, /^[a-z0-9_]{1,32}$/)
      assert.ok(pluginCommand(`/${c.command} x y`), `/${c.command} not found`)
      assert.equal(pluginCommand(`/${c.command} x y`).args, 'x y')
    }
    for (const t of p.taps ?? []) {
      assert.match(t.prefix, /^[a-z]{2,6}$/)
      assert.ok(pluginTap(`${t.prefix}:abc`))
    }
  }
  for (const builtIn of ['a', 'x', 'u', 'k', 'j', 'q', 'd']) assert.equal(pluginTap(`${builtIn}:00000000-0000-0000-0000-000000000000`), null)
})

test('settings added by the queue items merge into the settings list with valid defaults', async () => {
  const { SETTINGS, moreSettings, setting } = await import('../lib/settings.ts')
  const { EXTRA_SETTINGS } = await import('../lib/settings-extra.ts')
  const now = moreSettings({})
  for (const [k, x] of Object.entries(EXTRA_SETTINGS)) {
    assert.ok(SETTINGS[k], `${k} missing from SETTINGS`)
    assert.equal(now[k], x.default, `${k}: the default doesn't pass its own check`)
    assert.equal(setting({}, k), x.default)
  }
})
