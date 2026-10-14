import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GAME, untimed, World } from './helpers.ts'

test('the first member becomes the host; key holders are mods, guests are not', () => {
  const w = new World()
  const room = w.room()
  const code = w.invite(room)

  const host = w.join({ key: room.key }, { name: 'Ada' })
  const welcome = host.conn.of('welcome')[0]!
  assert.equal(welcome.self.id, 1)
  assert.equal(welcome.self.mod, true)
  assert.equal(welcome.host, 1)
  assert.equal(welcome.room.name, 'Friday games')
  assert.deepEqual(welcome.members, [{ id: 1, pid: host.pid, name: 'Ada', order: 1 }])
  assert.equal(welcome.now, w.time)

  const guest = w.join({ invite: code }, { name: 'Grace' })
  const second = guest.conn.of('welcome')[0]!
  assert.equal(second.self.mod, false)
  assert.equal(second.host, 1)
  assert.deepEqual(
    second.members.map((m) => m.name),
    ['Ada', 'Grace'],
  )
  assert.deepEqual(host.conn.of('member+'), [{ t: 'member+', id: 2, pid: guest.pid, name: 'Grace', order: 2 }])
  assert.equal(guest.conn.of('member+').length, 0)
  assert.equal(w.hub.memberCount(room.id), 2)
  assert.equal(w.hub.hostName(room.id), 'Ada')
})

test('names are cleaned; an empty name gets a default', () => {
  const w = new World()
  const room = w.room()
  const a = w.join({ key: room.key }, { name: '  Ada‮\n Lovelace ' })
  const b = w.join({ key: room.key }, { name: '​' })
  assert.equal(a.conn.of('welcome')[0]!.self.name, 'Ada Lovelace')
  assert.equal(b.conn.of('welcome')[0]!.self.name, 'Player 2')
})

test('refusals: unknown key, unknown invite, wrong origin, wrong protocol', () => {
  const w = new World()
  const room = w.room()
  const code = w.invite(room)
  const refused = (auth: { key: string } | { invite: string }, origin?: string) => {
    const p = w.join(auth, { origin })
    assert.equal(p.id, 0)
    assert.equal(p.conn.closed, true)
    return p.conn.of('error')[0]?.code
  }
  assert.equal(refused({ key: 'x'.repeat(26) }), 'auth')
  assert.equal(refused({ key: room.key.slice(0, 25) + (room.key.endsWith('0') ? '1' : '0') }), 'auth')
  assert.equal(refused({ invite: '0000000000' }), 'auth')
  assert.equal(refused({ key: room.key }, 'https://evil.example'), 'origin')
  assert.equal(refused({ invite: code }, 'https://evil.example'), 'origin')
  assert.equal(w.hub.roomCount, 0)

  const { conn, session } = w.connect()
  w.hub.receive(
    session,
    JSON.stringify({
      t: 'hello',
      proto: 2,
      auth: { key: room.key },
      player: { pid: 'p'.repeat(16), secret: 's'.repeat(16) },
      game: { id: 'test', version: '1' },
      name: 'x',
    }),
  )
  assert.equal(conn.of('error')[0]?.code, 'proto')
})

test('an extra origin added to the room is accepted', () => {
  const w = new World()
  const room = w.room({ origins: [GAME, 'http://192.168.1.118:5173'] })
  assert.equal(w.join({ key: room.key }, { origin: 'http://192.168.1.118:5173' }).id, 1)
})

test('a player id is bound to its secret on first use', () => {
  const w = new World()
  const room = w.room()
  const a = w.join({ key: room.key }, { pid: 'p'.repeat(20), secret: 's'.repeat(20) })
  assert.equal(a.id, 1)
  const thief = w.join({ key: room.key }, { pid: 'p'.repeat(20), secret: 'x'.repeat(20) })
  assert.equal(thief.conn.of('error')[0]?.code, 'player')
  // The same player in a second tab is a second member.
  const again = w.join({ key: room.key }, { pid: 'p'.repeat(20), secret: 's'.repeat(20) })
  assert.equal(again.id, 2)
})

test('a full room refuses the next member, but a member in its grace period keeps its slot', () => {
  const w = new World()
  const room = w.room({ maxMembers: 2 })
  const a = w.join({ key: room.key })
  const b = w.join({ key: room.key })
  assert.equal(w.join({ key: room.key }).conn.of('error')[0]?.code, 'full')
  w.drop(b)
  assert.equal(w.join({ key: room.key }).conn.of('error')[0]?.code, 'full')
  w.advance(w.limits.graceMs)
  assert.equal(w.join({ key: room.key }).id, 3)
  assert.equal(a.conn.of('member-').length, 1)
})

test('routing: others by default, all, host, one member, several members', () => {
  const w = new World()
  const room = w.room()
  const [a, b, c] = [w.join({ key: room.key }), w.join({ key: room.key }), w.join({ key: room.key })]
  const got = () => [a, b, c].map((p) => p.conn.of('msg').map((m) => m.data))
  const reset = () => {
    for (const p of [a, b, c]) p.conn.clear()
  }

  w.send(b, { t: 'msg', ch: 'x', data: 1 })
  assert.deepEqual(got(), [[1], [], [1]])
  assert.deepEqual(a.conn.of('msg')[0], { t: 'msg', from: b.id, ch: 'x', data: 1, ts: w.time })

  reset()
  w.send(b, { t: 'msg', ch: 'x', data: 2, to: 'all' })
  assert.deepEqual(got(), [[2], [2], [2]])

  reset()
  w.send(b, { t: 'msg', ch: 'x', data: 3, to: 'host' })
  w.send(a, { t: 'msg', ch: 'x', data: 4, to: 'host' })
  assert.deepEqual(got(), [[3, 4], [], []])

  reset()
  w.send(a, { t: 'msg', ch: 'x', data: 5, to: c.id })
  w.send(a, { t: 'msg', ch: 'x', data: 6, to: [b.id, c.id, c.id, 99] })
  w.send(a, { t: 'msg', ch: 'x', data: 7, to: 99 })
  assert.deepEqual(got(), [[], [6], [5, 6]])
})

test('data passes through untouched', () => {
  const w = new World()
  const room = w.room()
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  const data = { s: 'a "quoted"   line', n: -0.5, list: [null, true, { deep: [1, [2, [3]]] }], '': '' }
  w.send(a, { t: 'msg', ch: 'x', data })
  assert.deepEqual(b.conn.of('msg')[0]!.data, data)
})

test("retain: 'room' is saved, sent to later members, survives the room closing, and null clears it", () => {
  const w = new World()
  const room = w.room()
  const a = w.join({ key: room.key })
  w.send(a, { t: 'msg', ch: 'world', data: { seed: 42 }, retain: 'room' })
  w.send(a, { t: 'msg', ch: 'mode', data: 'night', retain: 'room' })
  w.send(a, { t: 'msg', ch: 'world', data: { seed: 43 }, retain: 'room' })

  const b = w.join({ key: room.key })
  assert.deepEqual(b.conn.of('welcome')[0]!.retained.room, { world: { seed: 43 }, mode: 'night' })

  w.send(a, { t: 'leave' })
  w.send(b, { t: 'leave' })
  assert.equal(w.hub.roomCount, 0)

  const c = w.join({ key: room.key })
  assert.deepEqual(c.conn.of('welcome')[0]!.retained.room, { world: { seed: 43 }, mode: 'night' })
  w.send(c, { t: 'msg', ch: 'mode', data: null, retain: 'room' })
  w.send(c, { t: 'leave' })
  assert.deepEqual(w.join({ key: room.key }).conn.of('welcome')[0]!.retained.room, { world: { seed: 43 } })
})

test("retain: 'room' goes to everyone, the sender included, and is marked", () => {
  const w = new World()
  const room = w.room()
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  w.send(a, { t: 'msg', ch: 'world', data: 1, retain: 'room' })
  w.send(b, { t: 'msg', ch: 'world', data: null, retain: 'room', to: 'all' })
  for (const p of [a, b]) {
    assert.deepEqual(p.conn.of('msg'), [
      { t: 'msg', from: a.id, ch: 'world', data: 1, ts: w.time, retain: 'room' },
      { t: 'msg', from: b.id, ch: 'world', data: null, ts: w.time, retain: 'room' },
    ])
  }
  w.send(a, { t: 'msg', ch: 'world', data: 2, retain: 'room', to: 'host' })
  assert.equal(a.conn.of('error')[0]?.code, 'bad-frame')
})

test("retain: 'room' over the size cap is refused and not relayed", () => {
  const w = new World({ maxRetainedBytes: 1000 })
  const room = w.room()
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  w.send(a, { t: 'msg', ch: 'a', data: 'x'.repeat(600), retain: 'room' })
  w.send(a, { t: 'msg', ch: 'b', data: 'x'.repeat(600), retain: 'room' })
  assert.equal(a.conn.of('error')[0]?.code, 'too-big')
  assert.equal(a.conn.closed, false)
  assert.equal(b.conn.of('msg').length, 1)
  assert.equal(a.conn.of('msg').length, 1)
  // Replacing a value counts the difference, not the sum.
  w.send(a, { t: 'msg', ch: 'a', data: 'y'.repeat(900), retain: 'room' })
  assert.equal(b.conn.of('msg').length, 2)
})

