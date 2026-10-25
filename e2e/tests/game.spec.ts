// Game data on the chat pipe: presence, saved values per player, binary data, the version gate,
// the log, a room of one, and all of it through a connection that is slow and drops.

import type { Page } from '@playwright/test'
import { GAME, HOST, serverAt } from '../playwright.config.ts'
import { startLagProxy } from '../tools/lag-proxy.ts'
import { accept, createRoom, host, inInvite, join, player, selfId, through } from './helpers.ts'
import { expect, test } from './fixtures.ts'

// A log this small is full after a few dozen ops, so the tests see what happens then.
test.use({ settings: { P3P2_MAX_LOG_BYTES: '16384' } })

interface Member {
  id: number
  pid: string
  name: string
}

/** As much of the room as these tests use from inside the page. */
interface TestRoom {
  self: Member
  members: Member[]
  isHost: boolean
  now(): number
  send(channel: string, data: unknown, options?: { to?: string | number; retain?: string }): boolean
  on(name: string, handler: (...args: never[]) => void): () => void
  retained(channel: string, of?: { player: string }): unknown
  presence: {
    set(value: unknown): void
    get(member: Member | number): unknown
    on(handler: (member: Member, value: unknown) => void): () => void
  }
  log: {
    seq: number
    submit(op: unknown): boolean
    open(reader: {
      load(state: unknown): void
      apply(op: unknown, entry: { seq: number; from: Member | null; replayed: boolean }): void
      save?(): unknown
    }): void
    snapshot(state?: unknown): boolean
  }
}

/** What a test leaves in the page between two calls. */
interface Notes {
  seen: unknown[]
  statuses: string[]
  /** What the log's reader was given, and how many ops it has applied. */
  log: unknown[]
  applied: number
}

/** Runs `fn` in the page, with the room the page is in. */
async function inRoom<T, A = undefined>(page: Page, fn: (room: TestRoom, arg: A) => T | Promise<T>, arg?: A): Promise<T> {
  const room = await page.evaluateHandle(() => (window as unknown as { p3p2: { room: TestRoom } }).p3p2.room)
  try {
    return (await room.evaluate(fn as never, arg)) as T
  } finally {
    await room.dispose()
  }
}

test('presence, saved player values and binary data reach the other players', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Game data room')
  const ada = await player(browser)
  const invite = await host(ada.page, owner.invite, 'Ada')
  const grace = await join(browser, invite, 'Grace')
  const adaId = (await selfId(ada.page))!

  // Presence. Thirty updates in one go: the last value arrives, in one or two steps.
  await inRoom(grace.page, (room) => {
    const notes = window as unknown as Notes
    notes.seen = []
    room.presence.on((m, value) => notes.seen.push([m.name, value]))
  })
  await inRoom(ada.page, (room) => {
    for (let x = 1; x <= 30; x++) room.presence.set({ x })
  })
  await expect.poll(() => inRoom(grace.page, (room, id) => room.presence.get(id), adaId)).toEqual({ x: 30 })
  const seen = await grace.page.evaluate(() => (window as unknown as Notes).seen)
  expect(seen.at(-1)).toEqual(['Ada', { x: 30 }])
  expect(seen.length).toBeLessThanOrEqual(2)

  // The page's own use of presence: who is typing.
  await grace.page.locator('#text').fill('let me think')
  await expect(ada.page.locator('#typing')).toHaveText('Grace is typing…')
  await grace.page.locator('#send').click()
  await expect(ada.page.locator('#typing')).toHaveText('')

  // Someone who joins later finds where everyone is. Nobody is told their own presence.
  const edsger = await join(browser, invite, 'Edsger')
  const found = await inRoom(edsger.page, (room) => room.members.map((m) => [m.name, room.presence.get(m) ?? null]))
  expect(found).toEqual([
    ['Ada', { x: 30 }],
    ['Grace', { typing: false }],
    ['Edsger', null],
  ])
  expect(await inRoom(ada.page, (room) => room.presence.get(room.self))).toEqual({ x: 30 })

  // A value saved per player: everyone sees it, under the player's id.
  const gracePid = await inRoom(grace.page, (room) => room.self.pid)
  await inRoom(grace.page, (room) => room.send('pos', { x: 5, z: -2 }, { retain: 'player' }))
  for (const p of [ada, grace, edsger]) {
    await expect.poll(() => inRoom(p.page, (room, pid) => room.retained('pos', { player: pid }), gracePid)).toEqual({ x: 5, z: -2 })
  }
  expect(await inRoom(ada.page, (room) => room.retained('pos') ?? null)).toBe(null)

  // Grace leaves, and comes back through the invite: a new member, the same player.
  await grace.page.getByRole('button', { name: 'Multiplayer' }).click()
  await grace.page.getByRole('button', { name: 'Leave' }).click()
  await expect(ada.page.locator('#state')).toContainText('2 here')
  await grace.page.goto(invite)
  await accept(grace.page, 'Grace')
  expect(await inRoom(grace.page, (room) => room.retained('pos', { player: room.self.pid }))).toEqual({ x: 5, z: -2 })

  // Binary data arrives as the same bytes, whatever view it was sent from.
  for (const p of [grace, edsger]) {
    await inRoom(p.page, (room) => {
      const notes = window as unknown as Notes
      notes.seen = []
      room.on('snap', ((data: unknown, from: Member) => {
        notes.seen.push([data instanceof Uint8Array, Array.from(data as Uint8Array), from.name])
      }) as never)
    })
  }
  const sent = await inRoom(ada.page, (room) => {
    const bytes = new Uint8Array([9, 0, 255, 7, 128, 9])
    let refused = false
    try {
      room.send('snap', bytes, { retain: 'room' })
    } catch {
      refused = true
    }
    return [room.send('snap', bytes.subarray(1, 5)), room.send('snap', new Uint16Array([513]).buffer, { to: 'all' }), refused]
  })
  expect(sent).toEqual([true, true, true])
  for (const p of [grace, edsger]) {
    await expect.poll(() => p.page.evaluate(() => (window as unknown as Notes).seen)).toEqual([
      [true, [0, 255, 7, 128], 'Ada'],
      [true, [1, 2], 'Ada'],
    ])
  }

  for (const p of [ada, grace, edsger]) await p.context.close()
  await owner.close()
})

