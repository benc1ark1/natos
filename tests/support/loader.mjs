// Lets plain `node --test` load the app's TypeScript (lib/**) without a build:
// extensionless imports get ".ts", "@/x" means the project root, and 'server-only' is a no-op
// (it only exists to stop browser bundles importing server code).
const ROOT = new URL('../../', import.meta.url)

export async function resolve(specifier, context, next) {
  if (specifier === 'server-only') return { url: 'data:text/javascript,export {}', shortCircuit: true }
  if (specifier.startsWith('@/')) specifier = new URL(specifier.slice(2), ROOT).href
  try {
    return await next(specifier, context)
  } catch (e) {
    const local = specifier.startsWith('.') || specifier.startsWith('file:')
    if (!local || /\.[cm]?[jt]sx?$/.test(specifier)) throw e
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      try { return await next(specifier + ext, context) } catch {}
    }
    throw e
  }
}
