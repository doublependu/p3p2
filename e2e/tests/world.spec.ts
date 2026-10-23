// The world example (examples/world/): a world raised from a seed the room keeps, stones and walls through the
// room's log, packed snapshots that fit the server, where each player stood, and a second page in the same room.
// Built by Vite with the client under test, as a game builds it (setup.ts).

import type { Browser, Page } from '@playwright/test'
import { devices } from '@playwright/test'
import { GAME, HOST, PROXY, serverAt } from '../playwright.config.ts'
import { startLagProxy } from '../tools/lag-proxy.ts'
import { expect, type TestServer, test } from './fixtures.ts'
import { accept, closeEngines, createRoom, host, inInvite, measure, otherEngines } from './helpers.ts'

const WORLD = `${GAME}/world/`

test.skip(PROXY, 'Caddy serves the examples as they are, and this one is built by Vite')
test.afterAll(closeEngines)

/** What the page keeps in `window.example` (examples/world/world.js). */
interface World {
  part: 'yard' | 'cellar'
  seed: number
  inRoom: boolean
  host: boolean
  closed: string | null
  fingerprint: string
  prints: { yard: string; cellar: string }
  tiles(): string
  stones: number[]
  taken: { yard: [number, string][]; cellar: [number, string][] }
  walls: { yard: string; cellar: string }
  wallCount: number
  seq: number
  loaded: number
  saved: { json: number; packed: number; walls: number } | null
  where: { x: number; y: number }
  others(): { name: string; pid: string; x: number; y: number }[]
  thing: number[] | null
  moving: boolean
  step(dx: number, dy: number): boolean
  goTo(x: number, y: number): boolean
  standOn(stone: number): boolean
  build(walls: number[][]): number
  ground(scattered?: boolean): number[][]
}

/** Runs `read` in the page, on its world. `read` is sent as text: it can use only its arguments. */
function world<T, A = undefined>(page: Page, read: (w: World, arg: A) => T, arg?: A): Promise<T> {
  return page.evaluate(
    ({ source, arg }) => new Function('w', 'arg', `return (${source})(w, arg)`)((window as unknown as { example: World }).example, arg),
    { source: read.toString(), arg },
  ) as Promise<T>
}

/** A player with a browser profile of their own, on a page of the world, ready. */
async function visit(browser: Browser, url: string = WORLD): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await page.goto(url)
  await page.waitForFunction(() => (window as unknown as { example?: World }).example?.fingerprint)
  return page
}

const inRoom = (page: Page) => expect.poll(() => world(page, (w) => w.inRoom)).toBe(true)

/** Hosts from the panel, closes it, and returns the invite. */
async function open(page: Page, roomUrl: string, name: string): Promise<string> {
  const invite = await host(page, roomUrl, name)
  await page.locator('p3p2-panel').getByRole('button', { name: 'Close' }).click()
  await inRoom(page)
  return invite
}

/** Opens an invite in a new profile and says yes. */
async function guest(browser: Browser, invite: string, name: string): Promise<Page> {
  const page = await visitInvite(browser, invite)
  await accept(page, name)
  await inRoom(page)
  return page
}

async function visitInvite(browser: Browser, invite: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await page.goto(invite)
  return page
}

/** What every page in a room must agree on: the world, and what the log made of it. */
const state = (page: Page) => world(page, (w) => JSON.stringify([w.seed, w.prints, w.taken, w.walls]))

async function agree(pages: Page[], timeout = 15_000): Promise<string> {
  let last = ''
  await expect
    .poll(
      async () => {
        const all = await Promise.all(pages.map(state))
        last = all[0]!
        return new Set(all).size
      },
      { timeout },
    )
    .toBe(1)
  return last
}

async function room(browser: Browser, server: TestServer, name: string, players: string[], options: { players?: number } = {}) {
  const owner = await createRoom(browser, server, name, WORLD, options)
  const first = await visit(browser)
  const invite = await open(first, owner.roomUrl, players[0]!)
  const pages = [first]
  for (const n of players.slice(1)) pages.push(await guest(browser, invite, n))
  return { owner, invite, pages }
}

/**
 * Builds `count` walls from the page's open ground, in rows or scattered, a round at a time: a player may send
 * 256 KB a second on a server with the default settings, and what comes faster is dropped.
 */
async function buildMany(page: Page, count: number, scattered: boolean, perRound = 20_000, pause = 1500): Promise<void> {
  // The plan stays in the page. Handed back, it keeps the page busy for seconds on a slow machine, and a host that
  // says nothing for 3 s is a host no more.
  await world(page, (w, scattered) => { (window as unknown as { plan: number[][] }).plan = w.ground(scattered) }, scattered)
  for (let from = 0; from < count; from += perRound) {
    await page.evaluate(
      ([from, to]) => (window as unknown as { example: World; plan: number[][] }).example.build((window as unknown as { plan: number[][] }).plan.slice(from, to)),
      [from, Math.min(count, from + perRound)],
    )
    if (from + perRound < count) await page.waitForTimeout(pause)
  }
}