test('through a slow connection that drops, everything still arrives and everyone comes back', async ({ browser, server }) => {
  const latency = 120
  const proxy = await startLagProxy({ listen: 0, host: HOST, to: { host: '127.0.0.1', port: server.port }, latency, jitter: 40 })
  const far = serverAt(server.url, proxy.port)
  try {
    const owner = await createRoom(browser, server, 'Far away')
    const ada = await player(browser)
    // The first in opens the invite with the proxy's address. The link it passes on carries it to the guests.
    const invite = await host(ada.page, through(owner.invite, server, far), 'Ada')
    expect(invite).toContain(`room=${inInvite(far)}/`)
    const grace = await join(browser, invite, 'Grace')
    const ids = [await selfId(ada.page), await selfId(grace.page)]

    // A message to everyone comes back to its sender after two trips through the proxy.
    const took = await inRoom(ada.page, (room) => {
      return new Promise<number>((resolve) => {
        const start = performance.now()
        const off = room.on('echo', () => {
          off()
          resolve(performance.now() - start)
        })
        room.send('echo', 1, { to: 'all' })
      })
    })
    expect(took).toBeGreaterThanOrEqual(2 * latency)

    // The server's clock, as each page sees it, is right to within the jitter, not off by the delay.
    // (The server is this machine, so its clock is the page's own.)
    for (const p of [ada, grace]) {
      await expect.poll(() => inRoom(p.page, (room) => Math.abs(room.now() - Date.now()))).toBeLessThan(60)
    }

    await grace.page.locator('#text').fill('are you there?')
    await expect(ada.page.locator('#typing')).toHaveText('Grace is typing…')
    await grace.page.locator('#send').click()
    await expect(ada.page.locator('#log li')).toHaveText(['Grace: are you there?'])

    // The network cuts everyone off at once.
    for (const p of [ada, grace]) {
      await inRoom(p.page, (room) => {
        const notes = window as unknown as Notes
        notes.statuses = []
        room.on('status', ((s: string) => notes.statuses.push(s)) as never)
      })
    }
    const statuses = (page: Page) => page.evaluate(() => (window as unknown as Notes).statuses)
    expect(proxy.drop()).toBeGreaterThanOrEqual(2)
    await expect.poll(() => statuses(ada.page)).toEqual(['reconnecting'])
    // What is set while the connection is down is not lost: it goes out when the room is back.
    await inRoom(ada.page, (room) => room.presence.set({ x: 99 }))
    for (const p of [ada, grace]) await expect.poll(() => statuses(p.page)).toEqual(['reconnecting', 'open'])
    expect([await selfId(ada.page), await selfId(grace.page)]).toEqual(ids)
    await expect.poll(() => inRoom(grace.page, (room, id) => room.presence.get(id), ids[0]!)).toEqual({ x: 99 })

    await ada.page.locator('#text').fill('still here')
    await ada.page.locator('#send').click()
    await expect(grace.page.locator('#log li')).toHaveText(['Grace: are you there?', 'Ada: still here'])
    await expect(grace.page.locator('#state')).toHaveText('In "Far away" as Grace (hosted by Ada), 2 here.')

    for (const p of [ada, grace]) await p.context.close()
    await owner.close()
  } finally {
    await proxy.close()
  }
})

