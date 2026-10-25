import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pack, unpack } from '../../client/src/pack.ts'
import type { LogEntry } from '../../client/src/types.ts'
import { sleep, until, world } from './harness.ts'

test('a host tells each player something of its own, in one message', async () => {
  const w = await world()
  const { key, invite } = w.room()
  const ada = await w.join({ key }, 'Ada')
  const grace = await w.join({ invite }, 'Grace')
  const edsger = await w.join({ invite }, 'Edsger')
  await until(() => ada.room.members.length === 3, 'all three to be in')
  const got = (p: typeof ada) => {
    const list: [number[], string | undefined][] = []
    p.room.on('hand', (data, from) => list.push([[...(data as Uint8Array)], from?.name]))
    return list
  }
  const [toAda, toGrace, toEdsger] = [got(ada), got(grace), got(edsger)]
  const [g, e] = [grace.room.self, edsger.room.self.id]
  assert.equal(ada.room.sendEach('hand', [[g, new Uint8Array([1, 2])], [e, new Uint16Array([0x0304]).buffer]]), true)
  await until(() => toGrace.length && toEdsger.length, 'both hands')
  assert.deepEqual(toGrace, [[[1, 2], 'Ada']])
  assert.deepEqual(toEdsger, [[[...new Uint8Array(new Uint16Array([0x0304]).buffer)], 'Ada']])
  await sleep(100)
  assert.deepEqual(toAda, [])
  // A member twice gets one part, the first; nothing to send is no message at all.
  assert.equal(ada.room.sendEach('hand', [[g, new Uint8Array([5])], [g, new Uint8Array([6])]]), true)
  await until(() => toGrace.length === 2, 'the second hand')
  assert.deepEqual(toGrace[1], [[5], 'Ada'])
  assert.equal(ada.room.sendEach('hand', []), true)
  assert.throws(() => ada.room.sendEach('hand', [[g, 'text' as unknown as Uint8Array]]), TypeError)
})

test('two players: messages, presence, and what the room keeps', async () => {
  const w = await world()
  const { key, invite } = w.room()
  const ada = await w.join({ key }, 'Ada')
  assert.equal(ada.room.isHost, true)

  ada.room.send('world', { seed: 7 }, { retain: 'room' })
  ada.room.send('bag', ['key'], { retain: 'player' })
  ada.room.presence.set({ x: 1 })
  await until(() => ada.room.retained('world'), 'the room value to come back to its sender')

  const joined: string[] = []
  ada.room.on('member-join', (m) => joined.push(m.name))
  const grace = await w.join({ invite }, 'Grace')
  assert.equal(grace.room.isHost, false)
  assert.deepEqual(grace.room.members.map((m) => m.name), ['Ada', 'Grace'])
  assert.deepEqual(grace.room.retained('world'), { seed: 7 })
  assert.deepEqual(grace.room.retained('bag', { player: ada.pid }), ['key'])
  assert.deepEqual(grace.room.presence.get(ada.room.self.id), { x: 1 })
  await until(() => joined.length, 'Ada to hear of Grace')

  // A message goes to the others; with `to: 'all'` it comes back to the sender as well.
  const heard: unknown[] = []
  const own: unknown[] = []
  grace.room.on('shot', (data, from) => heard.push([data, from?.name]))
  ada.room.on('shot', (data) => own.push(data))
  ada.room.send('shot', 1)
  ada.room.send('shot', 2, { to: 'all' })
  await until(() => heard.length === 2 && own.length === 1, 'both shots')
  assert.deepEqual(heard, [[1, 'Ada'], [2, 'Ada']])
  assert.deepEqual(own, [2])

  // Binary data arrives as bytes.
  const bytes: Uint8Array[] = []
  grace.room.on('snap', (data) => bytes.push(data as Uint8Array))
  ada.room.send('snap', new Uint8Array([1, 2, 3]))
  await until(() => bytes.length, 'the binary message')
  assert.deepEqual([...bytes[0]!], [1, 2, 3])

  // Presence: the latest value, and null when it is cleared.
  const seen: unknown[] = []
  ada.room.presence.on((member, value) => seen.push([member.name, value]))
  grace.room.presence.set({ x: 5 })
  await until(() => seen.length === 1, "Grace's presence")
  grace.room.presence.set(null)
  await until(() => seen.length === 2, "Grace's presence to clear")
  assert.deepEqual(seen, [['Grace', { x: 5 }], ['Grace', null]])

  grace.room.leave()
  await until(() => ada.room.members.length === 1, 'Grace to be gone')
  assert.equal(grace.closed, 'left')
})