test("retain: 'tail' keeps the last 50 per channel, in memory only", () => {
  const w = new World()
  const room = w.room()
  const a = w.join({ key: room.key }, { name: 'Ada' })
  for (let i = 1; i <= 60; i++) w.send(a, { t: 'msg', ch: '$chat', data: `m${i}`, retain: 'tail' })
  const b = w.join({ key: room.key })
  const tail = b.conn.of('welcome')[0]!.retained.tail.$chat!
  assert.equal(tail.length, 50)
  assert.deepEqual(tail[0], { from: a.id, pid: a.pid, name: 'Ada', data: 'm11', ts: w.time })
  assert.equal(tail.at(-1)!.data, 'm60')

  w.send(a, { t: 'leave' })
  w.send(b, { t: 'leave' })
  assert.deepEqual(w.join({ key: room.key }).conn.of('welcome')[0]!.retained.tail, {})
})

test('tails share a byte budget: the oldest message of any channel goes first', () => {
  const w = new World({ maxTailBytes: 1000 })
  const room = w.room()
  const a = w.join({ key: room.key })
  w.send(a, { t: 'msg', ch: 'one', data: 'x'.repeat(300), retain: 'tail' })
  w.send(a, { t: 'msg', ch: 'two', data: 'y'.repeat(300), retain: 'tail' })
  w.send(a, { t: 'msg', ch: 'two', data: 'z'.repeat(300), retain: 'tail' })
  const tail = w.join({ key: room.key }).conn.of('welcome')[0]!.retained.tail
  assert.deepEqual(Object.keys(tail), ['two'])
  assert.equal(tail.two!.length, 2)
})

test("retain: 'player' saves one value per player and channel, for everyone, and outlives the visit", () => {
  const w = new World()
  const room = w.room()
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  w.send(a, { t: 'msg', ch: 'pos', data: { x: 1 }, retain: 'player' })
  w.send(b, { t: 'msg', ch: 'pos', data: { x: 2 }, retain: 'player' })
  w.send(a, { t: 'msg', ch: 'pos', data: { x: 3 }, retain: 'player' })
  w.send(a, { t: 'msg', ch: 'bag', data: ['kernel'], retain: 'player', to: 'all' })
  // Everyone, the sender included, sees whose value it is from `from`.
  for (const p of [a, b]) {
    assert.deepEqual(
      p.conn.of('msg').map((m) => [m.from, m.ch, m.data, m.retain]),
      [
        [a.id, 'pos', { x: 1 }, 'player'],
        [b.id, 'pos', { x: 2 }, 'player'],
        [a.id, 'pos', { x: 3 }, 'player'],
        [a.id, 'bag', ['kernel'], 'player'],
      ],
    )
  }
  w.send(a, { t: 'msg', ch: 'pos', data: 1, retain: 'player', to: 'host' })
  assert.equal(a.conn.of('error')[0]?.code, 'bad-frame')

  const saved = { [a.pid]: { pos: { x: 3 }, bag: ['kernel'] }, [b.pid]: { pos: { x: 2 } } }
  assert.deepEqual(w.join({ key: room.key }).conn.of('welcome')[0]!.retained.player, saved)

  // Everyone leaves. Days later one of them is back: the values are still there, under the player id.
  w.send(b, { t: 'leave' })
  w.advance(w.limits.graceMs)
  w.advance(1)
  assert.equal(w.hub.roomCount, 1)
  w.hub.end(room.id, 'ended', false)
  assert.equal(w.hub.roomCount, 0)
  const back = w.join({ key: room.key }, { pid: b.pid })
  assert.deepEqual(back.conn.of('welcome')[0]!.retained.player, saved)
  assert.deepEqual(back.conn.of('welcome')[0]!.retained.room, {})

  // null clears one value; a player's last value takes the player out of the list.
  w.send(back, { t: 'msg', ch: 'pos', data: null, retain: 'player' })
  assert.deepEqual(w.join({ key: room.key }).conn.of('welcome')[0]!.retained.player, { [a.pid]: saved[a.pid] })
})

test('first: a saved value is set only if there is none yet, and whoever was late is told what there is', () => {
  const w = new World()
  const room = w.room()
  const [a, b, c] = [w.join({ key: room.key }), w.join({ key: room.key }), w.join({ key: room.key })]
  for (const p of [a, b, c]) p.conn.clear()

  // Two offer a world at the same moment. The server takes them one after the other.
  w.send(a, { t: 'msg', ch: 'world', data: { seed: 1 }, retain: 'room', first: true })
  w.time += 5
  w.send(b, { t: 'msg', ch: 'world', data: { seed: 2 }, retain: 'room', first: true })

  // The first is saved and goes to everyone, its sender included, like any saved value.
  const set = { t: 'msg', from: a.id, ch: 'world', data: { seed: 1 }, ts: 1_000_000, retain: 'room' }
  assert.deepEqual(a.conn.of('msg'), [set])
  assert.deepEqual(c.conn.of('msg'), [set])
  // The second changes nothing, and nobody hears of it but its sender, who gets the value that
  // is there, from nobody, with the time it was saved.
  assert.deepEqual(b.conn.of('msg'), [set, { ...set, from: 0 }])
  assert.deepEqual(w.join({ key: room.key }).conn.of('welcome')[0]!.retained.room, { world: { seed: 1 } })

  // Without `first` a value is replaced as before, and once it is cleared the next `first` wins.
  w.send(c, { t: 'msg', ch: 'world', data: { seed: 3 }, retain: 'room' })
  assert.deepEqual(a.conn.last(), { ...set, from: c.id, data: { seed: 3 }, ts: 1_000_005 })
  w.send(c, { t: 'msg', ch: 'world', data: null, retain: 'room' })
  w.send(b, { t: 'msg', ch: 'world', data: { seed: 2 }, retain: 'room', first: true })
  assert.deepEqual(a.conn.last(), { ...set, from: b.id, data: { seed: 2 }, ts: 1_000_005 })

  // The same for a player's own value: each player has a first of their own.
  for (const p of [a, b, c]) p.conn.clear()
  w.send(a, { t: 'msg', ch: 'bag', data: ['key'], retain: 'player', first: true })
  w.send(b, { t: 'msg', ch: 'bag', data: ['map'], retain: 'player', first: true })
  w.send(a, { t: 'msg', ch: 'bag', data: [], retain: 'player', first: true })
  const bags = (p: typeof a) => p.conn.of('msg').map((m) => [m.from, m.data])
  assert.deepEqual(bags(c), [[a.id, ['key']], [b.id, ['map']]])
  assert.deepEqual(bags(a), [[a.id, ['key']], [b.id, ['map']], [a.id, ['key']]])
})

test("retain: 'player': when the room is full, players who are away make room, longest away first", () => {
  // A value of 60 characters counts 82 bytes here: its JSON, its channel, its player id.
  const w = new World({ maxRetainedBytes: 300 })
  const room = w.room()
  const value = 'x'.repeat(60)
  const save = (p: ReturnType<World['join']>, data: unknown = value) => w.send(p, { t: 'msg', ch: 'pos', data, retain: 'player' })
  const [a, b, c] = [w.join({ key: room.key }), w.join({ key: room.key }), w.join({ key: room.key })]
  for (const p of [a, b, c]) save(p)
  w.send(b, { t: 'leave' })
  w.time += 1000
  w.send(c, { t: 'leave' })
  // Coming in again counts as use: now c is the one who has been away longest.
  w.time += 1000
  w.send(w.join({ key: room.key }, { pid: b.pid }), { t: 'leave' })

  const d = w.join({ key: room.key })
  a.conn.clear()
  save(d)
  assert.deepEqual(a.conn.of('forget'), [{ t: 'forget', pid: c.pid }])
  assert.deepEqual(d.conn.of('forget'), [{ t: 'forget', pid: c.pid }])
  assert.equal(d.conn.of('error').length, 0)
  const players = () => Object.keys(w.join({ key: room.key }).conn.of('welcome')[0]!.retained.player).sort()
  assert.deepEqual(players(), [a.pid, b.pid, d.pid].sort())
  assert.deepEqual(w.store.loadRetained(room.id).map((r) => r.pid).sort(), [a.pid, b.pid, d.pid].sort())

  // Forgetting b would not be enough for this one, so nobody is forgotten. Players who are here never are.
  save(a, 'x'.repeat(200))
  assert.equal(a.conn.of('error').at(-1)?.code, 'too-big')
  assert.equal(a.conn.of('forget').length, 1)
  assert.deepEqual(players(), [a.pid, b.pid, d.pid].sort())
})

