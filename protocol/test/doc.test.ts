// The frames in docs/protocol.md go through the validators here, so that the document cannot drift from the code.
//
// The examples are JSON with comments and placeholders: `<any JSON>`, `{…}`, `, …]`. Each is made into JSON, and
// checked by the parser for its direction, which the comment above it names ("client → server", "server → client",
// and "header, …" for a binary frame's header). A block that names no direction may hold either.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseBinaryHeader, parseBinaryOutHeader, parseClientFrame, parseServerFrame } from '../src/frames.ts'

type Direction = 'client' | 'server' | 'client-header' | 'server-header' | 'either'

interface Example {
  direction: Direction
  json: string
  line: number
}

const DOC = readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'protocol.md'), 'utf8')

/** Every frame in the document's `jsonc` blocks that comes with a direction, or with none. */
function examples(): Example[] {
  const out: Example[] = []
  const lines = DOC.split('\n')
  let inBlock = false
  let direction: Direction | null = null
  let text = ''
  let start = 0
  let depth = 0
  for (const [n, raw] of lines.entries()) {
    if (raw.startsWith('```')) {
      inBlock = !inBlock && raw.startsWith('```jsonc')
      direction = null
      continue
    }
    if (!inBlock) continue
    const comment = raw.match(/^\s*\/\/\s*(.*)$/)
    if (comment) {
      const said = comment[1]!
      if (/header, client → server/.test(said)) direction = 'client-header'
      else if (/header, server → client|binary message/.test(said)) direction = 'server-header'
      else if (/client → server/.test(said)) direction = 'client'
      else if (/server → client/.test(said)) direction = 'server'
      continue
    }
    // The comment at the end of a line goes; a `//` inside a string ("https://…") stays.
    const line = raw.replace(/("(?:[^"\\]|\\.)*")|\/\/.*$/g, (_m, str: string | undefined) => str ?? '')
    if (depth === 0) {
      if (!line.trim()) continue
      start = n + 1
      text = ''
    }
    text += `${line}\n`
    for (const ch of line.replace(/"(?:[^"\\]|\\.)*"/g, '')) {
      if (ch === '{' || ch === '[') depth++
      else if (ch === '}' || ch === ']') depth--
    }
    if (depth === 0 && text.trim()) {
      out.push({ direction: direction ?? 'either', json: jsonOf(text), line: start })
      text = ''
    }
  }
  return out
}

/** The document's placeholders, made into JSON a validator can read. `"…"` stands for an id or a token. */
function jsonOf(text: string): string {
  return text
    .replace(/"…"/g, '"Abcdefghijklmnop-123"')
    .replace(/<any JSON>|<the same JSON>/g, '{"x": 1}')
    .replace(/\{…\}/g, '{}')
    .replace(/,\s*…\s*\]/g, ']')
}

function accepted(e: Example): boolean {
  const client = () => parseClientFrame(e.json).ok
  const server = () => parseServerFrame(e.json) !== null
  switch (e.direction) {
    case 'client':
      return client()
    case 'server':
      return server()
    case 'client-header':
      return parseBinaryHeader(e.json).ok
    case 'server-header':
      return parseBinaryOutHeader(e.json) !== null
    case 'either':
      return client() || server()
  }
}

test('every frame in docs/protocol.md is one the validators take', () => {
  const all = examples().filter((e) => {
    // The stats of the HTTP API are not a frame.
    const t = (JSON.parse(e.json) as { t?: unknown }).t
    return typeof t === 'string'
  })
  assert.ok(all.length >= 25, `only ${all.length} frames found in the document`)
  const refused = all.filter((e) => !accepted(e)).map((e) => `line ${e.line} (${e.direction}): ${e.json.replace(/\s+/g, ' ').slice(0, 160)}`)
  assert.deepEqual(refused, [])
})