test('presence comes with when it was set, not when its batch arrived', async () => {
  // Two batches a second: a value waits up to half a second on the server.
  const w = await world({ presenceHz: 2 })
  const { key, invite } = w.room()
  const ada = await w.join({ key }, 'Ada')
  const grace = await w.join({ invite }, 'Grace')
  await until(() => ada.room.members.length === 2, 'Grace to be in')
  // The clock reading that the pings improve on.
  await sleep(200)

  const heard: { at: number; arrived: number }[] = []
  ada.room.presence.on((_, __, at) => heard.push({ at, arrived: performance.now() }))
  const sent: number[] = []
  for (let x = 1; x <= 6; x++) {
    sent.push(performance.now())
    grace.room.presence.set({ x })
    await until(() => heard.length === x, `presence ${x}`)
    await sleep(70)
  }
  // The same time, for the value as it stands.
  assert.equal(ada.room.presence.at(grace.room.self.id), heard.at(-1)!.at)
  assert.equal(ada.room.presence.at(ada.room.self), undefined)
  for (const [i, { at, arrived }] of heard.entries()) {
    // On this page's clock, close to when it was set: the server's clock read by the client to a few ms.
    assert.ok(Math.abs(at - sent[i]!) < 25, `value ${i + 1}: set at ${sent[i]}, dated ${at}`)
    assert.ok(at <= arrived)
  }
  // What the batches did, and the times undo: values set at a steady beat arrived at an uneven one.
  const waited = heard.map(({ at, arrived }) => arrived - at)
  assert.ok(Math.max(...waited) - Math.min(...waited) > 100, `waits ${waited.map(Math.round)}`)
})

test('a connection that is cut comes back as the same member, and the log has no gap', async () => {
  const w = await world()
  const { key, invite } = w.room()
  const ada = await w.join({ key }, 'Ada')
  // Grace is the one behind the proxy, so only her connection can be cut.
  const grace = await w.join({ invite }, 'Grace', { server: w.far })
  const id = grace.room.self.id

  const applied: number[] = []
  const loads: unknown[] = []
  grace.room.log.open({ load: (state) => loads.push(state), apply: (op) => applied.push(op as number) })
  ada.room.log.open({ load: () => {}, apply: () => {} })
  ada.room.log.submit(1)
  ada.room.log.submit(2)
  await until(() => applied.length === 2, 'the first two ops')

  const statuses: string[] = []
  grace.room.on('status', (s) => statuses.push(s))
  const messages: unknown[] = []
  grace.room.on('note', (data) => messages.push(data))
  assert.equal(w.proxy.drop(), 1)
  await until(() => grace.room.status === 'reconnecting', 'Grace to notice')
  assert.equal(grace.room.send('note', 'into the void'), false)
  // Her own ops wait for the connection, and go when it is back, after what the room took meanwhile.
  assert.equal(grace.room.log.submit(5), true)
  assert.equal(grace.room.log.submit(6), true)

  // While she is away: ops, which are kept for her, and a message, which is not.
  ada.room.log.submit(3)
  ada.room.log.submit(4)
  ada.room.send('note', 'missed')
  const lines: string[] = []
  grace.room.chat.on((m) => lines.push(`${m.name}: ${m.text}`))
  ada.room.chat.send('while you were out')
  assert.equal(ada.room.members.length, 2, 'her place is kept')

  await until(() => grace.room.status === 'open', 'Grace to come back', 8000)
  assert.equal(grace.room.self.id, id)
  await until(() => applied.length === 6, 'the ops she missed, and her own')
  // A chat line is kept by the room, and the page is told of the one it missed.
  await until(() => lines.length, 'the chat line she missed')
  assert.deepEqual(lines, ['Ada: while you were out'])
  assert.deepEqual(applied, [1, 2, 3, 4, 5, 6])
  assert.deepEqual(loads, [undefined], 'the log carried on: it was not handed over again')
  assert.deepEqual(statuses, ['reconnecting', 'open'])

  ada.room.send('note', 'after')
  await until(() => messages.length, 'a message after the gap')
  assert.deepEqual(messages, ['after'])
})