test("retain: 'player' shares the room's size cap with room values", () => {
  const w = new World({ maxRetainedBytes: 1000 })
  const room = w.room()
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  w.send(a, { t: 'msg', ch: 'world', data: 'x'.repeat(400), retain: 'room' })
  w.send(a, { t: 'msg', ch: 'pos', data: 'x'.repeat(400), retain: 'player' })
  w.send(b, { t: 'msg', ch: 'pos', data: 'x'.repeat(400), retain: 'player' })
  assert.equal(b.conn.of('error')[0]?.code, 'too-big')
  assert.equal(a.conn.of('msg').length, 2)
  w.send(a, { t: 'msg', ch: 'world', data: null, retain: 'room' })
  w.send(b, { t: 'msg', ch: 'pos', data: 'x'.repeat(400), retain: 'player' })
  assert.equal(b.conn.of('error').length, 1)
  assert.deepEqual(Object.keys(w.join({ key: room.key }).conn.of('welcome')[0]!.retained.player).sort(), [a.pid, b.pid].sort())
})

test('presence: the latest value per member, batched, to the others only', () => {
  const w = new World()
  const room = w.room()
  const [a, b, c] = [w.join({ key: room.key }), w.join({ key: room.key }), w.join({ key: room.key })]
  w.send(a, { t: 'pres', data: { x: 1 } })
  w.send(a, { t: 'pres', data: { x: 2 } })
  w.send(b, { t: 'pres', data: 'b' })
  // Nothing goes out until the tick.
  assert.equal([a, b, c].flatMap((p) => p.conn.of('pres')).length, 0)
  assert.deepEqual(w.flush(a, b, c), [[[b.id, 'b']], [[a.id, { x: 2 }]], [[a.id, { x: 2 }], [b.id, 'b']]])
  // One frame per receiver, and none when nothing changed.
  assert.equal(c.conn.of('pres').length, 1)
  assert.deepEqual(w.flush(a, b, c), [[], [], []])

  // A value that did not change is not sent again.
  w.send(a, { t: 'pres', data: { x: 2 } })
  assert.deepEqual(w.flush(a, b, c), [[], [], []])
  // null clears.
  w.send(a, { t: 'pres', data: null })
  w.send(a, { t: 'pres', data: null })
  assert.deepEqual(w.flush(a, b, c), [[], [[a.id, null]], [[a.id, null]]])
})

test('presence: a new member gets the current values in welcome, without its own', () => {
  const w = new World()
  const room = w.room()
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  w.send(a, { t: 'pres', data: 'a' })
  w.send(b, { t: 'pres', data: 'b' })
  // Even before the tick has passed them on.
  const c = w.join({ key: room.key })
  assert.deepEqual(untimed(c.conn.of('welcome')[0]!.presence), [[a.id, 'a'], [b.id, 'b']])
  w.flush(a, b, c)

  // A member that comes back gets them again, and keeps its own on the server.
  w.drop(b)
  w.send(a, { t: 'pres', data: 'a2' })
  w.flush(a, c)
  const back = w.join({ key: room.key }, { pid: b.pid, resume: { member: b.id, token: b.token } })
  assert.deepEqual(untimed(back.conn.of('welcome')[0]!.presence), [[a.id, 'a2']])
  assert.deepEqual(untimed(w.join({ key: room.key }).conn.of('welcome')[0]!.presence), [[a.id, 'a2'], [b.id, 'b']])
})

test('presence: each value comes with the time the server got it, in batches and in welcome', () => {
  const w = new World()
  const room = w.room()
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  const got = w.time
  w.send(a, { t: 'pres', data: 'a1' })
  // The batch goes out later, and says when the value came, not when the batch left.
  w.time += 40
  b.conn.clear()
  w.hub.flushPresence()
  assert.deepEqual(b.conn.of('pres')[0]!.list, [[a.id, 'a1', got]])
  // The same value again is no new value, and keeps its time.
  w.time += 500
  w.send(a, { t: 'pres', data: 'a1' })
  assert.deepEqual(w.join({ key: room.key }).conn.of('welcome')[0]!.presence, [[a.id, 'a1', got]])
  // A cleared value has no time.
  w.send(a, { t: 'pres', data: null })
  b.conn.clear()
  w.hub.flushPresence()
  assert.deepEqual(b.conn.of('pres')[0]!.list, [[a.id, null]])
})

test('presence: the time the sender says it set the value, within limits', () => {
  const w = new World()
  const room = w.room()
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  const sent = (data: unknown, at?: number) => {
    w.send(a, at === undefined ? { t: 'pres', data } : { t: 'pres', data, at })
    b.conn.clear()
    w.hub.flushPresence()
    return b.conn.of('pres')[0]!.list[0]![2]
  }
  // Never more than a second before it arrived.
  assert.equal(sent('a1', w.time - 5000), w.time - 1000)
  // Set 30 ms before it arrived: that is its time.
  w.time += 2000
  assert.equal(sent('a2', w.time - 30), w.time - 30)
  // Never later than now.
  w.time += 100
  assert.equal(sent('a3', w.time + 500), w.time)
  // Never before the value before it.
  w.time += 100
  assert.equal(sent('a4', w.time - 300), w.time - 100)
  // Without one, when it arrived.
  w.time += 100
  assert.equal(sent('a5'), w.time)
})

test('presence: gone with the member, and never sent after member-', () => {
  const w = new World()
  const room = w.room()
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  w.send(a, { t: 'pres', data: 'a' })
  w.send(a, { t: 'leave' })
  assert.deepEqual(w.flush(b), [[]])
  assert.deepEqual(untimed(w.join({ key: room.key }).conn.of('welcome')[0]!.presence), [])
  // A room that closed with presence pending is not visited again.
  w.send(b, { t: 'pres', data: 'b' })
  w.hub.end(room.id)
  w.hub.flushPresence()
})

test('presence: a receiver that is behind is skipped, then gets everyone\'s latest value', () => {
  const w = new World()
  const room = w.room()
  const [a, b, c] = [w.join({ key: room.key }), w.join({ key: room.key }), w.join({ key: room.key })]
  w.send(c, { t: 'pres', data: 'c1' })
  w.flush(a, b, c)

  b.conn.queued = w.limits.volatileBufferedBytes + 1
  w.send(a, { t: 'pres', data: 'a1' })
  assert.deepEqual(w.flush(a, b, c), [[], [], [[a.id, 'a1']]])
  w.send(a, { t: 'pres', data: 'a2' })
  w.send(c, { t: 'pres', data: null })
  assert.deepEqual(w.flush(a, b, c), [[[c.id, null]], [], [[a.id, 'a2']]])
  // Still behind, and nothing new: nobody gets anything.
  assert.deepEqual(w.flush(a, b, c), [[], [], []])

  // Caught up: one frame with where everyone is now, including the member that cleared its value.
  b.conn.queued = 0
  assert.deepEqual(w.flush(a, b, c), [[], [[a.id, 'a2'], [c.id, null]], []])
  assert.deepEqual(w.flush(a, b, c), [[], [], []])
})

test('presence: values are capped in size', () => {
  const w = new World({ maxPresenceBytes: 100 })
  const room = w.room()
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  w.send(a, { t: 'pres', data: 'x'.repeat(98) })
  w.send(a, { t: 'pres', data: 'x'.repeat(99) })
  assert.equal(a.conn.of('error')[0]?.code, 'too-big')
  assert.equal(a.conn.closed, false)
  assert.deepEqual(w.flush(b), [[[a.id, 'x'.repeat(98)]]])
})

test('binary frames: the header is routed like a message, the payload passes through untouched', () => {
  const w = new World()
  const room = w.room()
  const [a, b, c] = [w.join({ key: room.key }), w.join({ key: room.key }), w.join({ key: room.key })]
  const payload = [0, 255, 1, 128, 34, 92, 10]
  w.sendBinary(b, { t: 'msg', ch: 'snap' }, payload)
  assert.deepEqual(a.conn.binary, [{ header: { t: 'msg', from: b.id, ch: 'snap', ts: w.time }, payload }])
  assert.deepEqual(c.conn.binary, a.conn.binary)
  assert.equal(b.conn.binary.length, 0)

  w.sendBinary(b, { t: 'msg', ch: 'snap', to: 'host' }, [])
  w.sendBinary(a, { t: 'msg', ch: 'snap', to: [c.id, b.id] }, [7])
  w.sendBinary(a, { t: 'msg', ch: 'snap', to: 'all' }, [8])
  assert.deepEqual(
    [a, b, c].map((p) => p.conn.binary.map((f) => f.payload)),
    [[payload, [], [8]], [[7], [8]], [payload, [7], [8]]],
  )
  // Text frames are untouched by all this.
  assert.equal([a, b, c].flatMap((p) => p.conn.of('msg')).length, 0)
})