const close = async (pages: Page[], owner?: { close(): Promise<void> }) => {
  for (const page of pages) await page.context().close()
  await owner?.close()
}

test('an ordinary visit asks no server anything, and loads only the game', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const scripts: string[] = []
  const elsewhere: string[] = []
  page.on('request', (r) => {
    if (r.resourceType() === 'script') scripts.push(new URL(r.url()).pathname)
    if (!r.url().startsWith(GAME)) elsewhere.push(r.url())
  })
  await page.goto(WORLD)
  await expect(page.locator('#state')).toContainText('Playing alone')
  // Alone, the world is the page's own, and plays as before: a step, a stone, a wall.
  const stone = await world(page, (w) => w.standOn(0))
  expect(stone).toBe(true)
  expect((await world(page, (w) => w.taken)).yard.map(([i]) => i)).toEqual([0])
  await page.keyboard.press('Enter')
  await expect.poll(() => world(page, (w) => w.wallCount)).toBeLessThanOrEqual(1)
  // The game's own files, and none of the client's lazy ones: no room code, no panel.
  expect(scripts.filter((s) => /p3p2-(core|panel|qr|local)/.test(s))).toEqual([])
  expect(scripts.every((s) => s.startsWith('/world/assets/'))).toBe(true)
  expect(elsewhere).toEqual([])
  await context.close()
})

test('in Vite\'s dev server too, an ordinary visit loads only the entry of the client', async ({ browser }) => {
  const { spawn } = await import('node:child_process')
  const project = `${process.env.E2E_PROJECTS}/world`
  const port = 5190 + test.info().parallelIndex
  const vite = spawn(process.execPath, [`${import.meta.dirname}/../../node_modules/vite/bin/vite.js`, '--port', String(port), '--strictPort', '--host', HOST], {
    cwd: project,
    stdio: 'ignore',
  })
  try {
    const url = `http://${HOST}:${port}/`
    await expect.poll(() => fetch(url).then((r) => r.ok, () => false), { timeout: 20_000 }).toBe(true)
    const page = await (await browser.newContext()).newPage()
    const client: string[] = []
    page.on('request', (r) => {
      const path = new URL(r.url()).pathname
      if (path.includes('/@p3p2/client/')) client.push(path.split('/').at(-1)!)
    })
    await page.goto(url)
    await expect(page.locator('#state')).toContainText('Playing alone')
    // The entry, and the two helpers the game imports. Without `optimizeDeps.exclude`, Vite would have bundled the
    // whole client into one file for this visit.
    expect(client.sort()).toEqual(['p3p2-pack.js', 'p3p2-smooth.js', 'p3p2.js'])
    await page.context().close()
  } finally {
    vite.kill()
  }
})

test('a host and two guests share one world; a late arrival gets it as it stands', async ({ browser, server }) => {
  const { owner, invite, pages } = await room(browser, server, 'One world', ['Ada', 'Grace', 'Edsger'])
  const [ada, grace, edsger] = pages as [Page, Page, Page]
  // The host's world is everybody's: its seed, raised the same way on every page.
  const seed = await world(ada, (w) => w.seed)
  for (const page of pages) expect(await world(page, (w) => w.seed)).toBe(seed)

  // Stones taken, walls built, by different players.
  await world(grace, (w) => w.standOn(1))
  await world(edsger, (w) => w.standOn(2))
  await world(ada, (w) => w.build(w.ground().slice(0, 50)))
  await expect.poll(() => world(ada, (w) => w.taken.yard.length)).toBe(2)
  const shared = await agree(pages)
  expect(await world(edsger, (w) => w.wallCount)).toBe(50)

  // Each sees the others where they stand, in the same part of the world.
  const at = await world(grace, (w) => w.where)
  await expect.poll(async () => (await world(ada, (w) => w.others())).find((o) => o.name === 'Grace')).toMatchObject(at)

  // Whoever comes later gets the world as it stands, and walks into the yard the others are in.
  const late = await guest(browser, invite, 'Barbara')
  expect(await state(late)).toBe(shared)
  await expect.poll(async () => (await world(late, (w) => w.others())).map((o) => o.name).sort()).toEqual(['Ada', 'Edsger', 'Grace'])
  await close([...pages, late], owner)
})

test('of two players who reach for one stone, the first has it on every page', async ({ browser, server }) => {
  const { owner, pages } = await room(browser, server, 'One stone', ['Ada', 'Grace', 'Edsger'])
  const [ada, grace] = pages as [Page, Page]
  const pids = await Promise.all(pages.map((p) => p.evaluate(() => (window as unknown as { p3p2: { room: { self: { pid: string } } } }).p3p2.room.self.pid)))
  // Both step onto stone 3 at the same moment: two ops, and the server puts one first.
  await Promise.all([world(ada, (w) => w.standOn(3)), world(grace, (w) => w.standOn(3))])
  await expect.poll(() => world(pages[2]!, (w) => w.taken.yard.length)).toBe(1)
  await agree(pages)
  const [[stone, by]] = (await world(ada, (w) => w.taken)).yard as [[number, string]]
  expect(stone).toBe(3)
  expect([pids[0], pids[1]]).toContain(by)
  await close(pages, owner)
})