test('member states: the room hears that a connection is down and back, and a quiet page in front stays here', async () => {
  const w = await world({ quietMs: 2000 })
  const { key, invite } = w.room()
  const ada = await w.join({ key }, 'Ada')
  // Grace is the one behind the proxy, so only her connection can be cut.
  await w.join({ invite }, 'Grace', { server: w.far })
  const told: string[] = []
  ada.room.on('member-state', (m, state) => told.push(`${m.name} ${state}`))

  // Nobody says anything for twice as long as a member may go unheard. The library speaks for them.
  await sleep(4500)
  assert.deepEqual(told, [])
  assert.equal(ada.room.members[1]!.state, 'here')

  assert.equal(w.proxy.drop(), 1)
  await until(() => told.length === 1, 'Ada to hear that Grace is lost')
  assert.equal(ada.room.members[1]!.state, 'lost')
  await until(() => told.length === 2, 'Ada to hear that Grace is back', 8000)
  assert.deepEqual(told, ['Grace lost', 'Grace here'])

  // Somebody who comes in while a member is lost is told so in the welcome.
  w.proxy.drop()
  await until(() => told.length === 3, 'Grace lost again')
  const edsger = await w.join({ invite }, 'Edsger')
  assert.deepEqual(edsger.room.members.map((m) => `${m.name} ${m.state}`), ['Ada here', 'Grace lost', 'Edsger here'])
  await until(() => edsger.room.members[1]!.state === 'here', 'Edsger to hear that Grace is back', 8000)
})

test('the log: a snapshot takes the place of the ops before it, for whoever comes later', async () => {
  const w = await world()
  const { key, invite } = w.room()
  const ada = await w.join({ key }, 'Ada')
  let total = 0
  ada.room.log.open({
    load: (state) => {
      total = (state as number | undefined) ?? 0
    },
    apply: (op) => {
      total += op as number
    },
    save: () => total,
  })
  for (const n of [1, 2, 3]) ada.room.log.submit(n)
  await until(() => ada.room.log.seq === 3, 'three ops')
  assert.equal(ada.room.log.snapshot(), true)
  ada.room.log.submit(10)
  await until(() => ada.room.log.seq === 4, 'the fourth op')

  // A guest cannot save a snapshot.
  const grace = await w.join({ invite }, 'Grace')
  let hers = -1
  const entries: LogEntry[] = []
  grace.room.log.open({
    load: (state) => {
      hers = (state as number | undefined) ?? 0
    },
    apply: (op, entry) => {
      hers += op as number
      entries.push(entry)
    },
  })
  assert.equal(hers, 16, 'the snapshot (6) and the op after it (10), handed over inside open()')
  assert.deepEqual(entries.map((e) => [e.seq, e.replayed, e.pid, e.from]), [[4, true, ada.pid, null]])
  assert.equal(grace.room.log.snapshot(99), false)

  // A new op reaches both, with the member who sent it.
  grace.room.log.submit(100)
  await until(() => total === 116 && hers === 116, 'the new op on both sides')
  assert.deepEqual([entries[1]!.seq, entries[1]!.replayed, entries[1]!.from?.name], [5, false, 'Grace'])

  // Everyone leaves. The room still has it another day.
  ada.room.leave()
  grace.room.leave()
  await sleep(50)
  const later = await w.join({ invite }, 'Edsger')
  let his = -1
  later.room.log.open({
    load: (state) => {
      his = (state as number | undefined) ?? 0
    },
    apply: (op) => {
      his += op as number
    },
  })
  assert.equal(his, 116)
})

test('a frame larger than the server takes is not sent, and the room stays open', async () => {
  const w = await world({ maxFrameBytes: 2048 })
  const { key } = w.room()
  const ada = await w.join({ key }, 'Ada')
  const errors: string[] = []
  ada.room.on('error', (e) => errors.push(e.code))
  assert.equal(ada.room.send('big', 'x'.repeat(4096)), false)
  assert.equal(ada.room.send('big', new Uint8Array(4096)), false)
  assert.deepEqual(errors, ['too-big', 'too-big'])
  assert.equal(ada.room.send('small', 'x'), true)
  assert.equal(ada.room.status, 'open')
})