test('binary frames with a part for each receiver: each gets its own part, and the frame counts once', () => {
  // A burst of three frames: a's hello, and the two messages below.
  const w = new World({ msgRate: 1, msgBurst: 3 })
  const room = w.room()
  const [a, b, c, d] = [w.join({ key: room.key }), w.join({ key: room.key }), w.join({ key: room.key }), w.join({ key: room.key })]
  // Parts in the order of the payload: three bytes for c, none for d, two for b. a gets nothing.
  w.sendBinary(a, { t: 'msg', ch: 'view', parts: [[c.id, 3], [d.id, 0], [b.id, 2]] }, [1, 2, 3, 4, 5])
  const got = (p: typeof a) => p.conn.binary.map((f) => [f.header, f.payload])
  const header = { t: 'msg', from: a.id, ch: 'view', ts: w.time }
  assert.deepEqual(got(c), [[header, [1, 2, 3]]])
  assert.deepEqual(got(d), [[header, []]])
  assert.deepEqual(got(b), [[header, [4, 5]]])
  assert.deepEqual(got(a), [])
  // A member who has gone is skipped, and the others still get theirs.
  w.sendBinary(a, { t: 'msg', ch: 'view', parts: [[999, 1], [b.id, 1]] }, [6, 7])
  assert.deepEqual(b.conn.binary.at(-1)?.payload, [7])
  // Parts that do not add up to the payload close the connection, like any malformed frame.
  const e = w.join({ key: room.key })
  w.sendBinary(e, { t: 'msg', ch: 'view', parts: [[b.id, 2]] }, [1, 2, 3])
  assert.equal(e.conn.closed, true)
  assert.equal(e.conn.of('error')[0]?.code, 'bad-frame')
  // One frame against the rate, whatever the number of parts: a's burst is used up by the three above.
  w.sendBinary(a, { t: 'msg', ch: 'view', parts: [[b.id, 1]] }, [8])
  assert.equal(a.conn.of('error')[0]?.code, 'rate')
  assert.deepEqual(b.conn.binary.at(-1)?.payload, [7])
})

test('binary frames: volatile ones are dropped for a slow receiver; they count against the rate limits', () => {
  const w = new World({ bytesRate: 1000, bytesBurst: 1000 })
  const room = w.room()
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  w.advance(1000)
  b.conn.queued = w.limits.volatileBufferedBytes + 1
  w.sendBinary(a, { t: 'msg', ch: 'snap', volatile: true }, [1])
  w.sendBinary(a, { t: 'msg', ch: 'snap' }, [2])
  assert.deepEqual(
    b.conn.binary.map((f) => f.payload),
    [[2]],
  )
  w.sendBinary(a, { t: 'msg', ch: 'snap' }, Array.from({ length: 1000 }, () => 0))
  assert.equal(a.conn.of('error')[0]?.code, 'rate')
  assert.equal(b.conn.binary.length, 1)
})

test('binary frames: malformed ones close the connection; they cannot be retained', () => {
  const w = new World()
  const room = w.room()
  const refused = (send: (p: ReturnType<World['join']>) => void) => {
    const p = w.join({ key: room.key })
    send(p)
    assert.equal(p.conn.closed, true)
    return p.conn.of('error')[0]?.code
  }
  assert.equal(
    refused((p) => w.hub.receiveBinary(p.session, Uint8Array.from([1, 2, 3]))),
    'bad-frame',
  )
  assert.equal(
    refused((p) => w.hub.receiveBinary(p.session, Uint8Array.from([0]))),
    'bad-frame',
  )
  assert.equal(
    refused((p) => w.sendBinary(p, { t: 'msg', ch: 'has space' }, [1])),
    'bad-frame',
  )
  assert.equal(
    refused((p) => w.sendBinary(p, { t: 'msg', ch: 'snap', retain: 'room' }, [1])),
    'bad-frame',
  )
  assert.equal(
    refused((p) => w.sendBinary(p, { t: 'pres', data: 1 }, [1])),
    'bad-frame',
  )
  // Not before hello.
  const { conn, session } = w.connect()
  w.hub.receiveBinary(session, Uint8Array.from([0, 0]))
  assert.equal(conn.of('error')[0]?.code, 'bad-frame')
})

test('version gate: a different game version is refused while others are in the room', () => {
  const w = new World()
  const room = w.room()
  const a = w.join({ key: room.key }, { version: '1.2.0' })
  assert.equal(w.join({ key: room.key }, { version: '1.2.0' }).id, 2)
  const old = w.join({ key: room.key }, { version: '1.1.9' })
  assert.equal(old.id, 0)
  assert.equal(old.conn.of('error')[0]?.code, 'version')
  assert.match(old.conn.of('error')[0]!.message, /1\.2\.0.*1\.1\.9/)
  assert.equal(old.conn.closed, true)
  assert.equal(w.hub.memberCount(room.id), 2)
  assert.equal(a.conn.of('member+').length, 1)

  // An empty room takes the version of whoever comes first.
  w.hub.end(room.id, 'ended', false)
  assert.equal(w.join({ key: room.key }, { version: '1.1.9' }).id, 1)
  assert.equal(w.join({ key: room.key }, { version: '1.2.0' }).id, 0)
})

test('version gate: the policy can compare the major version only, or nothing', () => {
  const w = new World()
  const major = w.room({ versionPolicy: 'major' })
  w.join({ key: major.key }, { version: '1.2.0' })
  assert.equal(w.join({ key: major.key }, { version: '1.9' }).id, 2)
  assert.equal(w.join({ key: major.key }, { version: '1' }).id, 3)
  assert.equal(w.join({ key: major.key }, { version: '2.0.0' }).conn.of('error')[0]?.code, 'version')
  assert.equal(w.join({ key: major.key }, { version: '10.2.0' }).conn.of('error')[0]?.code, 'version')

  const off = w.room({ versionPolicy: 'off' })
  w.join({ key: off.key }, { version: 'abc' })
  assert.equal(w.join({ key: off.key }, { version: 'xyz' }).id, 2)
})

test('version gate: a member that reloads into a new version comes back only if it is alone', () => {
  const w = new World()
  const room = w.room()
  const a = w.join({ key: room.key }, { version: '1' })
  w.drop(a)
  // Alone: the reload brought a new version, and the room moves on with it.
  const a2 = w.join({ key: room.key }, { pid: a.pid, version: '2', resume: { member: a.id, token: a.token } })
  assert.equal(a2.id, a.id)
  assert.equal(w.join({ key: room.key }, { version: '1' }).id, 0)
  const b = w.join({ key: room.key }, { version: '2' })
  assert.equal(b.id, 2)

  // With others in the room, it has to match them. Its place stays for the grace period.
  w.drop(b)
  const b3 = w.join({ key: room.key }, { pid: b.pid, version: '3', resume: { member: b.id, token: b.token } })
  assert.equal(b3.conn.of('error')[0]?.code, 'version')
  assert.equal(w.hub.memberCount(room.id), 2)
  assert.equal(w.join({ key: room.key }, { pid: b.pid, version: '2', resume: { member: b.id, token: b.token } }).id, b.id)
})

test('a host whose connection drops keeps the role for a moment; then the earliest connected member takes it', () => {
  const w = new World()
  const room = w.room()
  const [a, b, c] = [w.join({ key: room.key }), w.join({ key: room.key }), w.join({ key: room.key })]
  w.drop(a)
  w.advance(w.limits.hostGraceMs - 1)
  assert.equal(b.conn.of('host').length, 0)
  w.advance(1)
  assert.deepEqual(b.conn.of('host'), [{ t: 'host', id: b.id }])
  assert.deepEqual(c.conn.of('host'), [{ t: 'host', id: b.id }])
  // The slot outlives the role.
  w.advance(w.limits.graceMs - w.limits.hostGraceMs - 1)
  assert.equal(b.conn.of('member-').length, 0)
  w.advance(1)
  assert.deepEqual(b.conn.of('member-'), [{ t: 'member-', id: a.id, reason: 'timeout' }])
  assert.equal(b.conn.of('host').length, 1)
  // A later member joins behind the ones already there.
  const d = w.join({ key: room.key })
  assert.equal(d.conn.of('welcome')[0]!.host, b.id)
  w.send(b, { t: 'leave' })
  assert.deepEqual(d.conn.of('host'), [{ t: 'host', id: c.id }])
})

test('the host role does not pass back to a member that returns', () => {
  const w = new World()
  const room = w.room()
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  w.drop(a)
  w.advance(w.limits.hostGraceMs)
  b.conn.clear()
  const again = w.join({ key: room.key }, { pid: a.pid, resume: { member: a.id, token: a.token } })
  const welcome = again.conn.of('welcome')[0]!
  assert.deepEqual([welcome.self.id, welcome.self.order, welcome.host], [a.id, 1, b.id])
  // The host is told that a is back, and nothing else.
  assert.deepEqual(b.conn.frames, [{ t: 'state', id: a.id, state: 'here' }])
  // The earliest member is next in line again when the host goes.
  w.send(b, { t: 'leave' })
  assert.deepEqual(again.conn.of('host'), [{ t: 'host', id: a.id }])
})

