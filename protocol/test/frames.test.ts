import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BINARY_HEADER_MAX,
  cleanName,
  decodeBinary,
  encodeBinary,
  isChannel,
  parseBinaryHeader,
  parseBinaryOutHeader,
  parseClientFrame,
  parseServerFrame,
} from '../src/frames.ts'

const PID = 'a'.repeat(32)
const hello = {
  t: 'hello',
  proto: 1,
  auth: { invite: '789xyz0abc' },
  player: { pid: PID, secret: PID },
  game: { id: 'my-game', version: '1.0.0' },
  name: 'Ada',
}

function client(frame: unknown) {
  return parseClientFrame(JSON.stringify(frame))
}

test('hello: accepted, extra fields dropped', () => {
  const r = client({ ...hello, extra: 1, resume: { member: 3, token: 'tok' } })
  assert.ok(r.ok)
  assert.deepEqual(r.frame, { ...hello, resume: { member: 3, token: 'tok' } })
  // Where the client's copy of the room's log ends. 0: it has none of it.
  for (const lastSeq of [0, 41]) {
    const resume = { member: 3, token: 'tok', lastSeq }
    assert.deepEqual(client({ ...hello, resume }), { ok: true, frame: { ...hello, resume } })
  }
})

test('hello: rejected when a part is missing or malformed', () => {
  const broken: unknown[] = [
    { ...hello, proto: '1' },
    { ...hello, auth: {} },
    { ...hello, auth: { key: 5 } },
    { ...hello, player: { pid: 'short', secret: PID } },
    { ...hello, player: { pid: PID } },
    { ...hello, game: { id: 'has space', version: '1' } },
    { ...hello, game: { id: 'ok', version: '' } },
    { ...hello, name: 5 },
    { ...hello, resume: { member: 0, token: 'x' } },
    { ...hello, resume: { member: 1 } },
    { ...hello, resume: { member: 1, token: 'x', lastSeq: -1 } },
    { ...hello, resume: { member: 1, token: 'x', lastSeq: 1.5 } },
    { ...hello, resume: { member: 1, token: 'x', lastSeq: '7' } },
  ]
  for (const f of broken) assert.equal(client(f).ok, false, JSON.stringify(f))
})

test('msg: data is opaque, routing is validated', () => {
  for (const data of [null, 0, 'x', [1, [2]], { a: { b: null } }]) {
    const r = client({ t: 'msg', ch: 'pos', data })
    assert.ok(r.ok)
    assert.deepEqual(r.frame, { t: 'msg', ch: 'pos', data })
  }
  for (const to of ['others', 'all', 'host', 7, [1, 2, 3]]) {
    const r = client({ t: 'msg', ch: 'pos', data: 1, to })
    assert.ok(r.ok, String(to))
  }
  const full = client({ t: 'msg', ch: '$chat', data: 'gg', to: 'all', retain: 'tail', volatile: true })
  assert.deepEqual(full, {
    ok: true,
    frame: { t: 'msg', ch: '$chat', data: 'gg', to: 'all', retain: 'tail', volatile: true },
  })
  // "Only if there is none yet" goes with a saved value.
  for (const retain of ['room', 'player']) {
    assert.deepEqual(client({ t: 'msg', ch: 'world', data: { seed: 7 }, retain, first: true }), {
      ok: true,
      frame: { t: 'msg', ch: 'world', data: { seed: 7 }, retain, first: true },
    })
  }
  assert.deepEqual(client({ t: 'msg', ch: 'world', data: 1, retain: 'room', first: false }).ok && true, true)
})

