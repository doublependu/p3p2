// docs/api.md names every member of the client's public types: a test, so that the page cannot fall behind the code.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const ROOT = join(import.meta.dirname, '..', '..')
const TYPES = readFileSync(join(ROOT, 'client', 'src', 'types.ts'), 'utf8')
const ENTRY = readFileSync(join(ROOT, 'client', 'src', 'index.ts'), 'utf8')
const DOC = readFileSync(join(ROOT, 'docs', 'api.md'), 'utf8')

/** The members of each exported interface of types.ts, by interface: fields, methods and event names. */
function members(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const blocks = TYPES.matchAll(/^export interface (\w+)(?:<[^>]*>)? \{\n([\s\S]*?)^\}/gm)
  for (const [, name, body] of blocks) {
    const names = [...body!.matchAll(/^ {2}(?:readonly )?'?([\w-]+)'?\??[:(<]/gm)].map((m) => m[1]!)
    out.set(name!, names)
  }
  return out
}

/** The public members of the class P3P2 in the entry. */
function entryMembers(): string[] {
  const body = ENTRY.slice(ENTRY.indexOf('export class P3P2'))
  return [...body.matchAll(/^ {2}(?:static )?(?:async )?(?:get )?(?:readonly )?(\w+)[?]?[:(<]/gm)]
    .map((m) => m[1]!)
    .filter((n) => n !== 'constructor')
    .filter((n, i, all) => all.indexOf(n) === i)
    .filter((n) => !new RegExp(`^ {2}private (?:readonly )?${n}\\b`, 'm').test(body))
}

test('docs/api.md names every member of the public types, and of P3P2', () => {
  const missing: string[] = []
  for (const [type, names] of members()) {
    for (const n of names) if (!new RegExp(`\`[^\`]*\\b${n}\\b[^\`]*\``).test(DOC)) missing.push(`${type}.${n}`)
  }
  for (const n of entryMembers()) if (!new RegExp(`\`[^\`]*\\b${n}\\b[^\`]*\``).test(DOC)) missing.push(`P3P2.${n}`)
  assert.deepEqual(missing, [])
})