test('two people host an empty room at the same moment and end up in one world; a room that holds a world wins over whoever hosts next', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Both at once', WORLD)
  const [ada, grace] = [await visit(browser), await visit(browser)]
  const seeds = [await world(ada, (w) => w.seed), await world(grace, (w) => w.seed)]
  expect(seeds[0]).not.toBe(seeds[1])
  for (const [page, name] of [[ada, 'Ada'], [grace, 'Grace']] as const) {
    await page.getByRole('button', { name: 'Multiplayer' }).click()
    await page.getByLabel('Your name').fill(name)
    await page.getByLabel('Room URL').fill(owner.roomUrl)
    await expect(page.getByRole('status')).toContainText('✓')
  }
  const create = { name: 'Create a multiplayer game room for my friends' }
  await Promise.all([ada.getByRole('button', create).click(), grace.getByRole('button', create).click()])
  // One of them was first, by the server's count. The other's page raises that world in place of its own.
  for (const page of [ada, grace]) await inRoom(page)
  await agree([ada, grace])
  expect(seeds).toContain(await world(ada, (w) => w.seed))
  await expect.poll(async () => (await world(ada, (w) => w.others())).length).toBe(1)

  // Another day the room is empty, and somebody else hosts in it, standing in a world of their own.
  const held = await world(ada, (w) => w.seed)
  await close([ada, grace])
  const edsger = await visit(browser)
  expect(await world(edsger, (w) => w.seed)).not.toBe(held)
  await open(edsger, owner.roomUrl, 'Edsger')
  await expect.poll(() => world(edsger, (w) => w.seed)).toBe(held)
  await close([edsger], owner)
})

test('Chrome, Firefox and WebKit raise the same world from one seed, tile by tile, and play it alike', async ({ browser, server }) => {
  test.setTimeout(90_000)
  const engines = await otherEngines()
  const owner = await createRoom(browser, server, 'Three engines', WORLD)
  const ada = await visit(browser)
  const invite = await open(ada, owner.roomUrl, 'Ada')
  const pages = [ada]
  for (const { name, browser: other } of engines) pages.push(await guest(other, invite, name))
  // Both parts of the world, by their prints, and the yard tile by tile: a shuffle by `sort` would show here.
  const prints = await Promise.all(pages.map((p) => world(p, (w) => [w.prints, w.stones])))
  for (const p of prints) expect(p).toEqual(prints[0])
  const tiles = await Promise.all(pages.map((p) => world(p, (w) => w.tiles())))
  for (const [i, t] of tiles.entries()) expect(t === tiles[0], `the tiles in ${['chrome', ...engines.map((e) => e.name)][i]}`).toBe(true)
  // And they play it alike: a stone each, and walls.
  for (const [i, page] of pages.entries()) await world(page, (w, i) => w.standOn(i), i)
  await world(pages[1]!, (w) => w.build(w.ground(true).slice(0, 200)))
  await expect.poll(() => world(ada, (w) => w.taken.yard.length)).toBe(3)
  await agree(pages)
  await close(pages, owner)
})

test('snapshots are packed: a world too large for one message as JSON reaches a newcomer whole', async ({ browser, server }) => {
  const { owner, invite, pages } = await room(browser, server, 'Packed', ['Ada', 'Grace'])
  const [ada] = pages as [Page]
  // Walls in rows, 50,000 of them: as JSON, more than the 64 KB a message may be.
  await buildMany(ada, 50_000, false)
  await expect.poll(() => world(ada, (w) => w.wallCount), { timeout: 20_000 }).toBe(50_000)
  await expect.poll(() => ada.evaluate(() => (window as unknown as { p3p2: { room: { log: { snapshot(): boolean } } } }).p3p2.room.log.snapshot())).toBe(true)
  await expect.poll(() => world(ada, (w) => w.saved)).not.toBeNull()
  const saved = (await world(ada, (w) => w.saved))!
  expect(saved.json).toBeGreaterThan(64 * 1024)
  expect(saved.packed).toBeLessThan(64 * 1024)
  test.info().annotations.push({ type: 'packed', description: JSON.stringify(saved) })
  const late = await guest(browser, invite, 'Edsger')
  expect(await world(late, (w) => w.loaded)).toBeGreaterThanOrEqual(50_000)
  await agree([...pages, late])
  await close([...pages, late], owner)
})