test('msg: rejected', () => {
  const broken: unknown[] = [
    { t: 'msg', ch: 'pos' },
    { t: 'msg', data: 1 },
    { t: 'msg', ch: '', data: 1 },
    { t: 'msg', ch: 'has space', data: 1 },
    { t: 'msg', ch: '__proto__', data: 1 },
    { t: 'msg', ch: 'x'.repeat(33), data: 1 },
    { t: 'msg', ch: 'pos', data: 1, to: 'everyone' },
    { t: 'msg', ch: 'pos', data: 1, to: 0 },
    { t: 'msg', ch: 'pos', data: 1, to: [1, 'x'] },
    { t: 'msg', ch: 'pos', data: 1, to: Array.from({ length: 65 }, (_, i) => i + 1) },
    { t: 'msg', ch: 'pos', data: 1, retain: 'forever' },
    { t: 'msg', ch: 'pos', data: 1, volatile: 'yes' },
    // A saved value is one value for everyone.
    { t: 'msg', ch: 'pos', data: 1, retain: 'room', to: 'others' },
    { t: 'msg', ch: 'pos', data: 1, retain: 'player', to: 3 },
    // `first` is about setting a saved value: not about a message, a tail, or clearing.
    { t: 'msg', ch: 'pos', data: 1, first: true },
    { t: 'msg', ch: 'pos', data: 1, retain: 'tail', first: true },
    { t: 'msg', ch: 'pos', data: null, retain: 'room', first: true },
    { t: 'msg', ch: 'pos', data: 1, retain: 'room', first: 'yes' },
  ]
  for (const f of broken) assert.equal(client(f).ok, false, JSON.stringify(f))
})

test('other client frames', () => {
  assert.deepEqual(client({ t: 'pres', data: { x: 1 }, extra: 1 }), { ok: true, frame: { t: 'pres', data: { x: 1 } } })
  assert.deepEqual(client({ t: 'pres', data: null }), { ok: true, frame: { t: 'pres', data: null } })
  assert.deepEqual(client({ t: 'pres', data: 1, at: 1760000000000 }), { ok: true, frame: { t: 'pres', data: 1, at: 1760000000000 } })
  assert.deepEqual(client({ t: 'pres', data: 1, at: 'now' }), { ok: true, frame: { t: 'pres', data: 1 } })
  assert.equal(client({ t: 'pres' }).ok, false)
  assert.deepEqual(client({ t: 'ping', c: 12.5 }), { ok: true, frame: { t: 'ping', c: 12.5 } })
  assert.deepEqual(client({ t: 'kick', id: 4 }), { ok: true, frame: { t: 'kick', id: 4 } })
  assert.deepEqual(client({ t: 'end' }), { ok: true, frame: { t: 'end' } })
  assert.deepEqual(client({ t: 'leave' }), { ok: true, frame: { t: 'leave' } })
  assert.deepEqual(client({ t: 'away', away: true, extra: 1 }), { ok: true, frame: { t: 'away', away: true } })
  assert.equal(client({ t: 'away' }).ok, false)
  assert.equal(client({ t: 'away', away: 1 }).ok, false)
  assert.equal(client({ t: 'ping' }).ok, false)
  assert.equal(client({ t: 'kick', id: 'a' }).ok, false)
  assert.equal(client({ t: 'nope' }).ok, false)
  assert.equal(client([1, 2]).ok, false)
  assert.equal(parseClientFrame('{').ok, false)
})

test('the log: an op is opaque; a snapshot says which ops it replaces', () => {
  for (const op of [null, 0, 'x', [1, [2]], { t: 'block', x: 1 }]) {
    assert.deepEqual(client({ t: 'op', op, seq: 9 }), { ok: true, frame: { t: 'op', op } })
  }
  assert.equal(client({ t: 'op' }).ok, false)
  assert.deepEqual(client({ t: 'snap', data: { world: [1] }, upTo: 0 }), { ok: true, frame: { t: 'snap', data: { world: [1] }, upTo: 0 } })
  assert.deepEqual(client({ t: 'snap', data: null, upTo: 12 }), { ok: true, frame: { t: 'snap', data: null, upTo: 12 } })
  for (const f of [{ t: 'snap', upTo: 1 }, { t: 'snap', data: 1 }, { t: 'snap', data: 1, upTo: -1 }, { t: 'snap', data: 1, upTo: 2.5 }]) {
    assert.equal(client(f).ok, false, JSON.stringify(f))
  }
})

test('channel names', () => {
  for (const ch of ['a', '$chat', 'game.pos', 'a:b-c_d', 'x'.repeat(32)]) assert.ok(isChannel(ch), ch)
  for (const ch of ['', ' ', 'a b', 'é', '__proto__', 'x'.repeat(33), 5, null]) assert.equal(isChannel(ch), false)
})

test('names are cleaned', () => {
  assert.equal(cleanName('  Ada   Lovelace '), 'Ada Lovelace')
  assert.equal(cleanName('a\u0000b‮c​d\n'), 'abcd')
  assert.equal(cleanName('x'.repeat(40)), 'x'.repeat(24))
  assert.equal(Array.from(cleanName('🌽'.repeat(40))).length, 24)
  assert.equal(cleanName('‮​  '), '')
  assert.equal(cleanName(42), '')
})