/** Starts reading the room's log, and keeps a record: ['load', state], then [seq, op, replayed, sender] per op. */
function follow(page: Page): Promise<void> {
  return inRoom(page, (room) => {
    const notes = window as unknown as Notes
    notes.log = []
    notes.applied = 0
    room.log.open({
      load: (state) => {
        notes.log.push(['load', state ?? null])
        notes.applied = (state as { applied: number } | undefined)?.applied ?? 0
      },
      apply: (op, e) => {
        notes.log.push([e.seq, op, e.replayed, e.from?.name ?? null])
        notes.applied++
      },
      save: () => ({ applied: notes.applied }),
    })
  })
}

const followed = (page: Page) => page.evaluate(() => (window as unknown as Notes).log)

test('the log: the same ops in the same order for everyone, also for who was cut off or comes late', async ({ browser, server }) => {
  // Grace reaches the server the long way round, so that she alone can be cut off, and stays away a moment.
  const proxy = await startLagProxy({ listen: 0, host: HOST, to: { host: '127.0.0.1', port: server.port }, latency: 400, jitter: 0 })
  try {
    const owner = await createRoom(browser, server, 'Log room')
    const ada = await player(browser)
    const invite = await host(ada.page, owner.invite, 'Ada')
    await follow(ada.page)
    expect(await inRoom(ada.page, (room) => room.log.submit('one'))).toBe(true)
    await expect.poll(() => followed(ada.page)).toEqual([['load', null], [1, 'one', false, 'Ada']])

    // Who joins later is handed the saved ops first. They are marked, and their sender may be long gone.
    const grace = await join(browser, invite.replace(inInvite(server.url), inInvite(serverAt(server.url, proxy.port))), 'Grace')
    await follow(grace.page)
    expect(await followed(grace.page)).toEqual([['load', null], [1, 'one', true, null]])
    await inRoom(grace.page, (room) => room.log.submit({ n: 2 }))
    for (const p of [ada, grace]) await expect.poll(async () => (await followed(p.page)).at(-1)).toEqual([2, { n: 2 }, false, 'Grace'])

    // Cut off for a moment: the ops she missed arrive when she is back, and nothing starts over. One she makes
    // meanwhile waits for the connection, and goes after them.
    await inRoom(grace.page, (room) => {
      const notes = window as unknown as Notes
      notes.statuses = []
      room.on('status', ((s: string) => notes.statuses.push(s)) as never)
    })
    const statuses = () => grace.page.evaluate(() => (window as unknown as Notes).statuses)
    expect(proxy.drop()).toBeGreaterThanOrEqual(1)
    await expect.poll(statuses).toEqual(['reconnecting'])
    expect(await inRoom(grace.page, (room) => room.log.submit('waited'))).toBe(true)
    await inRoom(ada.page, (room) => [room.log.submit('three'), room.log.submit('four')])
    await expect.poll(statuses, { timeout: 15_000 }).toEqual(['reconnecting', 'open'])
    await expect.poll(async () => (await followed(grace.page)).slice(3)).toEqual([
      [3, 'three', true, null],
      [4, 'four', true, null],
      [5, 'waited', false, 'Grace'],
    ])
    await expect.poll(async () => (await followed(ada.page)).at(-1)).toEqual([5, 'waited', false, 'Grace'])

    // Cut off again, and this time the host saves a snapshot meanwhile: she starts over from it.
    proxy.drop()
    await expect.poll(statuses).toEqual(['reconnecting', 'open', 'reconnecting'])
    await inRoom(ada.page, async (room) => {
      room.log.submit('five')
      while (room.log.seq < 6) await new Promise((resolve) => setTimeout(resolve, 5))
      room.log.snapshot()
      room.log.submit('six')
    })
    await expect.poll(statuses, { timeout: 15_000 }).toEqual(['reconnecting', 'open', 'reconnecting', 'open'])
    expect((await followed(grace.page)).slice(6)).toEqual([
      ['load', { applied: 6 }],
      [7, 'six', true, null],
    ])
    // The host itself carries on: a snapshot changes nothing for whoever is in the room.
    expect((await followed(ada.page)).slice(6)).toEqual([
      [6, 'five', false, 'Ada'],
      [7, 'six', false, 'Ada'],
    ])
    // A guest cannot replace the log.
    expect(await inRoom(grace.page, (room) => room.log.snapshot('mine'))).toBe(false)

    // The server asks the host for a snapshot when the log grows long (this server keeps 16 KB):
    // the host answers with what its reader's save() returns, and the log never fills up.
    await inRoom(ada.page, async (room) => {
      const notes = window as unknown as Notes
      notes.seen = []
      room.on('error', ((problem: { code: string }) => notes.seen.push(problem.code)) as never)
      // A few at a time, as a game would: the host needs a moment to answer the server.
      for (let n = 0; n < 100; n++) {
        room.log.submit('x'.repeat(250))
        if (n % 5 === 4) await new Promise((resolve) => setTimeout(resolve, 20))
      }
    })
    await expect.poll(() => inRoom(ada.page, (room) => room.log.seq)).toBe(107)
    expect(await ada.page.evaluate(() => (window as unknown as Notes).seen)).toEqual([])
    const edsger = await join(browser, invite, 'Edsger')
    await follow(edsger.page)
    const late = (await followed(edsger.page)) as [unknown, { applied: number }][]
    expect(late[0]![0]).toBe('load')
    expect(late[0]![1].applied).toBeGreaterThan(40)
    expect(late[0]![1].applied + late.length - 1).toBe(107)
    expect(late.length).toBeLessThan(60)

    for (const p of [ada, grace, edsger]) await p.context.close()
    await owner.close()
  } finally {
    await proxy.close()
  }
})