test.describe('on a server whose log is small', () => {
  test.use({ settings: { P3P2_MAX_LOG_BYTES: '16384' } })

  test('the world keeps the newest walls that fit, and every page, a newcomer\'s too, agrees on them', async ({ browser, server }) => {
    const { owner, invite, pages } = await room(browser, server, 'Small log', ['Ada', 'Grace'])
    const [ada, grace] = pages as [Page, Page]
    // Walls scattered over the yard, which pack the least well, two hundred at a time from both players.
    for (let round = 0; round < 12; round++) {
      await world(round % 2 ? grace : ada, (w, round) => w.build(w.ground(true).slice(0, 200).map(([x, y]) => [x!, y!, 1 + (round % 2)])), round)
      await ada.waitForTimeout(300)
    }
    const kept = await world(ada, (w) => w.wallCount)
    expect(kept).toBeGreaterThan(100)
    expect(kept).toBeLessThan(2400)
    await agree(pages)
    const late = await guest(browser, invite, 'Edsger')
    await agree([...pages, late])
    // It goes on working: a wall more, on every page.
    const before = await world(ada, (w) => w.walls.yard)
    await world(late, (w) => w.build(w.ground(true).slice(0, 1)))
    await expect.poll(() => world(ada, (w) => w.walls.yard)).not.toBe(before)
    await agree([...pages, late])
    test.info().annotations.push({ type: 'kept', description: String(await world(ada, (w) => w.wallCount)) })
    await close([...pages, late], owner)
  })
})


/** The player's id on this server, and their own value on a channel, as the room holds it. */
const pid = (page: Page) => page.evaluate(() => (window as unknown as { p3p2: { room: { self: { pid: string } } } }).p3p2.room.self.pid)
const ownValue = (page: Page, channel: string, player: string) =>
  page.evaluate(
    ([channel, player]) => (window as unknown as { p3p2: { room: { retained(ch: string, o: { player: string }): unknown } } }).p3p2.room.retained(channel!, { player: player! }),
    [channel, player],
  )

/** The page as a browser reports it when its tab is not in front: when a game writes down what it must not lose. */
const hide = (page: Page) =>
  page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })

/**
 * Puts the player somewhere new, walks a few steps from there with the arrow keys (a step into a tree is no step),
 * and makes sure the room has written down where the player now stands.
 */
async function walkAndKeep(page: Page, watcher: Page, keys: string[]): Promise<{ x: number; y: number }> {
  await world(page, (w) => w.goTo(...(w.ground(true)[0]!.slice(0, 2) as [number, number])))
  for (const key of keys) await page.keyboard.press(key)
  const at = await world(page, (w) => w.where)
  await hide(page)
  const of = await pid(page)
  await expect.poll(() => ownValue(watcher, 'stand:yard', of)).toEqual([at.x, at.y])
  return at
}

/** Hosts again in a room, from a page of a profile that was there before: the room URL pasted, as any other day. */
async function hostAgain(page: Page, roomUrl: string, name: string): Promise<string> {
  await page.goto(WORLD)
  await page.waitForFunction(() => (window as unknown as { example?: World }).example?.fingerprint)
  return open(page, roomUrl, name)
}

test.describe('on a server that keeps its data on disk', () => {
  test.use({ onDisk: true })

  test('where you stood is where you stand: after a reload, after a restart, and a week later', async ({ browser, server }) => {
    test.setTimeout(90_000)
    const { owner, invite, pages } = await room(browser, server, 'Where you stood', ['Ada', 'Grace'])
    const [ada, grace] = pages as [Page, Page]
    const [adas, graces] = [ada.context(), grace.context()]

    // Grace walks off, and reloads: back where she stood. So is the host.
    let stood = await walkAndKeep(grace, ada, ['ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowDown'])
    await grace.reload()
    await inRoom(grace)
    expect(await world(grace, (w) => w.where)).toEqual(stood)
    const adaStood = await walkAndKeep(ada, grace, ['ArrowLeft', 'ArrowUp'])
    await ada.reload()
    await inRoom(ada)
    expect(await world(ada, (w) => w.where)).toEqual(adaStood)

    // She walks on and closes the page, and the server is restarted. She comes back by the invite.
    stood = await walkAndKeep(grace, ada, ['ArrowLeft', 'ArrowLeft'])
    await grace.close()
    await server.restart()
    let back = await graces.newPage()
    await back.goto(invite)
    await accept(back, 'Grace')
    await inRoom(back)
    expect(await world(back, (w) => w.where)).toEqual(stood)

    // A week later. Everybody has gone, the invite has run out, and the host pastes the room URL again.
    stood = await walkAndKeep(back, ada, ['ArrowDown'])
    const seed = await world(ada, (w) => w.seed)
    await ada.close()
    await back.close()
    await server.restart({ days: 7 })
    const adaAgain = await adas.newPage()
    const again = await hostAgain(adaAgain, owner.roomUrl, 'Ada')
    back = await graces.newPage()
    await back.goto(again)
    await accept(back, 'Grace')
    await inRoom(back)
    expect(await world(back, (w) => [w.seed, w.where])).toEqual([seed, stood])
    await close([back, adaAgain], owner)
  })
})

