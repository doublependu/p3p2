import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { VERSION } from '../src/version.ts'

const ROOT = join(import.meta.dirname, '..', '..')

function manifest(dir: string): { version?: string; workspaces?: string[] } {
  return JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'))
}

test('every package has the version the server reports', () => {
  // A release sets them all with one `npm version`; the release workflow checks the tag against them.
  const root = manifest('.')
  const versions = Object.fromEntries(root.workspaces!.map((w) => [w, manifest(w).version]))
  for (const [w, v] of Object.entries(versions)) assert.equal(v, VERSION, `${w}/package.json says ${v}, the server ${VERSION}`)
  if (root.version !== undefined) assert.equal(root.version, VERSION)
  assert.match(VERSION, /^\d+\.\d+\.\d+$/)
})