test('a player on another version of the game is kept out, until the owner allows it', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Version room')
  const ada = await player(browser)
  const invite = await host(ada.page, owner.invite, 'Ada')

  const old = await player(browser, `${invite}&v=0.9.0`)
  const joinButton = old.page.getByRole('button', { name: 'Join', exact: true })
  await expect(joinButton).toBeEnabled()
  await old.page.getByLabel('Your name').fill('Grace')
  await joinButton.click()
  await expect(old.page.getByRole('status')).toContainText('different version of the game')
  await expect(ada.page.locator('#state')).toContainText('1 here')

  await owner.portal.reload()
  await owner.portal.getByLabel('Players on different versions of the game').selectOption('off')
  await owner.portal.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(owner.portal.getByLabel('Players on different versions of the game')).toHaveValue('off')
  await joinButton.click()
  await expect(old.page.locator('#state')).toHaveText('In "Version room" as Grace (hosted by Ada), 2 here.')

  for (const p of [ada, old]) await p.context.close()
  await owner.close()
})

test('a local room echoes to its one player, and loads only its own small file', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const scripts: string[] = []
  page.on('request', (r) => {
    if (r.resourceType() === 'script') scripts.push(new URL(r.url()).pathname)
  })
  await page.goto(`${GAME}/index.html`)
  const result = await page.evaluate(async () => {
    const entry = '/dist/p3p2.js'
    const { P3P2 } = (await import(entry)) as { P3P2: { local(name?: string): Promise<TestRoom & { status: string }> } }
    const room = await P3P2.local('Solo')
    const got: unknown[] = []
    room.on('act', ((data: unknown, from: Member, meta: { retained: boolean }) => got.push([data, from.name, meta.retained])) as never)
    room.send('act', 1) // to the others: there are none
    room.send('act', 2, { to: 'all' })
    room.send('act', 3, { to: 'host' })
    room.send('act', { seed: 4 }, { retain: 'room' })
    room.send('act', 5, { retain: 'player' })
    const during = got.length
    await new Promise((resolve) => setTimeout(resolve))
    room.presence.set({ x: 1 })
    return {
      during,
      got,
      who: [room.self.name, room.isHost, room.members.length, room.status],
      saved: [room.retained('act'), room.retained('act', { player: room.self.pid }), room.presence.get(room.self)],
    }
  })
  // Nothing arrives inside send(), as with a server; then exactly what a server would send back.
  expect(result.during).toBe(0)
  expect(result.got).toEqual([
    [2, 'Solo', false],
    [3, 'Solo', false],
    [{ seed: 4 }, 'Solo', true],
    [5, 'Solo', true],
  ])
  expect(result.who).toEqual(['Solo', true, 1, 'open'])
  expect(result.saved).toEqual([{ seed: 4 }, 5, { x: 1 }])
  expect(scripts).toEqual(['/dist/p3p2.js', '/dist/p3p2-local.js'])
  await context.close()
})