test('through a server far away that drops: ops made while the connection is down wait, and go when it is back', async ({ browser, server }) => {
  const proxy = await startLagProxy({ listen: 0, host: HOST, to: { host: '127.0.0.1', port: server.port }, latency: 150, jitter: 50 })
  try {
    const owner = await createRoom(browser, server, 'Far away', WORLD)
    const ada = await visit(browser)
    // The host pastes the room URL with the proxy's address, and the invite takes the guests the same way.
    const invite = await open(ada, owner.roomUrl.replace(server.url, serverAt(server.url, proxy.port)), 'Ada')
    expect(invite).toContain(inInvite(serverAt(server.url, proxy.port)))
    const grace = await guest(browser, invite, 'Grace')
    await world(grace, (w) => w.standOn(4))
    await expect.poll(() => world(ada, (w) => w.taken.yard.length)).toBe(1)
    await agree([ada, grace])

    // The network cuts them both off. What they do meanwhile waits, in order, and goes when they are back.
    const status = (page: Page) => page.evaluate(() => (window as unknown as { p3p2: { room: { status: string } } }).p3p2.room.status)
    expect(proxy.drop()).toBeGreaterThanOrEqual(2)
    for (const page of [ada, grace]) await expect.poll(() => status(page)).toBe('reconnecting')
    await world(grace, (w) => w.standOn(5))
    await world(ada, (w) => w.build(w.ground().slice(0, 3)))
    for (const page of [ada, grace]) await expect.poll(() => status(page), { timeout: 20_000 }).toBe('open')
    await expect.poll(() => world(ada, (w) => w.taken.yard.map(([i]) => i))).toEqual([4, 5])
    await expect.poll(() => world(grace, (w) => w.wallCount)).toBe(3)
    await agree([ada, grace])
    await close([ada, grace], owner)
  } finally {
    await proxy.close()
  }
})

test('an op on its way to the server when the connection drops is not lost', async ({ browser, server }) => {
  test.fail(true, 'The client does not keep an op it has sent until the server has taken it: one that is still on its way when the connection drops is lost, and nothing tells the game')
  const proxy = await startLagProxy({ listen: 0, host: HOST, to: { host: '127.0.0.1', port: server.port }, latency: 150, jitter: 0 })
  try {
    const owner = await createRoom(browser, server, 'In flight', WORLD)
    const ada = await visit(browser)
    const invite = await open(ada, owner.roomUrl.replace(server.url, serverAt(server.url, proxy.port)), 'Ada')
    const grace = await guest(browser, invite, 'Grace')
    // Grace takes a stone, and the network goes down before her op has reached the server.
    await world(grace, (w) => w.standOn(4))
    proxy.drop()
    await expect.poll(() => world(ada, (w) => w.taken.yard.map(([i]) => i)), { timeout: 15_000 }).toEqual([4])
    await agree([ada, grace])
    await close([ada, grace], owner)
  } finally {
    await proxy.close()
  }
})

test('every op submitted while the connection is down arrives', { tag: '@this-client' }, async ({ browser, server }) => {
  const proxy = await startLagProxy({ listen: 0, host: HOST, to: { host: '127.0.0.1', port: server.port }, latency: 50, jitter: 0 })
  try {
    const owner = await createRoom(browser, server, 'Many waiting', WORLD)
    const ada = await visit(browser)
    const invite = await open(ada, owner.roomUrl.replace(server.url, serverAt(server.url, proxy.port)), 'Ada')
    const grace = await guest(browser, invite, 'Grace')
    // The moment Grace's connection is lost, she builds 256 walls, an op each: more than the server takes at once.
    // In the same turn of the page's code, so every one of them waits for the connection.
    await world(grace, (w) => {
      type Room = { on(event: string, handler: (status: string) => void): () => void }
      const page = window as unknown as { p3p2: { room: Room }; built?: Promise<number> }
      page.built = new Promise((resolve) => {
        const off = page.p3p2.room.on('status', (status) => {
          if (status !== 'reconnecting') return
          off()
          let sent = 0
          for (const wall of w.ground().slice(0, 256)) sent += w.build([wall])
          resolve(sent)
        })
      })
    })
    expect(proxy.drop()).toBeGreaterThanOrEqual(2)
    expect(await grace.evaluate(() => (window as unknown as { built: Promise<number> }).built)).toBe(256)
    await expect.poll(() => world(ada, (w) => w.wallCount), { timeout: 20_000 }).toBe(256)
    await agree([ada, grace])
    await close([ada, grace], owner)
  } finally {
    await proxy.close()
  }
})

