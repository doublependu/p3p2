// Fails when a bundle outgrows its budget. Games with tight load budgets depend on these numbers.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const dist = join(import.meta.dirname, '..', 'dist')
const KB = 1024

function gz(file: string): number {
  return gzipSync(readFileSync(join(dist, file)), { level: 9 }).length
}

const files = readdirSync(dist).filter((f) => f.endsWith('.js'))
const size = (name: string): number => {
  if (!files.includes(name)) throw new Error(`${name} is missing from dist/: run "npm run build" first`)
  return gz(name)
}

// What a game pays on every visit, and what loads when multiplayer is first used.
const budgets: { what: string; bytes: number; max: number }[] = [
  { what: 'entry (p3p2.js)', bytes: size('p3p2.js'), max: 2 * KB },
  { what: 'room client + panel', bytes: size('p3p2-core.js') + size('p3p2-panel.js'), max: 15 * KB },
  { what: 'QR code', bytes: size('p3p2-qr.js'), max: 4 * KB },
  { what: 'local room (P3P2.local)', bytes: size('p3p2-local.js'), max: 1.8 * KB },
  { what: 'everything in one file (p3p2.iife.js)', bytes: size('p3p2.iife.js'), max: 20 * KB },
  // On its own: only a game that imports it pays for it.
  { what: 'drawing remote things smoothly (p3p2-smooth.js)', bytes: size('p3p2-smooth.js'), max: 1.5 * KB },
  { what: 'packing large values (p3p2-pack.js)', bytes: size('p3p2-pack.js'), max: 0.6 * KB },
]

const known = new Set([
  'p3p2.js',
  'p3p2-core.js',
  'p3p2-panel.js',
  'p3p2-qr.js',
  'p3p2-local.js',
  'p3p2.iife.js',
  'p3p2-smooth.js',
  'p3p2-pack.js',
])
const stray = files.filter((f) => !known.has(f))

let failed = false
for (const b of budgets) {
  const over = b.bytes > b.max
  failed ||= over
  console.log(`${over ? 'OVER' : 'ok  '}  ${(b.bytes / KB).toFixed(2).padStart(6)} KB gzip  (budget ${b.max / KB} KB)  ${b.what}`)
}
if (stray.length) {
  // A new chunk means a new request somewhere. Decide where it belongs, then list it above.
  failed = true
  console.log(`OVER  unexpected chunks: ${stray.join(', ')}`)
}
process.exit(failed ? 1 : 0)