test('a host that is the only one connected keeps the role, until someone connected can take it', () => {
  const w = new World()
  const room = w.room()
  const [a, b, c] = [w.join({ key: room.key }), w.join({ key: room.key }), w.join({ key: room.key })]
  w.drop(b)
  w.drop(c)
  w.drop(a)
  w.advance(w.limits.hostGraceMs + 1000)
  assert.equal(w.hub.live(room.id)!.host, a.id)
  const back = w.join({ key: room.key }, { pid: c.pid, resume: { member: c.id, token: c.token } })
  assert.equal(back.conn.of('welcome')[0]!.host, a.id)
  assert.deepEqual(back.conn.of('host'), [{ t: 'host', id: c.id }])
  // When the host leaves, a member that is connected is preferred to an earlier one that is not.
  const d = w.join({ key: room.key })
  w.send(back, { t: 'leave' })
  assert.deepEqual(d.conn.of('host'), [{ t: 'host', id: d.id }])
})

test('away: a host whose page is in the background hands the role to the earliest member in front', () => {
  const w = new World()
  const room = w.room()
  const [a, b, c] = [w.join({ key: room.key }), w.join({ key: room.key }), w.join({ key: room.key })]
  const hosts = () => [a, b, c].map((p) => p.conn.of('host').at(-1)?.id ?? null)
  // Not the host: nothing happens, but it is passed over later.
  w.send(b, { t: 'away', away: true })
  assert.deepEqual(hosts(), [null, null, null])
  w.send(a, { t: 'away', away: true })
  w.send(a, { t: 'away', away: true })
  assert.deepEqual(hosts(), [c.id, c.id, c.id])
  assert.equal(a.conn.of('host').length, 1)
  // Coming back to the front does not take the role back.
  w.send(a, { t: 'away', away: false })
  assert.deepEqual(w.hub.live(room.id)!.host, c.id)
  assert.deepEqual(
    w.hub.live(room.id)!.members.map((m) => m.away),
    [false, true, false],
  )
  // With everyone in the background the host stays, until someone returns.
  w.send(a, { t: 'away', away: true })
  w.send(c, { t: 'away', away: true })
  assert.equal(w.hub.live(room.id)!.host, c.id)
  w.send(b, { t: 'away', away: false })
  assert.deepEqual(hosts(), [b.id, b.id, b.id])
  // A connection in the background is still better than none.
  w.drop(b)
  w.advance(w.limits.hostGraceMs)
  assert.deepEqual([a, c].map((p) => p.conn.of('host').at(-1)?.id), [a.id, a.id])
  // A new connection counts as in front.
  const back = w.join({ key: room.key }, { pid: b.pid, resume: { member: b.id, token: b.token } })
  assert.deepEqual(back.conn.of('host'), [{ t: 'host', id: b.id }])
  assert.equal(w.hub.live(room.id)!.members.find((m) => m.id === b.id)!.away, false)
})

test('member states: the others are told when a member drops, goes to the background, or comes back', () => {
  const w = new World()
  const room = w.room()
  const [a, b, c] = [w.join({ key: room.key }), w.join({ key: room.key }), w.join({ key: room.key })]
  const states = (p: typeof a) => p.conn.of('state').map((f) => [f.id, f.state])
  w.drop(c)
  assert.deepEqual([states(a), states(b)], [[[c.id, 'lost']], [[c.id, 'lost']]])
  w.send(b, { t: 'away', away: true })
  w.send(b, { t: 'away', away: true })
  assert.deepEqual(states(a), [[c.id, 'lost'], [b.id, 'away']])
  // Never told about itself.
  assert.deepEqual(states(b), [[c.id, 'lost']])
  // Somebody who comes in now learns who is not here.
  const d = w.join({ key: room.key })
  assert.deepEqual(d.conn.of('welcome')[0]!.states, [[b.id, 'away'], [c.id, 'lost']])
  w.send(b, { t: 'away', away: false })
  const c2 = w.join({ key: room.key }, { pid: c.pid, resume: { member: c.id, token: c.token } })
  assert.deepEqual(states(d), [[b.id, 'here'], [c.id, 'here']])
  assert.deepEqual(c2.conn.of('welcome')[0]!.states, [])
  assert.deepEqual(
    w.hub.live(room.id)!.members.map((m) => m.state),
    ['here', 'here', 'here', 'here'],
  )
})

test('member states: a page that has stopped is lost after quietMs, and here again when it speaks', () => {
  const w = new World()
  const room = w.room()
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  w.freeze(b)
  w.advance(w.limits.quietMs - 1000)
  assert.deepEqual(a.conn.of('state'), [])
  w.advance(1000)
  assert.deepEqual(a.conn.of('state'), [{ t: 'state', id: b.id, state: 'lost' }])
  // Still connected, and still in the room: its slot is not the question.
  w.advance(w.limits.graceMs * 2)
  assert.equal(w.hub.memberCount(room.id), 2)
  assert.equal(w.hub.live(room.id)!.members[1]!.connected, true)
  // Whatever comes from it next, it is here again.
  w.send(b, { t: 'pres', data: { x: 1 } })
  assert.deepEqual(a.conn.of('state').at(-1), { t: 'state', id: b.id, state: 'here' })
})

test('member states: a page in the background is away, not lost, however long it says nothing', () => {
  const w = new World()
  const room = w.room()
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  w.send(b, { t: 'away', away: true })
  w.advance(w.limits.quietMs * 5)
  assert.deepEqual(a.conn.of('state'), [{ t: 'state', id: b.id, state: 'away' }])
  // Until its connection goes.
  w.drop(b)
  assert.deepEqual(a.conn.of('state').at(-1), { t: 'state', id: b.id, state: 'lost' })
})

test('a host that stops, connected and in front, gives the role away when it is lost', () => {
  const w = new World()
  const room = w.room()
  const [a, b, c] = [w.join({ key: room.key }), w.join({ key: room.key }), w.join({ key: room.key })]
  w.freeze(a)
  w.advance(w.limits.quietMs - 1000)
  assert.equal(b.conn.of('host').length, 0)
  w.advance(1000)
  assert.deepEqual(b.conn.of('state'), [{ t: 'state', id: a.id, state: 'lost' }])
  assert.deepEqual([b.conn.of('host'), c.conn.of('host')], [[{ t: 'host', id: b.id }], [{ t: 'host', id: b.id }]])
  // It wakes up: here again, and not the host again.
  a.frozen = false
  w.advance(1000)
  assert.deepEqual(b.conn.of('state').at(-1), { t: 'state', id: a.id, state: 'here' })
  assert.equal(w.hub.live(room.id)!.host, b.id)
  // A member that has stopped is passed over for one that is in front.
  w.freeze(b)
  w.freeze(a)
  w.advance(w.limits.quietMs)
  assert.equal(w.hub.live(room.id)!.host, c.id)
})

test('leave is immediate; a non-host leaving does not change the host', () => {
  const w = new World()
  const room = w.room()
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  w.send(b, { t: 'leave' })
  assert.deepEqual(a.conn.of('member-'), [{ t: 'member-', id: b.id, reason: 'left' }])
  assert.equal(a.conn.of('host').length, 0)
  assert.equal(b.conn.closed, true)
})

test('resume inside the grace period restores the same member: the others hear only that it is back', () => {
  const w = new World()
  const room = w.room()
  const a = w.join({ key: room.key })
  const b = w.join({ key: room.key })
  w.send(a, { t: 'msg', ch: 'world', data: 7, retain: 'room' })
  w.drop(a)
  w.advance(w.limits.hostGraceMs - 1)
  b.conn.clear()

  const again = w.join({ key: room.key }, { pid: a.pid, resume: { member: a.id, token: a.token } })
  const welcome = again.conn.of('welcome')[0]!
  assert.equal(welcome.self.id, a.id)
  assert.equal(welcome.self.order, 1)
  assert.equal(welcome.host, a.id)
  assert.equal(welcome.token, a.token)
  assert.deepEqual(welcome.retained.room, { world: 7 })
  assert.deepEqual(b.conn.frames, [{ t: 'state', id: a.id, state: 'here' }])

  w.advance(w.limits.graceMs * 2)
  assert.equal(b.conn.of('member-').length, 0)
  w.send(b, { t: 'msg', ch: 'x', data: 1 })
  assert.equal(again.conn.of('msg').length, 1)
})

test('resume replaces a connection that is still open', () => {
  const w = new World()
  const room = w.room()
  const a = w.join({ key: room.key })
  const b = w.join({ key: room.key })
  const again = w.join({ key: room.key }, { pid: a.pid, resume: { member: a.id, token: a.token } })
  assert.equal(again.id, a.id)
  assert.deepEqual(a.conn.last(), { t: 'bye', reason: 'replaced' })
  assert.equal(a.conn.closed, true)
  // The old socket closing afterwards must not put the member back into its grace period.
  w.drop(a)
  w.advance(w.limits.graceMs)
  assert.equal(b.conn.of('member-').length, 0)
  assert.equal(w.hub.memberCount(room.id), 2)
})

