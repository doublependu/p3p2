// The generator against a real server in this process: every profile, sped up, for a moment.
// It guards the generator against drifting away from the protocol.

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { SOURCE_URL } from '../../server/src/config.ts'
import { DEFAULT_LIMITS } from '../../server/src/core/limits.ts'
import { type Running, startServer } from '../../server/src/server.ts'
import { Load } from '../src/load.ts'
import type { Target } from '../src/target.ts'
import type { ProfileName, Result } from '../src/types.ts'

let server: Running
let target: Target

before(async () => {
  const password = 'bench test password'
  const statsToken = 'bench-test-stats-token'
  server = await startServer({
    publicUrl: 'http://127.0.0.1',
    name: 'bench test',
    sourceUrl: SOURCE_URL,
    port: 0,
    host: '127.0.0.1',
    dataDir: ':memory:',
    logLevel: 'silent',
    trustProxy: false,
    ownerPassword: password,
    statsToken,
    // No limit stands in the way: the profiles run many times faster here than they are meant to.
    limits: {
      ...DEFAULT_LIMITS,
      connectRate: 1000,
      connectBurst: 1000,
      apiRate: 1000,
      apiBurst: 1000,
      msgRate: 10_000,
      msgBurst: 10_000,
    },
  })
  target = { url: `http://127.0.0.1:${server.port}`, password, statsToken, where: 'this process', disposable: false, async stop() {} }
})

after(async () => {
  await server.close()
})

async function measure(profile: ProfileName, speed: number, rooms: number, members: number, seconds: number): Promise<Result> {
  const load = await Load.start(target, { profile, members, workers: 2, speed })
  try {
    await load.scale(rooms)
    return await load.measure(seconds)
  } finally {
    await load.close()
  }
}

test('chat: every line reaches everyone, the sender included', async () => {
  // Ten times the profile's rate: a line a second from each of 12 members in 3 rooms.
  const r = await measure('chat', 10, 3, 4, 2.5)
  assert.deepEqual([r.rooms, r.members, r.connections], [3, 4, 12])
  const { chat, ping } = r.series
  assert.ok(chat && chat.sent >= 12 && chat.received >= chat.sent * 3, JSON.stringify(chat))
  assert.equal(chat.missed, 0)
  assert.ok(chat.p50 > 0 && chat.p50 <= chat.p99 && chat.p99 < 500, JSON.stringify(chat))
  assert.ok(ping && ping.received > 0)
  assert.deepEqual([r.errors, r.closes], [{}, 0])
  assert.ok(r.cpu > 0 && r.rss > 0 && r.framesIn > 0 && r.framesOut > r.framesIn && r.bytesOut > 0)
})

test('presence: batches arrive, a tick late at most', async () => {
  const r = await measure('presence', 1, 1, 5, 2)
  const p = r.series.presence
  assert.ok(p && p.sent >= 60 && p.received >= p.sent * 3, JSON.stringify(p))
  assert.equal(p.missed, 0)
  assert.ok(p.p99 < 150, JSON.stringify(p))
  assert.deepEqual([r.errors, r.closes, r.presenceSkipped], [{}, 0, 0])
})

test('snapshots: bytes from the host to the guests, inputs from the guests to the host', async () => {
  const r = await measure('snapshots', 1, 1, 4, 2)
  const { snapshot, input } = r.series
  assert.ok(snapshot && snapshot.sent >= 20 && snapshot.received >= snapshot.sent * 2, JSON.stringify(snapshot))
  assert.ok(input && input.sent >= 80 && input.received >= input.sent * 0.8, JSON.stringify(input))
  assert.deepEqual([snapshot.missed, input.missed, r.errors, r.closes], [0, 0, {}, 0])
  // 3 guests × 15 snapshots a second × 4 KB.
  assert.ok(r.bytesOut > 100_000, String(r.bytesOut))
})

test('ops: numbered, saved, and back to everyone including the sender; the host saves snapshots', async () => {
  // Fifty times the rate: 100 ops a second from each of 4 members, so the host's snapshot at op 1,000 falls inside.
  const load = await Load.start(target, { profile: 'ops', members: 4, workers: 1, speed: 50 })
  try {
    await load.scale(1)
    const r = await load.measure(4)
    const { op } = r.series
    assert.ok(op && op.sent >= 800 && op.received >= op.sent * 3.5, JSON.stringify(op))
    assert.equal(op.missed, 0)
    assert.ok(op.p99 < 500, JSON.stringify(op))
    assert.deepEqual([r.errors, r.closes], [{}, 0])
    // Written in batches, but every op is written.
    assert.ok(r.writes > 200, String(r.writes))
    await load.scale(0)
    const saved = server.app.store.loadLog(server.app.store.listRooms()[0]!.id)
    assert.ok(saved.snap && saved.snap.upTo >= 1000 && saved.snap.upTo % 1000 === 0, String(saved.snap?.upTo))
    assert.ok(saved.ops.length > 0 && saved.ops.length < 1000 && saved.ops[0]!.seq === saved.snap.upTo + 1, String(saved.ops.length))
  } finally {
    await load.close()
  }
})

test('mixed: members come and go, values are saved, and the room carries on', async () => {
  // Sixty times the rate: a replacement every half second, a cut every five, a save every second.
  const load = await Load.start(target, { profile: 'mixed', members: 4, workers: 1, speed: 60 })
  try {
    await load.scale(1)
    const r = await load.measure(6)
    const { saved, chat } = r.series
    assert.ok(saved && saved.sent >= 12 && saved.received >= saved.sent, JSON.stringify(saved))
    assert.ok(chat && chat.received > 0)
    assert.ok(r.writes > 1, String(r.writes))
    assert.deepEqual([r.errors, r.closes], [{}, 0])
    // Every replacement was a new member: the server has handed out more ids than there are slots.
    const live = server.app.hub.live(server.app.store.listRooms()[0]!.id)!
    const ids = live.members.map((m) => m.id)
    assert.ok(ids.length >= 3 && ids.length <= 5 && Math.max(...ids) > 8, JSON.stringify(ids))
  } finally {
    await load.close()
  }
})

test('scaling up and down fills and empties rooms', async () => {
  const load = await Load.start(target, { profile: 'idle', members: 3, workers: 2, speed: 1 })
  try {
    await load.scale(4)
    assert.equal((await load.admin.stats()).connections, 12)
    await load.scale(1)
    assert.equal((await load.admin.stats()).connections, 3)
    assert.equal(server.app.hub.roomCount, 1)
  } finally {
    await load.close()
  }
  // The rooms of a server that stays are deleted.
  assert.equal(server.app.store.countRooms(), 0)
})