test('a place that timed out is gone: the player comes back as somebody new', async () => {
  const w = await world({ graceMs: 50, hostGraceMs: 20 })
  const { key, invite } = w.room()
  const ada = await w.join({ key }, 'Ada', { server: w.far })
  const grace = await w.join({ invite }, 'Grace')
  const firstId = ada.room.self.id
  const hosts: (string | undefined)[] = []
  grace.room.on('host-change', (host) => hosts.push(host?.name))
  const left: string[] = []
  grace.room.on('member-leave', (m, reason) => left.push(`${m.name} ${reason}`))

  w.proxy.drop()
  // The server looks for places that have timed out once a second. Ada's page tries again
  // after 300 ms at the earliest, so the look is taken here, in between.
  await sleep(120)
  w.running.app.hub.tick()
  await until(() => left.length, "Ada's place to time out")
  assert.deepEqual(left, ['Ada timeout'])
  assert.deepEqual(hosts, ['Grace'], 'the role passed on before the place did')

  await until(() => ada.room.status === 'open', 'Ada to come back', 8000)
  assert.notEqual(ada.room.self.id, firstId)
  assert.equal(ada.room.isHost, false, 'the role does not pass back')
  assert.deepEqual(ada.room.members.map((m) => m.name), ['Grace', 'Ada'])
})

test('players on another version of the game are kept out', async () => {
  const w = await world()
  const { key, invite } = w.room()
  await w.join({ key }, 'Ada', { version: '1.0.0' })
  await assert.rejects(w.join({ invite }, 'Grace', { version: '2.0.0' }), { code: 'version' })
})

test('offer: what the first to come decides for everybody, also when two come at once', async () => {
  const w = await world()
  const { key, invite } = w.room()
  const ada = await w.join({ key }, 'Ada')
  const grace = await w.join({ invite }, 'Grace')

  // Both offer a world in the same moment. One of them is first, and both are told the same.
  const [hers, his] = await Promise.all([ada.room.offer('world', { seed: 1 }), grace.room.offer('world', { seed: 2 })])
  assert.deepEqual(hers, his)
  assert.ok([1, 2].includes((hers as { seed: number }).seed))
  assert.deepEqual(ada.room.retained('world'), hers)
  assert.deepEqual(grace.room.retained('world'), hers)

  // Somebody who comes later and offers again gets what is there, and changes nothing.
  const edsger = await w.join({ invite }, 'Edsger')
  const seen: unknown[] = []
  ada.room.on('world', (data) => seen.push(data))
  assert.deepEqual(await edsger.room.offer('world', { seed: 3 }), hers)
  await sleep(50)
  assert.deepEqual(seen, [], 'nobody else heard of the offer that came too late')

  // An offer made while the connection is down is made when it is back.
  const far = await w.join({ invite }, 'Barbara', { server: w.far })
  w.proxy.drop()
  await until(() => far.room.status === 'reconnecting', 'Barbara to notice')
  const answer = far.room.offer('sky', 'blue')
  assert.deepEqual(await answer, 'blue')
  await until(() => ada.room.retained('sky') === 'blue', 'the offer to arrive')
})

test('the log: a state that takes time to pack, and one that takes time to take in', async () => {
  const w = await world()
  const { key, invite } = w.room()
  const ada = await w.join({ key }, 'Ada')
  let total = 0
  await ada.room.log.open({
    load: (state) => {
      total = (state as number | undefined) ?? 0
    },
    apply: (op) => {
      total += op as number
    },
    // Read now, packed when the browser gets to it.
    save: () => pack(total),
  })
  for (const n of [1, 2, 3]) ada.room.log.submit(n)
  await until(() => ada.room.log.seq === 3, 'three ops')
  assert.equal(ada.room.log.snapshot(), true)
  // This one arrives while the snapshot is still being packed, and is not part of it.
  ada.room.log.submit(10)
  await until(() => ada.room.log.seq === 4, 'the fourth op')
  await sleep(50)

  const grace = await w.join({ invite }, 'Grace')
  const order: string[] = []
  let hers = -1
  const opened = grace.room.log.open({
    load: async (state) => {
      order.push('load starts')
      const value = (await unpack(state)) as number
      await sleep(40)
      hers = value
      order.push(`load done: ${value}`)
    },
    apply: (op) => {
      order.push(`op ${op}`)
      hers += op as number
    },
  })
  assert.equal(hers, -1, 'nothing is handed over while the state is being taken in')
  // An op that arrives meanwhile waits its turn, behind the saved one.
  ada.room.log.submit(100)
  await opened
  await until(() => hers === 116, 'the snapshot, the saved op and the new one')
  assert.deepEqual(order, ['load starts', 'load done: 6', 'op 10', 'op 100'])
  assert.equal(grace.room.log.seq, 5)
})
