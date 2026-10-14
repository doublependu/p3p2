// Frames at random, valid and not, from several members of one room: the hub answers, ignores or closes the
// connection, and never throws. Afterwards the room still works.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { encodeBinary } from '@p3p2/protocol'
import { World } from './helpers.ts'

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

const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)]!

const VALUES: unknown[] = [null, true, 0, -1, 1.5, 2 ** 40, '', 'x', 'x'.repeat(2000), [], [1, 2], {}, { x: 1 }, 'all', 'host', 'others', 999]
const CHANNELS = ['pos', 'world', '$chat', 'has space', '', 'x'.repeat(40), 'status', 'view']

/** A frame a client could send, often with something wrong in it. */
function frame(r: () => number, ids: number[]): unknown {
  const id = () => (r() < 0.8 ? pick(r, ids) : pick(r, VALUES))
  const any = () => pick(r, VALUES)
  switch (Math.floor(r() * 12)) {
    case 0:
      return { t: 'msg', ch: pick(r, CHANNELS), data: any(), to: r() < 0.5 ? undefined : r() < 0.5 ? id() : [id(), id()], volatile: r() < 0.3 }
    case 1:
      return { t: 'msg', ch: pick(r, CHANNELS), data: any(), retain: pick(r, ['room', 'player', 'tail', 'x']), first: r() < 0.3 }
    case 2:
      return { t: 'pres', data: any() }
    case 3:
      return { t: 'op', op: any() }
    case 4:
      return { t: 'snap', data: any(), upTo: Math.floor(r() * 50) - 5 }
    case 5:
      return { t: 'away', away: r() < 0.5 ? r() < 0.5 : any() }
    case 6:
      return { t: 'ping', c: any() }
    case 7:
      return { t: 'kick', id: id() }
    case 8:
      return { t: pick(r, ['end', 'leave', 'hello', 'welcome', 'nope']) }
    case 9:
      return any()
    case 10:
      return { t: 'msg', ch: pick(r, CHANNELS), data: { deep: [[[[[[any()]]]]]] } }
    default:
      return { t: 'msg', ...(any() as object) }
  }
}

test('frames at random from four members: the hub never throws, and the room still works afterwards', () => {
  const w = new World()
  const room = w.room()
  const r = rng(424242)
  let players = [0, 1, 2, 3].map(() => w.join({ key: room.key }))
  for (let i = 0; i < 6000; i++) {
    const ids = players.map((p) => p.id)
    const p = pick(r, players)
    const roll = r()
    assert.doesNotThrow(() => {
      if (roll < 0.75) {
        let text = JSON.stringify(frame(r, ids)) ?? 'null'
        if (r() < 0.05) text = text.slice(0, Math.floor(r() * text.length))
        w.hub.receive(p.session, text)
      } else if (roll < 0.95) {
        const header = r() < 0.5
          ? { t: 'msg', ch: pick(r, CHANNELS), parts: [[pick(r, ids), 1], [pick(r, ids), Math.floor(r() * 3)]] }
          : { t: 'msg', ch: pick(r, CHANNELS), to: r() < 0.5 ? 'all' : pick(r, ids), volatile: r() < 0.5 }
        const payload = Uint8Array.from({ length: Math.floor(r() * 4) }, () => Math.floor(r() * 256))
        let bytes = encodeBinary(JSON.stringify(header), payload)
        if (r() < 0.1) bytes = bytes.slice(0, Math.floor(r() * bytes.length))
        w.hub.receiveBinary(p.session, bytes)
      } else {
        w.advance(Math.floor(r() * 3000))
        w.hub.flushPresence()
      }
    }, `step ${i}`)
    // Whoever the server closed (a malformed frame, a kick) has its socket close, as the socket layer would tell
    // the hub, and comes back as a new member.
    players = players.map((q) => {
      if (!q.conn.closed) return q
      w.drop(q)
      return w.join({ key: room.key })
    })
  }
  // Two who come in now can still talk: a plain message goes from one to the other. (A random `end` may have
  // closed everybody who was there.)
  // Those who were closed keep their places for 30 s: after that there is room.
  w.advance(31_000)
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  assert.ok(a.id && b.id, JSON.stringify([a.conn.of('error'), b.conn.of('error')]))
  b.conn.clear()
  w.send(a, { t: 'msg', ch: 'after', data: 'still here' })
  assert.deepEqual(b.conn.of('msg').map((m) => m.data), ['still here'])
})