test('resume with a wrong token, another player id, or after the grace period joins as a new member', () => {
  const w = new World()
  const room = w.room()
  const a = w.join({ key: room.key })
  const b = w.join({ key: room.key })
  assert.equal(w.join({ key: room.key }, { pid: a.pid, resume: { member: a.id, token: 'wrong' } }).id, 3)
  assert.equal(w.join({ key: room.key }, { resume: { member: a.id, token: a.token } }).id, 4)
  w.drop(b)
  w.advance(w.limits.graceMs)
  assert.equal(w.join({ key: room.key }, { pid: b.pid, resume: { member: b.id, token: b.token } }).id, 5)
})

test('kick and end are for key holders', () => {
  const w = new World()
  const room = w.room()
  const code = w.invite(room)
  const host = w.join({ key: room.key })
  const g1 = w.join({ invite: code })
  const g2 = w.join({ invite: code })

  w.send(g1, { t: 'kick', id: g2.id })
  w.send(g1, { t: 'end' })
  assert.deepEqual(
    g1.conn.of('error').map((e) => e.code),
    ['forbidden', 'forbidden'],
  )
  assert.equal(w.hub.memberCount(room.id), 3)

  w.send(host, { t: 'kick', id: g2.id })
  assert.deepEqual(g2.conn.last(), { t: 'bye', reason: 'kicked' })
  assert.equal(g2.conn.closed, true)
  assert.deepEqual(g1.conn.of('member-'), [{ t: 'member-', id: g2.id, reason: 'kicked' }])

  w.send(host, { t: 'end' })
  assert.deepEqual(g1.conn.last(), { t: 'bye', reason: 'ended' })
  assert.deepEqual(host.conn.last(), { t: 'bye', reason: 'ended' })
  assert.equal(w.hub.roomCount, 0)
  // Ending the session kills the invite.
  assert.equal(w.join({ invite: code }).conn.of('error')[0]?.code, 'auth')
})

test('an invite does not expire while the room has members, then expires after the TTL', () => {
  const w = new World({ inviteTtlMs: 60_000, graceMs: 1000 })
  const room = w.room()
  const code = w.invite(room)
  const host = w.join({ key: room.key })
  w.advance(10 * 60_000)
  const guest = w.join({ invite: code })
  assert.equal(guest.id, 2)

  w.send(host, { t: 'leave' })
  w.drop(guest)
  w.advance(1000)
  assert.equal(w.hub.roomCount, 0)
  w.advance(58_000)
  const back = w.join({ invite: code })
  assert.equal(back.id, 1)
  w.send(back, { t: 'leave' })
  w.advance(60_000)
  assert.equal(w.join({ invite: code }).conn.of('error')[0]?.code, 'auth')
})

test('a revoked invite stops working for new joins; members stay', () => {
  const w = new World()
  const room = w.room()
  const code = w.invite(room)
  const guest = w.join({ invite: code })
  w.store.revokeInvites(room.id, w.time)
  assert.equal(w.join({ invite: code }).conn.of('error')[0]?.code, 'auth')
  assert.equal(guest.conn.closed, false)
})

test('a member who joined with an invite that was renewed since can still resume', () => {
  const w = new World()
  const room = w.room()
  const code = w.invite(room)
  const host = w.join({ key: room.key })
  const guest = w.join({ invite: code })
  w.store.revokeInvites(room.id, w.time)
  w.drop(guest)

  const stranger = w.join({ invite: code }, { resume: { member: guest.id, token: 'guess' } })
  assert.equal(stranger.conn.of('error')[0]?.code, 'auth')
  const back = w.join({ invite: code }, { pid: guest.pid, resume: { member: guest.id, token: guest.token } })
  assert.equal(back.id, guest.id)
  assert.equal(host.conn.of('member-').length, 0)

  // Once the member is gone for good, the old code is dead for it too.
  w.drop(back)
  w.advance(w.limits.graceMs)
  const late = w.join({ invite: code }, { pid: guest.pid, resume: { member: guest.id, token: guest.token } })
  assert.equal(late.conn.of('error')[0]?.code, 'auth')
})

test('rate limit: frames past the burst are dropped, with one warning a second', () => {
  const w = new World({ msgRate: 10, msgBurst: 20 })
  const room = w.room()
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  for (let i = 0; i < 50; i++) w.send(a, { t: 'msg', ch: 'x', data: i })
  assert.equal(b.conn.of('msg').length, 19) // the hello took one token
  assert.equal(a.conn.of('error').length, 1)
  assert.equal(a.conn.of('error')[0]!.code, 'rate')
  assert.equal(a.conn.closed, false)
  w.advance(1000)
  for (let i = 0; i < 50; i++) w.send(a, { t: 'msg', ch: 'x', data: i })
  assert.equal(b.conn.of('msg').length, 29)
  assert.equal(a.conn.of('error').length, 2)
})

test('rate limit: bytes have their own budget', () => {
  const w = new World({ bytesRate: 1000, bytesBurst: 3000 })
  const room = w.room()
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  for (let i = 0; i < 5; i++) w.send(a, { t: 'msg', ch: 'x', data: 'x'.repeat(1000) })
  assert.equal(b.conn.of('msg').length, 2)
  assert.equal(a.conn.of('error')[0]?.code, 'rate')
})

test('malformed frames close the connection', () => {
  const w = new World()
  const room = w.room()
  const a = w.join({ key: room.key })
  w.hub.receive(a.session, '{not json')
  assert.equal(a.conn.of('error')[0]?.code, 'bad-frame')
  assert.equal(a.conn.closed, true)

  const b = w.connect()
  w.hub.receive(b.session, JSON.stringify({ t: 'msg', ch: 'x', data: 1 }))
  assert.equal(b.conn.of('error')[0]?.code, 'bad-frame')
  assert.equal(b.conn.closed, true)

  const c = w.join({ key: room.key })
  w.send(c, { t: 'hello', proto: 1, auth: { key: room.key }, player: { pid: c.pid, secret: 'x'.repeat(16) }, game: { id: 't', version: '1' }, name: '' })
  assert.equal(c.conn.of('error')[0]?.code, 'bad-frame')
})

test('a value nested too deeply to serialize is refused without harming the room', () => {
  const w = new World()
  const room = w.room()
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  const depth = 20_000
  w.hub.receive(a.session, `{"t":"msg","ch":"x","data":${'['.repeat(depth)}${']'.repeat(depth)}}`)
  w.send(b, { t: 'msg', ch: 'x', data: 'still here', to: 'all' })
  assert.equal(b.conn.of('msg').at(-1)?.data, 'still here')
})

test('ping is answered with the server clock', () => {
  const w = new World()
  const room = w.room()
  const a = w.join({ key: room.key })
  w.send(a, { t: 'ping', c: 123.5 })
  assert.deepEqual(a.conn.last(), { t: 'pong', c: 123.5, now: w.time })
})

test('backpressure: volatile messages are dropped for a slow receiver; a hopeless one is disconnected and can resume', () => {
  const w = new World()
  const room = w.room()
  const [a, b, c] = [w.join({ key: room.key }), w.join({ key: room.key }), w.join({ key: room.key })]
  b.conn.queued = w.limits.volatileBufferedBytes + 1
  w.send(a, { t: 'msg', ch: 'pos', data: 1, volatile: true })
  w.send(a, { t: 'msg', ch: 'chat', data: 2 })
  assert.deepEqual(
    b.conn.of('msg').map((m) => m.data),
    [2],
  )
  assert.deepEqual(
    c.conn.of('msg').map((m) => m.data),
    [1, 2],
  )

  b.conn.queued = w.limits.maxBufferedBytes + 1
  w.send(a, { t: 'msg', ch: 'chat', data: 3 })
  assert.deepEqual(b.conn.last(), { t: 'bye', reason: 'slow' })
  assert.equal(b.conn.closed, true)
  assert.equal(w.hub.memberCount(room.id), 3)
  assert.equal(w.join({ key: room.key }, { pid: b.pid, resume: { member: b.id, token: b.token } }).id, b.id)
})

test('counters: frames in and out, and what a receiver that is behind did not get', () => {
  const w = new World()
  const room = w.room()
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  const before = { ...w.hub.counters }
  w.send(a, { t: 'msg', ch: 'x', data: 1, to: 'all' })
  w.send(a, { t: 'pres', data: 'a1' })
  w.flush(a, b)
  b.conn.queued = w.limits.volatileBufferedBytes + 1
  w.send(a, { t: 'msg', ch: 'x', data: 2, volatile: true })
  w.send(a, { t: 'pres', data: 'a2' })
  w.flush(a, b)

  // In: two messages and two presence values. Out: the first message to both, one presence batch.
  const c = w.hub.counters
  assert.deepEqual([c.framesIn - before.framesIn, c.framesOut - before.framesOut], [4, 3])
  assert.deepEqual([c.presenceOut, c.presenceSkipped, c.volatileDropped], [1, 1, 1])
  assert.equal(w.hub.memberTotal, 2)
})