test('through the door: the cellar is the same room, as the same member, without a question; its thing is moved by whoever has been in the room longest, and the next carries on', async ({ browser, server }) => {
  const { owner, pages } = await room(browser, server, 'Two pages', ['Ada', 'Grace', 'Edsger'])
  const [ada, grace, edsger] = pages as [Page, Page, Page]
  const self = (page: Page) => page.evaluate(() => (window as unknown as { p3p2: { room: { self: { id: number; pid: string } } } }).p3p2.room.self)
  const before = await self(grace)

  // Grace walks onto the yard's door: the cellar's page, in the same room, as the same member.
  const through = async (page: Page) => {
    const url = page.url()
    await page.evaluate(() => (window as unknown as { example: World & { toDoor(): void } }).example.toDoor())
    await page.waitForURL((u) => u.href !== url)
    await page.waitForFunction(() => (window as unknown as { example?: World }).example?.inRoom)
  }
  await through(grace)
  expect(await world(grace, (w) => w.part)).toBe('cellar')
  expect(await self(grace)).toEqual(before)
  await expect(grace.locator('p3p2-panel').getByRole('button', { name: 'Join', exact: true })).toHaveCount(0)
  await expect(ada.locator('#who')).toContainText('Grace: cellar')
  // The cellar's stones are the room's too: one taken there is taken for the yard's pages as well.
  await world(grace, (w) => w.standOn(0))
  await expect.poll(() => world(ada, (w) => w.taken.cellar.length)).toBe(1)
  await agree([ada, grace, edsger])

  // Alone in the cellar, she moves its thing. Then Edsger comes down, and Ada: the longest in the room of those
  // down here is Ada, who moves it now, from where it was.
  await expect.poll(() => world(grace, (w) => w.moving)).toBe(true)
  await through(edsger)
  await expect.poll(() => world(edsger, (w) => w.thing !== null)).toBe(true)
  expect(await world(edsger, (w) => w.moving)).toBe(false)
  await through(ada)
  await expect.poll(() => world(ada, (w) => w.moving)).toBe(true)
  await expect.poll(() => world(grace, (w) => w.moving)).toBe(false)
  const near = async (a: Page, b: Page) => {
    const [p, q] = [await world(a, (w) => w.thing), await world(b, (w) => w.thing)]
    return p && q ? Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!) : 99
  }
  await expect.poll(() => near(grace, edsger)).toBeLessThan(2.5)

  // Ada goes back up: Grace, next in order, carries on from where she last saw it.
  const seen = await world(grace, (w) => w.thing)
  await through(ada)
  await expect.poll(() => world(grace, (w) => w.moving)).toBe(true)
  const carried = await world(grace, (w) => w.thing)
  expect(Math.hypot(carried![0]! - seen![0]!, carried![1]! - seen![1]!)).toBeLessThan(4)
  await expect.poll(() => near(grace, edsger)).toBeLessThan(2.5)
  await close(pages, owner)
})

test('the chat opens with T, since Enter builds', async ({ browser, server }) => {
  const { owner, pages } = await room(browser, server, 'Keys', ['Ada', 'Grace'])
  const [ada, grace] = pages as [Page, Page]
  // Enter is the game's: a wall in front, and no chat. Ada stands where three tiles in a row are open ground.
  await world(ada, (w) => {
    const open = new Set(w.ground().map(([x, y]) => `${x},${y}`))
    const [x, y] = w.ground().find(([x, y]) => open.has(`${x! + 1},${y}`) && open.has(`${x! + 2},${y}`))!
    w.goTo(x!, y!)
  })
  await ada.keyboard.press('ArrowRight')
  await ada.keyboard.press('Enter')
  await expect.poll(() => world(grace, (w) => w.wallCount)).toBe(1)
  await expect(ada.getByPlaceholder('Say something…')).toBeHidden()
  // T opens the chat; a line, Enter sends it, and the game has the keys again.
  await ada.keyboard.press('t')
  await expect(ada.getByPlaceholder('Say something…')).toBeFocused()
  await ada.keyboard.type('mind the wall')
  await ada.keyboard.press('Enter')
  await expect.poll(() => grace.evaluate(() => (window as unknown as { p3p2: { room: { chat: { messages: { text: string }[] } } } }).p3p2.room.chat.messages.map((m) => m.text))).toEqual(['mind the wall'])
  expect(await world(grace, (w) => w.wallCount)).toBe(1)
  await ada.keyboard.press('Enter')
  await expect.poll(() => world(grace, (w) => w.wallCount)).toBe(0)
  await close(pages, owner)
})

test('a duplicated tab takes over the room, and the first says why it left', async ({ browser, server }) => {
  const { owner, pages } = await room(browser, server, 'Two tabs', ['Ada', 'Grace'])
  const [, grace] = pages as [Page, Page]
  // A browser copies a tab's session when it duplicates it, and the copy comes back to the room as the same member.
  const session = await grace.evaluate(() => sessionStorage.getItem('p3p2:session:world-example'))
  const copy = await grace.context().newPage()
  await copy.addInitScript((s) => sessionStorage.setItem('p3p2:session:world-example', s!), session)
  await copy.goto(grace.url())
  await copy.waitForFunction(() => (window as unknown as { example?: World }).example?.inRoom)
  await expect.poll(() => world(grace, (w) => w.closed)).toBe('replaced')
  await expect(grace.locator('#note')).toHaveText('This room is now open in another tab.')
  await expect(grace.locator('#state')).toContainText('Playing alone')
  await close(pages, owner)
})

// ---- what later changes must keep ----