test('server frames: envelopes are checked, unknown frames dropped', () => {
  const m = { id: 1, pid: PID, name: 'Ada', order: 1 }
  const good: unknown[] = [
    { t: 'msg', from: 1, ch: 'pos', data: null, ts: 1 },
    { t: 'msg', from: 1, ch: 'pos', data: 1, ts: 1, retain: 'player' },
    // From nobody who is here: a value the room already had.
    { t: 'msg', from: 0, ch: 'world', data: 1, ts: 1, retain: 'room' },
    { t: 'pres', list: [] },
    { t: 'pres', list: [[1, { x: 1 }], [2, null]] },
    { t: 'pres', list: [[1, { x: 1 }, 1760000000000], [2, null]] },
    { t: 'op', seq: 1, from: 2, op: null, ts: 1 },
    { t: 'snap' },
    { t: 'forget', pid: PID },
    { t: 'pong', c: 1, now: 2 },
    { t: 'member+', ...m },
    { t: 'member-', id: 1, reason: 'left' },
    { t: 'members', rtt: [[1, 20]] },
    { t: 'host', id: 1 },
    { t: 'state', id: 2, state: 'here' },
    { t: 'state', id: 2, state: 'away' },
    { t: 'state', id: 2, state: 'lost' },
    { t: 'error', code: 'rate', message: 'slow down' },
    { t: 'bye', reason: 'kicked' },
    {
      t: 'welcome',
      self: { ...m, mod: true },
      room: { name: 'Friday games' },
      host: 1,
      members: [m],
      retained: { room: {}, player: { [PID]: { pos: 1 } }, tail: { $chat: [] } },
      presence: [[2, 'here']],
      token: 'tok',
      now: 5,
    },
  ]
  const welcome = good.at(-1) as Record<string, unknown>
  const entry = { seq: 8, pid: PID, op: { t: 'block' }, ts: 4 }
  good.push(
    { ...welcome, log: { snap: null, ops: [] }, limits: { maxFrameBytes: 65536 } },
    { ...welcome, log: { snap: { upTo: 7, data: null }, ops: [entry] } },
    { ...welcome, log: { ops: [entry] } },
    { ...welcome, states: [] },
    { ...welcome, states: [[2, 'lost'], [3, 'away']] },
    { ...welcome, presence: [[2, 'here', 1760000000000]] },
  )
  for (const f of good) assert.ok(parseServerFrame(JSON.stringify(f)), JSON.stringify(f))
  const broken: unknown[] = [
    { t: 'msg', from: 'x', ch: 'pos', data: 1, ts: 1 },
    { t: 'msg', from: 0, ch: 'pos', data: 1, ts: 1 },
    { t: 'msg', from: 0, ch: 'pos', data: 1, ts: 1, retain: 'player' },
    { t: 'msg', from: 1, ch: 'pos', ts: 1 },
    { t: 'member+', id: 1 },
    { t: 'members', rtt: [[1]] },
    { t: 'msg', from: 1, ch: 'pos', data: 1, ts: 1, retain: 'tail' },
    { t: 'pres' },
    { t: 'pres', list: [[0, 1]] },
    { t: 'pres', list: [[1]] },
    { t: 'pres', list: [1, 2] },
    { t: 'pres', list: [[1, { x: 1 }, 'soon']] },
    { t: 'welcome', self: m, room: {}, host: 1, members: [], retained: {}, token: 't', now: 1 },
    { ...welcome, presence: undefined },
    { ...welcome, presence: [['x', 1]] },
    { ...welcome, retained: { room: {}, player: { [PID]: 5 }, tail: {} } },
    { ...welcome, log: {} },
    { ...welcome, log: { snap: { upTo: 7 }, ops: [] } },
    { ...welcome, log: { snap: null, ops: [{ ...entry, seq: 0 }] } },
    { ...welcome, log: { snap: null, ops: [{ seq: 1, pid: PID, ts: 4 }] } },
    { ...welcome, limits: { maxFrameBytes: 'big' } },
    { ...welcome, states: [[2, 'gone']] },
    { ...welcome, states: [[0, 'lost']] },
    { ...welcome, states: { 2: 'lost' } },
    { t: 'state', id: 2 },
    { t: 'state', id: 2, state: 'asleep' },
    { t: 'state', id: 0, state: 'here' },
    { t: 'op', seq: 0, from: 2, op: 1, ts: 1 },
    { t: 'op', seq: 1, from: 2, ts: 1 },
    { t: 'forget' },
    { t: 'eval', code: 'alert(1)' },
    'nope',
  ]
  for (const f of broken) assert.equal(parseServerFrame(JSON.stringify(f)), null, JSON.stringify(f))
  assert.equal(parseServerFrame('{'), null)
})