test('counters: what was received by kind, and what the rate limit refused', () => {
  const w = new World({ msgRate: 2, msgBurst: 4 })
  const room = w.room()
  const a = w.join({ key: room.key })
  w.join({ key: room.key })
  const kinds = () => JSON.parse(JSON.stringify(w.hub.counters.kinds)) as typeof w.hub.counters.kinds
  w.advance(10_000)
  const before = kinds()
  w.send(a, { t: 'msg', ch: 'x', data: 'hello' })
  w.sendBinary(a, { t: 'msg', ch: 'x' }, [1, 2, 3])
  w.send(a, { t: 'pres', data: 1 })
  w.send(a, { t: 'op', op: { n: 1 } })
  const after = kinds()
  const frames = (k: keyof typeof after) => after[k].frames - before[k].frames
  assert.deepEqual([frames('msg'), frames('bin'), frames('pres'), frames('op'), frames('snap'), frames('other')], [1, 1, 1, 1, 0, 0])
  assert.equal(after.msg.bytes - before.msg.bytes, JSON.stringify({ t: 'msg', ch: 'x', data: 'hello' }).length)
  assert.ok(after.bin.bytes - before.bin.bytes > 3)

  // The burst is used up by those four. The next frame is refused and counted, and is not counted by kind.
  assert.equal(w.hub.counters.rateDropped, 0)
  w.send(a, { t: 'msg', ch: 'x', data: 'too many' })
  assert.equal(w.hub.counters.rateDropped, 1)
  assert.equal(kinds().msg.frames, after.msg.frames)
})

test('round-trip times are shared with the room', () => {
  const w = new World()
  const room = w.room()
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  a.session.rtt = 12
  w.hub.broadcastRtt()
  assert.deepEqual(b.conn.of('members'), [{ t: 'members', rtt: [[a.id, 12]] }])
})

test('the portal can see, kick and end', () => {
  const w = new World()
  const room = w.room()
  const code = w.invite(room)
  const host = w.join({ key: room.key }, { name: 'Ada' })
  const guest = w.join({ invite: code }, { name: 'Grace' })
  w.drop(guest)
  assert.deepEqual(
    w.hub.live(room.id)!.members.map((m) => [m.name, m.mod, m.connected]),
    [
      ['Ada', true, true],
      ['Grace', false, false],
    ],
  )
  assert.equal(w.hub.kick(room.id, guest.id), true)
  assert.equal(w.hub.kick(room.id, 99), false)
  w.hub.end(room.id)
  assert.deepEqual(host.conn.last(), { t: 'bye', reason: 'ended' })
  assert.equal(w.hub.live(room.id), null)
  assert.equal(w.store.currentInvite(room.id, w.time), null)
})

test('shutdown says goodbye and starts the invite countdown', () => {
  const w = new World({ inviteTtlMs: 60_000 })
  const room = w.room()
  const code = w.invite(room)
  const host = w.join({ key: room.key })
  w.hub.shutdown()
  assert.deepEqual(host.conn.last(), { t: 'bye', reason: 'shutdown' })
  assert.equal(w.store.inviteByCode(code, w.time)?.expiresAt, w.time + 60_000)
})

// ---- the log ----

test('the log: ops are numbered, sent to everyone including the sender, and handed to who joins later', () => {
  const w = new World()
  const room = w.room()
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  assert.deepEqual(a.conn.of('welcome')[0]!.log, { snap: null, ops: [] })
  w.send(a, { t: 'op', op: { t: 'block', x: 1 } })
  w.time += 5
  w.send(b, { t: 'op', op: 'second' })
  const sent = [
    { t: 'op', seq: 1, from: a.id, op: { t: 'block', x: 1 }, ts: 1_000_000 },
    { t: 'op', seq: 2, from: b.id, op: 'second', ts: 1_000_005 },
  ]
  assert.deepEqual(a.conn.of('op'), sent)
  assert.deepEqual(b.conn.of('op'), sent)
  const c = w.join({ key: room.key })
  assert.deepEqual(c.conn.of('welcome')[0]!.log, {
    snap: null,
    ops: [
      { seq: 1, pid: a.pid, op: { t: 'block', x: 1 }, ts: 1_000_000 },
      { seq: 2, pid: b.pid, op: 'second', ts: 1_000_005 },
    ],
  })
  // Ops count against the rate limits like every other frame.
  assert.equal(w.hub.counters.framesIn, 5)
})

test('the log: outlives the room, and reaches storage in batches', () => {
  const w = new World()
  const room = w.room()
  const a = w.join({ key: room.key })
  w.send(a, { t: 'op', op: 'one' })
  w.send(a, { t: 'op', op: 'two' })
  assert.equal(w.store.loadLog(room.id).ops.length, 0)
  w.hub.flushLog()
  assert.deepEqual(
    w.store.loadLog(room.id).ops.map((o) => [o.seq, o.pid, o.op]),
    [
      [1, a.pid, '"one"'],
      [2, a.pid, '"two"'],
    ],
  )
  // With nothing new there is nothing to write.
  const writes = w.store.writes
  w.hub.flushLog()
  assert.equal(w.store.writes, writes)
  // What is not written yet is written when the room closes.
  w.send(a, { t: 'op', op: 'three' })
  w.send(a, { t: 'leave' })
  assert.equal(w.store.loadLog(room.id).ops.length, 3)

  const b = w.join({ key: room.key })
  assert.deepEqual(
    b.conn.of('welcome')[0]!.log!.ops.map((o) => [o.seq, o.pid, o.op]),
    [
      [1, a.pid, 'one'],
      [2, a.pid, 'two'],
      [3, a.pid, 'three'],
    ],
  )
  w.send(b, { t: 'op', op: 'four' })
  assert.equal(b.conn.of('op')[0]!.seq, 4)
})

test('the log: a snapshot from the host replaces the ops up to the one it names', () => {
  const w = new World()
  const room = w.room()
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  for (let n = 1; n <= 5; n++) w.send(b, { t: 'op', op: n })
  w.send(b, { t: 'snap', data: 'not mine to save', upTo: 5 })
  assert.equal(b.conn.of('error').at(-1)?.code, 'forbidden')
  a.conn.clear()
  b.conn.clear()
  w.send(a, { t: 'snap', data: { sum: 6 }, upTo: 3 })
  // Nobody is told: the members have applied those ops already.
  assert.deepEqual([a.conn.frames, b.conn.frames], [[], []])
  const whole = () => w.join({ key: room.key }).conn.of('welcome')[0]!.log!
  assert.deepEqual(whole().snap, { upTo: 3, data: { sum: 6 } })
  assert.deepEqual(
    whole().ops.map((o) => [o.seq, o.op]),
    [
      [4, 4],
      [5, 5],
    ],
  )
  // Storage holds the same: the ops the snapshot replaced were never written.
  w.hub.flushLog()
  const stored = w.store.loadLog(room.id)
  assert.deepEqual([stored.snap, stored.ops.map((o) => o.seq)], [{ upTo: 3, data: '{"sum":6}' }, [4, 5]])

  // The numbering goes on. A snapshot cannot end before the last one, or after the last op.
  w.send(a, { t: 'op', op: 6 })
  assert.equal(a.conn.of('op').at(-1)?.seq, 6)
  w.send(a, { t: 'snap', data: 1, upTo: 2 })
  w.send(a, { t: 'snap', data: 1, upTo: 7 })
  assert.deepEqual(
    a.conn.of('error').map((e) => e.code),
    ['seq', 'seq'],
  )
  assert.deepEqual(whole().snap, { upTo: 3, data: { sum: 6 } })

  w.send(a, { t: 'snap', data: 'everything', upTo: 6 })
  w.hub.end(room.id)
  assert.deepEqual(w.store.loadLog(room.id), { snap: { upTo: 6, data: '"everything"' }, ops: [] })
  const later = w.join({ key: room.key })
  assert.deepEqual(later.conn.of('welcome')[0]!.log, { snap: { upTo: 6, data: 'everything' }, ops: [] })
  w.send(later, { t: 'op', op: 7 })
  assert.equal(later.conn.of('op')[0]!.seq, 7)
})

test('the log: a snapshot before any op is the state the room starts from', () => {
  const w = new World()
  const room = w.room()
  const a = w.join({ key: room.key })
  w.send(a, { t: 'snap', data: { bricks: 40 }, upTo: 0 })
  w.send(a, { t: 'op', op: 'hit' })
  assert.deepEqual(w.join({ key: room.key }).conn.of('welcome')[0]!.log, {
    snap: { upTo: 0, data: { bricks: 40 } },
    ops: [{ seq: 1, pid: a.pid, op: 'hit', ts: w.time }],
  })
})