test('a household of four from one address all get in, and one who reloads while the room is full gets the place back', async ({ browser, server }) => {
  const { owner, invite, pages } = await room(browser, server, 'Household', ['Ada', 'Grace', 'Edsger', 'Barbara'], { players: 4 })
  for (const page of pages) await expect(page.locator('#state')).toContainText('4 here')
  const id = (page: Page) => page.evaluate(() => (window as unknown as { p3p2: { room: { self: { id: number } } } }).p3p2.room.self.id)
  const before = await id(pages[2]!)
  await pages[2]!.reload()
  await inRoom(pages[2]!)
  expect(await id(pages[2]!)).toBe(before)
  for (const page of pages) await expect(page.locator('#state')).toContainText('4 here')
  // A fifth is turned away: the room is full.
  const fifth = await visitInvite(browser, invite)
  await fifth.getByLabel('Your name').fill('Alan')
  await fifth.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(fifth.locator('p3p2-panel').getByRole('status')).toHaveText('The room is full.')
  await close([...pages, fifth], owner)
})

test('"Join?": before the click, the server the link leads to, Join and Play alone; after it, the room and who is there. A link to a server that does not answer can still be played alone', async ({ browser, server }) => {
  const { owner, invite, pages } = await room(browser, server, 'Asked first', ['Ada'])
  const grace = await visitInvite(browser, invite)
  const panel = grace.locator('p3p2-panel')
  await expect(panel).toContainText(new URL(server.url).host)
  await expect(panel.getByRole('button', { name: 'Join', exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Play alone' })).toBeVisible()
  await accept(grace, 'Grace')
  await inRoom(grace)
  await grace.getByRole('button', { name: 'Multiplayer' }).click()
  await expect(panel).toContainText('Asked first')
  await expect(panel.locator('.members li')).toHaveText([/Ada/, /Grace/])

  // An invite to a server that is not there.
  const dead = await visitInvite(browser, `${WORLD}?room=${inInvite(`http://${HOST}:18999`)}/abcdefghjk`)
  const deadPanel = dead.locator('p3p2-panel')
  await expect(deadPanel).toContainText(`${HOST}:18999`)
  await deadPanel.getByRole('button', { name: 'Play alone' }).click()
  await expect(dead.locator('#state')).toContainText('Playing alone')
  expect(await world(dead, (w) => w.standOn(0))).toBe(true)
  await close([...pages, grace, dead], owner)
})

for (const frames of [64, 1024]) {
  test.describe(`on a server whose messages may be ${frames} KB`, () => {
    // A player may send as much a second as a message holds, or a message that large is dropped as over the rate.
    if (frames > 64) test.use({ settings: { P3P2_MAX_FRAME_BYTES: String(frames * 1024), P3P2_BYTES_RATE: String(frames * 1024) } })
    for (const scattered of [true, false]) {
      test(`the largest world it holds, with walls ${scattered ? 'scattered' : 'in rows'}; a newcomer gets the same`, async ({ browser, server }) => {
        test.setTimeout(120_000)
        const { owner, invite, pages } = await room(browser, server, 'Largest', ['Ada'])
        const [ada] = pages as [Page]
        // More walls than the world keeps: it keeps the newest that fit in a snapshot, and at most 100,000.
        await buildMany(ada, 110_000, scattered, frames === 64 ? 20_000 : 40_000)
        await expect.poll(() => world(ada, (w) => w.saved?.walls ?? 0), { timeout: 30_000 }).toBeGreaterThan(0)
        await ada.evaluate(() => (window as unknown as { p3p2: { room: { log: { snapshot(): boolean } } } }).p3p2.room.log.snapshot())
        const late = await guest(browser, invite, 'Grace')
        await agree([ada, late], 30_000)
        const kept = await world(ada, (w) => w.wallCount)
        const saved = await world(ada, (w) => w.saved)
        test.info().annotations.push({ type: 'largest', description: JSON.stringify({ frames, scattered, kept, saved }) })
        expect(kept).toBeGreaterThan(scattered && frames === 64 ? 5_000 : 99_000)
        expect(kept).toBeLessThanOrEqual(100_000)
        await close([ada, late], owner)
      })
    }
  })
}

test.describe('on a server with 1 MB messages and its byte rate as it comes', () => {
  test.use({ settings: { P3P2_MAX_FRAME_BYTES: String(1024 * 1024) } })

  test('an op as large as a message may be arrives', { tag: '@this-server' }, async ({ browser, server }) => {
    const { owner, pages } = await room(browser, server, 'Large ops', ['Ada', 'Grace'])
    const [ada, grace] = pages as [Page, Page]
    // One op of 50,000 walls: about 600 KB, under the 1 MB the server takes in one message.
    expect(await world(ada, (w) => w.build(w.ground().slice(0, 50_000)))).toBe(1)
    await expect.poll(() => world(grace, (w) => w.wallCount), { timeout: 10_000 }).toBe(50_000)
    await close(pages, owner)
  })
})

test.describe('on a server that keeps its data on disk, three months on', () => {
  test.use({ onDisk: true })

  test('after 90 days away, the room URL pasted again gives the same room and world, the guests are the same players, and their own values are theirs', async ({ browser, server }) => {
    test.setTimeout(90_000)
    const { owner, pages } = await room(browser, server, 'Three months', ['Ada', 'Grace'])
    const [ada, grace] = pages as [Page, Page]
    const [adas, graces] = [ada.context(), grace.context()]
    const gracePid = await pid(grace)
    await world(grace, (w) => w.standOn(6))
    await world(ada, (w) => w.build(w.ground().slice(0, 20)))
    const stood = await walkAndKeep(grace, ada, ['ArrowUp', 'ArrowUp'])
    const shared = await agree(pages)
    await ada.close()
    await grace.close()

    await server.restart({ days: 90 })
    const adaAgain = await hostAgain(await adas.newPage(), owner.roomUrl, 'Ada')
    const back = await graces.newPage()
    await back.goto(adaAgain)
    await accept(back, 'Grace')
    await inRoom(back)
    expect(await pid(back)).toBe(gracePid)
    expect(await world(back, (w) => w.where)).toEqual(stood)
    expect(await ownValue(back, 'stand:yard', gracePid)).toEqual([stood.x, stood.y])
    const hosts = adas.pages()
    expect(await state(back)).toBe(shared)
    expect(await state(hosts.at(-1)!)).toBe(shared)
    await expect(back.locator('#state')).toContainText('In "Three months"')
    for (const c of [adas, graces]) await c.close()
    await owner.close()
  })
})

test('on an iPhone, by WebKit: in by the link, a tap walks, and the panel fits', async ({ browser, server }) => {
  test.setTimeout(90_000)
  const engines = await otherEngines()
  const safari = engines.find((e) => e.name === 'webkit')!.browser
  const { defaultBrowserType: _, ...iphone } = devices['iPhone 15']!
  const { owner, invite, pages } = await room(browser, server, 'Pocket world', ['Ada'])
  const phone = await (await safari.newContext(iphone)).newPage()
  await phone.goto(invite)
  await phone.getByLabel('Your name').fill('Grace')
  await phone.getByRole('button', { name: 'Join', exact: true }).tap()
  await inRoom(phone)
  await agree([pages[0]!, phone])
  const from = await world(phone, (w) => w.where)
  const view = (await phone.locator('#view').boundingBox())!
  // A tap right of the middle: a step right, if the ground there is open; else the player stays.
  await phone.touchscreen.tap(view.x + view.width * 0.95, view.y + view.height / 2)
  await expect.poll(async () => (await world(phone, (w) => w.where)).x - from.x).toBeGreaterThanOrEqual(0)
  await phone.getByRole('button', { name: 'Multiplayer' }).tap()
  const card = (await phone.locator('p3p2-panel .card').boundingBox())!
  const screen = phone.viewportSize()!
  expect(card.x).toBeGreaterThanOrEqual(0)
  expect(card.x + card.width).toBeLessThanOrEqual(screen.width)
  expect(card.y + card.height).toBeLessThanOrEqual(screen.height)
  await close([...pages, phone], owner)
})

test('what four walkers and a builder cost the server', { tag: '@measure' }, async ({ browser, server }) => {
  const { owner, pages } = await room(browser, server, 'Counted world', ['Ada', 'Grace', 'Edsger', 'Barbara'])
  const traffic = await measure(server, 'world', pages.length, async () => {
    await Promise.all(
      pages.map(async (page, n) => {
        for (let t = 0; t < 50; t++) {
          await world(page, (w, t) => (t % 2 ? w.step(t % 4 === 1 ? 1 : -1, 0) : w.step(0, t % 4 === 0 ? 1 : -1)), t)
          if (n === 0 && t % 10 === 0) await world(page, (w, t) => w.build(w.ground(true).slice(0, 20 + t)), t)
          await page.waitForTimeout(200)
        }
      }),
    )
  })
  test.info().annotations.push({ type: 'traffic', description: JSON.stringify(traffic) })
  expect(traffic.rateDropped).toBe(0)
  expect(traffic.volatileDropped).toBe(0)
  expect(traffic.perPlayer.frames).toBeLessThan(20)
  await close(pages, owner)
})

test('a server older than the game: the panel says the server is the part to update', { tag: '@this-client' }, async ({ browser, server }) => {
  const { owner, invite, pages } = await room(browser, server, 'Old server', ['Ada'])
  // The hello is rewritten on its way to ask for a protocol the server does not take; the server's answer comes back.
  const grace = await (await browser.newContext()).newPage()
  await grace.routeWebSocket(/\/api\/v1\/ws$/, (ws) => {
    const upstream = ws.connectToServer()
    ws.onMessage((m) => upstream.send(typeof m === 'string' && m.includes('"t":"hello"') ? m.replace('"proto":1', '"proto":99') : m))
    upstream.onMessage((m) => ws.send(m))
  })
  await grace.goto(invite)
  await grace.getByLabel('Your name').fill('Grace')
  await grace.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(grace.locator('p3p2-panel').getByRole('status')).toHaveText(`${new URL(server.url).host} runs a p3p2 older than this game needs. Its owner can update it.`)
  await close([...pages, grace], owner)
})
