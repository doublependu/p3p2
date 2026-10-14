// Frames bent at random: a validator answers yes or no to each, and never throws.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeBinary, encodeBinary, parseBinaryHeader, parseBinaryOutHeader, parseClientFrame, parseServerFrame } from '../src/frames.ts'

/** A small seeded generator, so that a failure can be run again. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Frames of every kind, valid ones, to start from. */
const SEEDS: unknown[] = [
  { t: 'hello', proto: 1, auth: { key: 'k'.repeat(24) }, player: { pid: 'p'.repeat(20), secret: 's'.repeat(20) }, game: { id: 'g', version: '1' }, name: 'Ada' },
  { t: 'msg', ch: 'pos', data: { x: 1, y: [1, 2] }, to: [1, 2], volatile: true },
  { t: 'msg', ch: 'world', data: { seed: 7 }, retain: 'room', first: true },
  { t: 'pres', data: { x: 4 } },
  { t: 'op', op: { k: 1 } },
  { t: 'snap', data: { a: 1 }, upTo: 4 },
  { t: 'away', away: true },
  { t: 'ping', c: 1.5 },
  { t: 'kick', id: 3 },
  { t: 'end' },
  { t: 'leave' },
  { t: 'welcome', self: { id: 3, pid: 'p'.repeat(20), name: 'Ada', order: 3, mod: false }, room: { name: 'r' }, host: 1, members: [{ id: 1, pid: 'q'.repeat(20), name: 'G', order: 1 }], retained: { room: {}, player: {}, tail: {} }, presence: [], log: { snap: null, ops: [] }, token: 't'.repeat(20), now: 5 },
  { t: 'msg', from: 3, ch: 'pos', data: 1, ts: 5 },
  { t: 'member+', id: 4, pid: 'p'.repeat(20), name: 'E', order: 4 },
  { t: 'state', id: 4, state: 'lost' },
  { t: 'op', seq: 4, from: 3, op: {}, ts: 5 },
  { t: 'error', code: 'rate', message: 'x' },
]

const ODD: unknown[] = [null, true, 0, -1, 1.5, 2 ** 53, Number.MAX_VALUE, '', 'x'.repeat(300), [], [null], {}, { t: 'msg' }, '…', '\u0000']

/** One random change to a copy of `v`: a field gone, a field of another type, a field added, an array cut. */
function bend(v: unknown, r: () => number, depth = 0): unknown {
  if (Array.isArray(v)) {
    const out = v.map((x) => (r() < 0.3 ? bend(x, r, depth + 1) : x))
    if (r() < 0.2) out.push(ODD[Math.floor(r() * ODD.length)])
    if (r() < 0.2) out.pop()
    return out
  }
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = { ...(v as Record<string, unknown>) }
    const keys = Object.keys(out)
    const key = keys[Math.floor(r() * keys.length)]
    const roll = r()
    if (key && roll < 0.25) delete out[key]
    else if (key && roll < 0.6) out[key] = ODD[Math.floor(r() * ODD.length)]
    else if (key && roll < 0.85 && depth < 4) out[key] = bend(out[key], r, depth + 1)
    else out[['t', 'ch', 'to', 'data', 'parts', 'id', 'x'][Math.floor(r() * 7)]!] = ODD[Math.floor(r() * ODD.length)]
    return out
  }
  return ODD[Math.floor(r() * ODD.length)]
}

test('frames bent at random: every validator answers, none throws', () => {
  const r = rng(20261011)
  const parsers = [
    (s: string) => parseClientFrame(s),
    (s: string) => parseServerFrame(s),
    (s: string) => parseBinaryHeader(s),
    (s: string) => parseBinaryOutHeader(s),
  ]
  for (let i = 0; i < 20_000; i++) {
    let frame: unknown = SEEDS[i % SEEDS.length]
    for (let k = 1 + Math.floor(r() * 3); k > 0; k--) frame = bend(frame, r)
    let text = JSON.stringify(frame) ?? 'null'
    // Now and then the text itself is cut short, or has a character changed.
    if (r() < 0.1) text = text.slice(0, Math.floor(r() * text.length))
    if (r() < 0.1) {
      const at = Math.floor(r() * text.length)
      text = text.slice(0, at) + String.fromCharCode(Math.floor(r() * 128)) + text.slice(at + 1)
    }
    for (const parse of parsers) assert.doesNotThrow(() => parse(text), text)
  }
})

test('binary frames bent at random: decoding answers, and never throws', () => {
  const r = rng(7)
  for (let i = 0; i < 5000; i++) {
    const good = encodeBinary(JSON.stringify(bend({ t: 'msg', ch: 'view', parts: [[3, 2]] }, r)), Uint8Array.of(1, 2))
    const bytes = good.slice(0, Math.floor(r() * (good.length + 1)))
    if (bytes.length > 0 && r() < 0.5) bytes[Math.floor(r() * bytes.length)] = Math.floor(r() * 256)
    assert.doesNotThrow(() => {
      const parts = decodeBinary(bytes)
      if (parts) parseBinaryHeader(parts.header)
    })
  }
})