test('binary frames: header length, header, payload', () => {
  const payload = Uint8Array.from([0, 255, 10, 34])
  const frame = encodeBinary('{"t":"msg","ch":"é"}', payload)
  // Two bytes of length, big-endian; é is two bytes in UTF-8.
  assert.deepEqual([...frame.subarray(0, 2)], [0, 21])
  assert.equal(frame.length, 2 + 21 + 4)
  const parts = decodeBinary(frame)!
  assert.equal(parts.header, '{"t":"msg","ch":"é"}')
  assert.deepEqual([...parts.payload], [...payload])
  // An empty payload is fine; so is a long header, up to the cap.
  assert.equal(decodeBinary(encodeBinary('{}', new Uint8Array()))!.payload.length, 0)
  assert.equal(decodeBinary(encodeBinary('x'.repeat(BINARY_HEADER_MAX), payload))!.header.length, BINARY_HEADER_MAX)
  assert.throws(() => encodeBinary('x'.repeat(BINARY_HEADER_MAX + 1), payload), RangeError)

  const broken = [[], [0], [0, 5, 1, 2], [255, 255], [0, 2, 0xff, 0xfe]]
  for (const bytes of broken) assert.equal(decodeBinary(Uint8Array.from(bytes)), null, String(bytes))
})

test('binary frames: the header is a msg envelope without data or retain, with a target or a part for each receiver', () => {
  const header = (h: unknown) => parseBinaryHeader(JSON.stringify(h))
  assert.deepEqual(header({ t: 'msg', ch: 'snap', extra: 1 }), { ok: true, frame: { t: 'msg', ch: 'snap' } })
  assert.deepEqual(header({ t: 'msg', ch: 'snap', to: [1, 2], volatile: true }), {
    ok: true,
    frame: { t: 'msg', ch: 'snap', to: [1, 2], volatile: true },
  })
  // A part for each receiver: member id and length, in the order of the payload.
  assert.deepEqual(header({ t: 'msg', ch: 'view', parts: [[3, 120], [5, 0]], volatile: true }), {
    ok: true,
    frame: { t: 'msg', ch: 'view', parts: [[3, 120], [5, 0]], volatile: true },
  })
  const broken: unknown[] = [
    { t: 'pres' },
    { t: 'msg' },
    { t: 'msg', ch: 'has space' },
    { t: 'msg', ch: 'snap', to: 'nobody' },
    { t: 'msg', ch: 'snap', retain: 'room' },
    { t: 'msg', ch: 'snap', retain: 'tail' },
    { t: 'msg', ch: 'snap', volatile: 1 },
    { t: 'msg', ch: 'view', parts: [] },
    { t: 'msg', ch: 'view', parts: [[1, 4], [1, 4]] },
    { t: 'msg', ch: 'view', parts: [[0, 4]] },
    { t: 'msg', ch: 'view', parts: [[1, -1]] },
    { t: 'msg', ch: 'view', parts: [[1, 1.5]] },
    { t: 'msg', ch: 'view', parts: [[1]] },
    { t: 'msg', ch: 'view', parts: [[1, 4]], to: 'all' },
    { t: 'msg', ch: 'view', parts: Array.from({ length: 65 }, (_, i) => [i + 1, 1]) },
    [1],
  ]
  for (const h of broken) assert.equal(header(h).ok, false, JSON.stringify(h))
  assert.equal(parseBinaryHeader('{').ok, false)

  assert.deepEqual(parseBinaryOutHeader('{"t":"msg","from":3,"ch":"snap","ts":5}'), { t: 'msg', from: 3, ch: 'snap', ts: 5 })
  for (const h of ['{', '[]', '{"t":"pres"}', '{"t":"msg","from":0,"ch":"snap","ts":5}', '{"t":"msg","from":3,"ch":"snap"}']) {
    assert.equal(parseBinaryOutHeader(h), null, h)
  }
})
