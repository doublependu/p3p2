// Keeps the declarations a game can reach from package.json's exports, and removes the rest. tsc writes one for
// every file it compiles, the lazy parts included, and those import @p3p2/protocol, which is not published: a
// declaration that is shipped may import nothing but its neighbours. Fails when one does.

import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const client = join(import.meta.dirname, '..')
const types = join(client, 'dist', 'types')

type Export = string | { types?: string; default?: string }
const pkg = JSON.parse(readFileSync(join(client, 'package.json'), 'utf8')) as { exports: Record<string, Export> }
const entries = Object.values(pkg.exports).flatMap((e) => (typeof e === 'object' && e.types ? [resolve(client, e.types)] : []))

const reached = new Set<string>()
const problems: string[] = []
const queue = [...entries]
while (queue.length) {
  const file = queue.pop()!
  if (reached.has(file)) continue
  reached.add(file)
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    problems.push(`${relative(client, file)} is missing: run "npm run build"`)
    continue
  }
  if (/^\/\/\/\s*<reference/m.test(text)) problems.push(`${relative(client, file)} has a /// <reference>`)
  // `from '…'`, `import '…'` and `import('…')`: every way a declaration names another module.
  for (const [, spec] of text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    if (!spec!.startsWith('.')) {
      problems.push(`${relative(client, file)} imports ${spec}, which a game does not have`)
      continue
    }
    queue.push(resolve(dirname(file), `${spec!.replace(/\.[jt]s$/, '')}.d.ts`))
  }
}

let removed = 0
function prune(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      prune(path)
      if (readdirSync(path).length === 0) rmSync(path, { recursive: true })
    } else if (!reached.has(path)) {
      rmSync(path)
      removed++
    }
  }
}
prune(types)

if (problems.length) {
  for (const p of problems) console.error(`types: ${p}`)
  process.exit(1)
}
console.log(`types: ${reached.size} declarations kept, ${removed} that no export reaches removed`)