test('the log: the host is asked for a snapshot when the log is half full; a full log refuses ops', () => {
  // Each of these ops counts 156 bytes: its JSON, its number, its player and its time.
  const w = new World({ maxLogBytes: 1000 })
  const room = w.room()
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  const op = { t: 'op', op: 'x'.repeat(100) }
  for (let n = 1; n <= 3; n++) w.send(b, op)
  assert.equal(a.conn.of('snap').length, 0)
  w.send(b, op)
  assert.deepEqual(a.conn.of('snap'), [{ t: 'snap' }])
  // Asked once, and only the host.
  w.send(b, op)
  w.send(b, op)
  assert.deepEqual([a.conn.of('snap').length, b.conn.of('snap').length], [1, 0])
  // The seventh does not fit: it is neither kept nor sent on.
  w.send(b, op)
  assert.equal(b.conn.of('error').at(-1)?.code, 'too-big')
  assert.deepEqual([a.conn.of('op').length, b.conn.of('op').length], [6, 6])

  // A snapshot larger than the cap is refused, and the log stays as it was.
  w.send(a, { t: 'snap', data: 'y'.repeat(2000), upTo: 6 })
  assert.equal(a.conn.of('error').at(-1)?.code, 'too-big')
  assert.equal(w.join({ key: room.key }).conn.of('welcome')[0]!.log!.ops.length, 6)

  // A snapshot makes room, and the count towards the next request starts over.
  w.send(a, { t: 'snap', data: 'small', upTo: 6 })
  for (let n = 1; n <= 3; n++) w.send(b, op)
  assert.deepEqual([a.conn.of('op').length, a.conn.of('snap').length], [9, 1])
  w.send(b, op)
  assert.equal(a.conn.of('snap').length, 2)
})

test('the log: a new host, and a host that comes back, are asked for the snapshot that is still due', () => {
  const w = new World({ maxLogBytes: 1000 })
  const room = w.room()
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  for (let n = 1; n <= 4; n++) w.send(b, { t: 'op', op: 'x'.repeat(100) })
  assert.equal(a.conn.of('snap').length, 1)
  // The request may have been lost with the connection.
  w.drop(a)
  const again = w.join({ key: room.key }, { pid: a.pid, resume: { member: a.id, token: a.token } })
  assert.deepEqual(again.conn.of('snap'), [{ t: 'snap' }])
  // The host leaves without answering.
  w.send(again, { t: 'leave' })
  assert.deepEqual(b.conn.of('host'), [{ t: 'host', id: b.id }])
  assert.deepEqual(b.conn.of('snap'), [{ t: 'snap' }])
  // Whoever opens the room later finds the request waiting.
  w.send(b, { t: 'leave' })
  const c = w.join({ key: room.key })
  assert.deepEqual(c.conn.of('snap'), [{ t: 'snap' }])
  // So does a member that becomes the host by coming in while the host is in the background: once.
  w.send(c, { t: 'away', away: true })
  const d = w.join({ key: room.key })
  assert.deepEqual(d.conn.of('host'), [{ t: 'host', id: d.id }])
  assert.deepEqual(d.conn.of('snap'), [{ t: 'snap' }])
})

test('the log: a member that comes back gets the ops it missed, or the whole log when that is not possible', () => {
  const w = new World()
  const room = w.room()
  const [a, b] = [w.join({ key: room.key }), w.join({ key: room.key })]
  w.send(a, { t: 'op', op: 1 })
  w.send(a, { t: 'op', op: 2 })
  w.drop(b)
  w.send(a, { t: 'op', op: 3 })
  w.send(a, { t: 'op', op: 4 })
  const back = (lastSeq?: number) => {
    const p = w.join({ key: room.key }, { pid: b.pid, resume: { member: b.id, token: b.token, lastSeq } })
    assert.equal(p.id, b.id)
    return p.conn.of('welcome')[0]!.log!
  }
  const numbers = (log: { ops: { seq: number }[] }) => log.ops.map((o) => o.seq)

  // No `snap` at all: carry on from what you have.
  const missed = back(2)
  assert.deepEqual(['snap' in missed, numbers(missed)], [false, [3, 4]])
  assert.deepEqual(back(4), { ops: [] })
  // A client that does not say what it has, or has more than there is, gets everything.
  assert.deepEqual([back().snap, numbers(back())], [null, [1, 2, 3, 4]])
  assert.deepEqual([back(9).snap, numbers(back(9))], [null, [1, 2, 3, 4]])

  // A snapshot at op 3 leaves nothing to carry on from for a client that stopped at op 2.
  w.send(a, { t: 'snap', data: 'six', upTo: 3 })
  assert.deepEqual([back(2).snap, numbers(back(2))], [{ upTo: 3, data: 'six' }, [4]])
  assert.deepEqual(back(3), { ops: [{ seq: 4, pid: a.pid, op: 4, ts: w.time }] })

  // Somebody else's resume, and so a new member: the whole log, whatever it claims to have.
  const other = w.join({ key: room.key }, { resume: { member: b.id, token: b.token, lastSeq: 4 } })
  assert.notEqual(other.id, b.id)
  assert.deepEqual(other.conn.of('welcome')[0]!.log!.snap, { upTo: 3, data: 'six' })
})

test('the log: all rooms are written in one go; a write that fails is tried again, and holds up no other room', () => {
  const w = new World()
  const [one, two] = [w.room(), w.room()]
  const [a, b] = [w.join({ key: one.key }), w.join({ key: two.key })]
  const append = w.store.appendOps.bind(w.store)
  const calls: number[][] = []
  let broken: number | null = null
  w.store.appendOps = (batches) => {
    calls.push(batches.map((x) => x.roomId))
    if (batches.some((x) => x.roomId === broken)) throw new Error('disk full')
    append(batches)
  }
  const stored = () => [one, two].map((room) => w.store.loadLog(room.id).ops.map((o) => o.seq))

  w.send(a, { t: 'op', op: 'one' })
  w.send(b, { t: 'op', op: 'one' })
  w.hub.flushLog()
  assert.deepEqual([calls, stored()], [[[one.id, two.id]], [[1], [1]]])

  // The first room cannot be written: the second still is.
  broken = one.id
  w.send(a, { t: 'op', op: 'two' })
  w.send(b, { t: 'op', op: 'two' })
  w.hub.flushLog()
  assert.deepEqual(stored(), [[1], [1, 2]])
  // What was not written goes out with the room's next op.
  broken = null
  w.hub.flushLog()
  assert.deepEqual(stored(), [[1], [1, 2]])
  w.send(a, { t: 'op', op: 'three' })
  w.hub.flushLog()
  assert.deepEqual(stored(), [[1, 2, 3], [1, 2]])
})

test('welcome says how large a frame may be, and a long one does not make its receiver slow', () => {
  const w = new World({ maxBufferedBytes: 1000, volatileBufferedBytes: 100 })
  const room = w.room()
  const a = w.join({ key: room.key })
  assert.deepEqual(a.conn.of('welcome')[0]!.limits, { maxFrameBytes: w.limits.maxFrameBytes, maxLogBytes: w.limits.maxLogBytes })
  for (let n = 0; n < 20; n++) w.send(a, { t: 'op', op: 'x'.repeat(100) })
  const b = w.join({ key: room.key })
  const got = () => b.conn.of('msg').map((m) => m.data)

  // More than 3 KB of welcome are still on their way out, and nothing else.
  b.conn.queued = 3500
  w.send(a, { t: 'msg', ch: 'x', data: 1 })
  // Half of it is written.
  b.conn.queued = 1500
  w.send(a, { t: 'msg', ch: 'x', data: 2 })
  assert.deepEqual([got(), b.conn.closed], [[1, 2], false])
  // From here on, what is queued is what came after.
  b.conn.queued = 2501
  w.send(a, { t: 'msg', ch: 'x', data: 3 })
  assert.deepEqual(b.conn.last(), { t: 'bye', reason: 'slow' })
})

test('a room is held to the game it was first played with, until its owner lets another in', () => {
  const w = new World()
  const room = w.room()
  assert.equal(w.store.roomById(room.id)!.gameId, null)
  const a = w.join({ key: room.key }, { game: 'turns' })
  assert.equal(a.conn.of('welcome').length, 1)
  assert.equal(w.store.roomById(room.id)!.gameId, 'turns')
  // Another game on the same site: refused, whoever it is, and even when the room is empty again.
  const b = w.join({ key: room.key }, { game: 'cards' })
  assert.deepEqual(b.conn.of('error').map((e) => e.code), ['game'])
  assert.equal(b.conn.closed, true)
  w.send(a, { t: 'leave' })
  assert.deepEqual(w.join({ key: room.key }, { game: 'cards' }).conn.of('error').map((e) => e.code), ['game'])
  assert.equal(w.join({ key: room.key }, { game: 'turns' }).conn.of('welcome').length, 1)
  // Let another game in: the next one to come is the one the room is held to.
  w.store.holdGame(room.id, null)
  assert.equal(w.join({ key: room.key }, { game: 'cards' }).conn.of('welcome').length, 1)
  assert.equal(w.store.roomById(room.id)!.gameId, 'cards')
  // Clearing what the room saved frees it too.
  w.store.clearSaved(room.id)
  assert.equal(w.store.roomById(room.id)!.gameId, null)
})

