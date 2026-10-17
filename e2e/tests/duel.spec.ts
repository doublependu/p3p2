// The duel example (examples/duel/): a game in turns with something hidden, on one page with one classic script and
// the client from its script tag. The tests answer the script tag's address (jsDelivr) themselves, with the client
// under test, and nothing goes to the network.

import { readFileSync } from 'node:fs'
import type { Browser, BrowserContext, BrowserContextOptions, Page } from '@playwright/test'
import { GAME, HOST, PROXY, serverAt } from '../playwright.config.ts'
import { startLagProxy } from '../tools/lag-proxy.ts'
import { expect, type TestServer, test } from './fixtures.ts'
import { accept, closeEngines, createRoom, measure, otherEngines, phoneContext } from './helpers.ts'

const DUEL = `${GAME}/duel/`
/** The script tag of the page, as docs/integrate.md gives it. */
const CDN = 'https://cdn.jsdelivr.net/npm/@p3p2/client@0.1/dist/p3p2.iife.js'

test.skip(PROXY, 'the client the script tag gets is the one under test, which the proxy setup does not serve')
test.afterAll(closeEngines)

interface Table {
  seats: (string | null)[]
  names: string[]
  n: number
  game: {
    promises: (string | null)[]
    probes: number[][]
    answers: { i: number; hit: boolean }[][]
    reveals: ({ squares: number[]; salt: string } | null)[]
  }
  history: { n: number; winner: string; probes: number; word: string[] }[]
}

interface Duel {
  inRoom: boolean
  seat: number
  table: Table
  turn: number
  over: boolean
  verdicts: string[]
  ops: Record<string, unknown>[]
  secret: { squares: number[]; salt: string } | null
  hide(squares: number[]): boolean
  probe(i: number): boolean
  tap(board: number, i: number): void
  next(): void
}

function duel<T, A = undefined>(page: Page, read: (d: Duel, arg: A) => T, arg?: A): Promise<T> {
  return page.evaluate(
    ({ source, arg }) => new Function('d', 'arg', `return (${source})(d, arg)`)((window as unknown as { example: Duel }).example, arg),
    { source: read.toString(), arg },
  ) as Promise<T>
}

/** A profile whose script tag gets the client under test, from the test, as jsDelivr would serve it. */
async function profile(browser: Browser, options: BrowserContextOptions = {}): Promise<BrowserContext> {
  const context = await browser.newContext(options)
  await route(context)
  return context
}

const iife = () => readFileSync(`${process.env.E2E_CLIENT_DIR}/dist/p3p2.iife.js`)
const route = (context: BrowserContext) => context.route(CDN, (r) => r.fulfill({ body: iife(), contentType: 'text/javascript; charset=utf-8' }))

async function visit(context: BrowserContext, url: string = DUEL): Promise<Page> {
  const page = await context.newPage()
  await page.goto(url)
  await page.waitForFunction(() => (window as unknown as { example?: Duel }).example)
  return page
}

const inRoom = (page: Page) => expect.poll(() => duel(page, (d) => d.inRoom)).toBe(true)

/** Hosts from the panel, opened with the page's own button. */
async function open(page: Page, roomUrl: string, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Friends' }).click()
  await page.getByLabel('Your name').fill(name)
  await page.getByLabel('Room URL').fill(roomUrl)
  await expect(page.getByRole('status')).toContainText('✓')
  await page.getByRole('button', { name: 'Create a multiplayer game room for my friends' }).click()
  const link = page.getByLabel('Invite link', { exact: true })
  await expect(link).toBeVisible()
  const invite = await link.inputValue()
  await page.locator('p3p2-panel').getByRole('button', { name: 'Close' }).click()
  await inRoom(page)
  return invite
}

async function guest(context: BrowserContext, invite: string, name: string): Promise<Page> {
  const page = await visit(context, invite)
  await accept(page, name)
  await inRoom(page)
  return page
}

async function table(browser: Browser, server: TestServer, name: string, players: string[], options: { players?: number } = {}) {
  const owner = await createRoom(browser, server, name, DUEL, options)
  const first = await visit(await profile(browser))
  const invite = await open(first, owner.roomUrl, players[0]!)
  const pages = [first]
  for (const n of players.slice(1)) pages.push(await guest(await profile(browser), invite, n))
  return { owner, invite, pages }
}

const close = async (pages: Page[], owner?: { close(): Promise<void> }) => {
  for (const page of pages) await page.context().close()
  await owner?.close()
}

/** Every page has the same table. */
async function agree(pages: Page[]): Promise<Table> {
  let last: Table | undefined
  await expect
    .poll(async () => {
      const all = await Promise.all(pages.map((p) => duel(p, (d) => JSON.stringify(d.table))))
      last = JSON.parse(all[0]!)
      return new Set(all).size
    })
    .toBe(1)
  return last!
}

/** Both seated players hide their squares, as Ready does. */
async function hideBoth(a: Page, b: Page, mine: number[] = [0, 1, 2, 3, 4], theirs: number[] = [30, 31, 32, 33, 34]): Promise<void> {
  await expect.poll(() => duel(b, (d) => d.table.seats.every(Boolean))).toBe(true)
  expect(await duel(a, (d, s) => d.hide(s), mine)).toBe(true)
  expect(await duel(b, (d, s) => d.hide(s), theirs)).toBe(true)
  await expect.poll(() => duel(a, (d) => d.turn)).not.toBe(-1)
}

/** The player whose probe it is probes, and the other page answers by itself. */
async function probe(pages: Page[], i: number): Promise<void> {
  const turn = await duel(pages[0]!, (d) => d.turn)
  const prober = await find(pages, turn)
  const count = await duel(prober, (d) => d.table.game.probes.flat().length)
  expect(await duel(prober, (d, i) => d.probe(i), i)).toBe(true)
  await expect.poll(() => duel(pages[0]!, (d) => d.table.game.answers.flat().length)).toBe(count + 1)
}

async function find(pages: Page[], seat: number): Promise<Page> {
  for (const page of pages) if ((await duel(page, (d) => d.seat)) === seat) return page
  throw new Error(`nobody in seat ${seat}`)
}

/** To the end of the game: seat 1 finds seat 2's squares, and seat 2 misses in between. `pause`: between probes, ms. */
async function playOut(pages: Page[], pause = 0, hidden = [30, 31, 32, 33, 34], misses = Array.from({ length: 20 }, (_, i) => 10 + i)): Promise<void> {
  const probed = await duel(pages[0]!, (d) => d.table.game.probes)
  const [find0, miss1] = [hidden.filter((i) => !probed[0]!.includes(i)), misses.filter((i) => !probed[1]!.includes(i))]
  while (!(await duel(pages[0]!, (d) => d.over))) {
    const turn = await duel(pages[0]!, (d) => d.turn)
    await probe(pages, turn === 0 ? find0.shift()! : miss1.shift()!)
    if (pause) await pages[0]!.waitForTimeout(pause)
  }
}

test('an ordinary visit loads only its script tag and its own script, and asks no server anything', async ({ browser }) => {
  const context = await profile(browser)
  const page = await context.newPage()
  const scripts: string[] = []
  const elsewhere: string[] = []
  page.on('request', (r) => {
    if (r.resourceType() === 'script') scripts.push(r.url())
    if (!r.url().startsWith(GAME) && r.url() !== CDN) elsewhere.push(r.url())
  })
  await page.goto(DUEL)
  await expect(page.locator('#state')).toContainText('Playing alone')
  expect(scripts).toEqual([CDN, `${DUEL}duel.js`])
  expect(elsewhere).toEqual([])
  // The game has a button of its own for the panel, and the panel shows none.
  await expect(page.getByRole('button', { name: 'Multiplayer', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Friends' }).click()
  await expect(page.getByLabel('Room URL')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Multiplayer', exact: true })).toHaveCount(0)
  await page.locator('p3p2-panel').getByRole('button', { name: 'Close' }).click()
  await expect(page.getByLabel('Room URL')).toBeHidden()
  await context.close()
})

test('two take the seats and a third watches: probes in turn, answered by the other page, and nothing hidden in the room until the end', async ({ browser, server }) => {
  const { owner, invite, pages } = await table(browser, server, 'Hidden boards', ['Ada', 'Grace', 'Edsger'])
  const [ada, grace, edsger] = pages as [Page, Page, Page]
  expect([await duel(ada, (d) => d.seat), await duel(grace, (d) => d.seat), await duel(edsger, (d) => d.seat)]).toEqual([0, 1, -1])
  await hideBoth(ada, grace)
  // Each page knows its own squares; the room has only the promises.
  expect((await duel(ada, (d) => d.secret))!.squares).toEqual([0, 1, 2, 3, 4])
  expect(await duel(edsger, (d) => d.secret)).toBeNull()
  const promises = (await agree(pages)).game.promises
  expect(promises.every((p) => /^[0-9a-f]{64}$/.test(p!))).toBe(true)

  // Out of turn, a probe changes nothing; in turn, the other page answers, hit or miss.
  expect(await duel(grace, (d) => d.probe(5))).toBe(false)
  await probe(pages, 30)
  await probe(pages, 9)
  let t = await agree(pages)
  expect(t.game.answers).toEqual([[{ i: 9, hit: false }], [{ i: 30, hit: true }]])

  // A watcher who comes late replays the whole log, and finds nothing hidden in it.
  const late = await guest(await profile(browser), invite, 'Barbara')
  const ops = await duel(late, (d) => d.ops)
  expect(ops.length).toBeGreaterThan(6)
  expect(JSON.stringify(ops)).not.toContain('squares')
  expect(await duel(late, (d) => d.table.game.reveals)).toEqual([null, null])

  // To the end: then both pages show what they hid, and every page checks it against the promise and every answer.
  await playOut([...pages, late])
  await expect.poll(() => duel(late, (d) => d.verdicts)).toEqual(['kept their word', 'kept their word'])
  t = await agree([...pages, late])
  expect(t.game.reveals.map((r) => r?.squares)).toEqual([[0, 1, 2, 3, 4], [30, 31, 32, 33, 34]])
  await expect(edsger.locator('#state')).toContainText('Ada wins. Ada kept their word; Grace kept their word.')
  await close([...pages, late], owner)
})

test('a room of two is full: a third is turned away, and a seated player who reloads gets the seat back', async ({ browser, server }) => {
  const { owner, invite, pages } = await table(browser, server, 'Two seats', ['Ada', 'Grace'], { players: 2 })
  const [ada, grace] = pages as [Page, Page]
  await hideBoth(ada, grace)
  await probe(pages, 33)
  const third = await visit(await profile(browser), invite)
  await third.getByLabel('Your name').fill('Edsger')
  await third.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(third.locator('p3p2-panel').getByRole('status')).toHaveText('The room is full.')
  await grace.reload()
  await inRoom(grace)
  expect(await duel(grace, (d) => d.seat)).toBe(1)
  // Her squares are still in her browser, and her page answers the next probe.
  expect((await duel(grace, (d) => d.secret))!.squares).toEqual([30, 31, 32, 33, 34])
  await probe(pages, 7)
  await probe(pages, 34)
  expect((await agree(pages)).game.answers[1]).toEqual([{ i: 33, hit: true }, { i: 34, hit: true }])
  await close([...pages, third], owner)
})

test('a reload, of a guest and of the host, in the middle of a game: the same seats and the same game', async ({ browser, server }) => {
  const { owner, pages } = await table(browser, server, 'Reloads', ['Ada', 'Grace'])
  const [ada, grace] = pages as [Page, Page]
  await hideBoth(ada, grace)
  await probe(pages, 31)
  const before = await agree(pages)
  for (const page of [grace, ada]) {
    await page.reload()
    await inRoom(page)
  }
  expect(await agree(pages)).toEqual(before)
  expect([await duel(ada, (d) => d.seat), await duel(grace, (d) => d.seat)]).toEqual([0, 1])
  await probe(pages, 8)
  await probe(pages, 32)
  await close(pages, owner)
})

test.describe('on a server that keeps its data on disk', () => {
  test.use({ onDisk: true })

  test('a probe made while the other player is away waits in the log, and is answered when their page is back, days later', async ({ browser, server }) => {
    const { owner, pages } = await table(browser, server, 'By post', ['Ada', 'Grace'])
    const [ada, grace] = pages as [Page, Page]
    const [adas, graces] = [ada.context(), grace.context()]
    await hideBoth(ada, grace)
    // Grace closes her page. Ada probes, and the probe waits: nobody but Grace's page can answer it.
    await grace.close()
    expect(await duel(ada, (d) => d.probe(32))).toBe(true)
    await expect(ada.locator('#state')).toContainText("Waiting for Grace's page to answer.")
    await ada.close()
    // Three days later. The host pastes the room URL again, and Grace opens the new invite.
    await server.restart({ days: 3 })
    const adaAgain = await visit(adas)
    const invite = await open(adaAgain, owner.roomUrl, 'Ada')
    const back = await guest(graces, invite, 'Grace')
    await expect.poll(() => duel(adaAgain, (d) => d.table.game.answers[1])).toEqual([{ i: 32, hit: true }])
    await agree([adaAgain, back])
    expect(await duel(adaAgain, (d) => d.turn)).toBe(1)
    await close([adaAgain, back], owner)
  })
})

test('through a server far away that drops: a probe made while the connection is down waits, and goes when it is back', async ({ browser, server }) => {
  const proxy = await startLagProxy({ listen: 0, host: HOST, to: { host: '127.0.0.1', port: server.port }, latency: 150, jitter: 50 })
  try {
    const owner = await createRoom(browser, server, 'Far duel', DUEL)
    const ada = await visit(await profile(browser))
    const invite = await open(ada, owner.roomUrl.replace(server.url, serverAt(server.url, proxy.port)), 'Ada')
    const grace = await guest(await profile(browser), invite, 'Grace')
    await hideBoth(ada, grace)
    const status = (page: Page) => page.evaluate(() => (window as unknown as { p3p2: { room: { status: string } } }).p3p2.room.status)
    expect(proxy.drop()).toBeGreaterThanOrEqual(2)
    await expect.poll(() => status(ada)).toBe('reconnecting')
    expect(await duel(ada, (d) => d.probe(30))).toBe(true)
    for (const page of [ada, grace]) await expect.poll(() => status(page), { timeout: 20_000 }).toBe('open')
    await expect.poll(() => duel(ada, (d) => d.table.game.answers[1])).toEqual([{ i: 30, hit: true }])
    await agree([ada, grace])
    await close([ada, grace], owner)
  } finally {
    await proxy.close()
  }
})

test.describe('on a server whose log is small', () => {
  test.use({ settings: { P3P2_MAX_LOG_BYTES: '16384' } })

  test('a long evening fills the log: a snapshot takes its place, and a late watcher gets the same table and every game before', async ({ browser, server }) => {
    test.setTimeout(120_000)
    const { owner, invite, pages } = await table(browser, server, 'Long evening', ['Ada', 'Grace'])
    const [ada, grace] = pages as [Page, Page]
    for (let game = 0; game < 4; game++) {
      await hideBoth(ada, grace, [0, 1, 2, 3, 4], [30, 31, 32, 33, 34])
      // The seats open the games in turn: whoever opens, seat 1 finds seat 2's squares first.
      await playOut(pages)
      await expect.poll(() => duel(ada, (d) => d.verdicts)).toEqual(['kept their word', 'kept their word'])
      await duel(grace, (d) => d.next())
      await expect.poll(() => duel(ada, (d) => d.table.n)).toBe(game + 2)
    }
    await hideBoth(ada, grace)
    await probe(pages, 33)
    const t = await agree(pages)
    expect(t.history).toHaveLength(4)
    const late = await guest(await profile(browser), invite, 'Edsger')
    expect(await agree([...pages, late])).toEqual(t)
    // It started from a snapshot: the ops it was given are far fewer than the evening's.
    expect((await duel(late, (d) => d.ops)).length).toBeLessThan(40)
    await close([...pages, late], owner)
  })
})

test('Chrome, Firefox and WebKit at one table: the same game on every page', async ({ browser, server }) => {
  const engines = await otherEngines()
  const owner = await createRoom(browser, server, 'Three engines', DUEL)
  const ada = await visit(await profile(browser))
  const invite = await open(ada, owner.roomUrl, 'Ada')
  const pages = [ada]
  for (const { name, browser: other } of engines) pages.push(await guest(await profile(other), invite, name))
  await hideBoth(pages[0]!, pages[1]!)
  await probe(pages, 30)
  await probe(pages, 6)
  await probe(pages, 31)
  await agree(pages)
  await close(pages, owner)
})

test('on a phone: the game\'s own button opens a panel that fits, and a probe is two taps', async ({ browser, server }) => {
  const { owner, invite, pages } = await table(browser, server, 'Pocket duel', ['Ada'])
  const context = await phoneContext(browser, false)
  await route(context)
  const phone = await visit(context, invite)
  await phone.getByLabel('Your name').fill('Grace')
  await phone.getByRole('button', { name: 'Join', exact: true }).tap()
  await inRoom(phone)
  // Hiding by touch: five squares, and Ready.
  await duel(pages[0]!, (d) => d.hide([0, 1, 2, 3, 4]))
  for (const i of [6, 7, 8, 9, 10]) await phone.getByRole('button', { name: `Grace, square ${i + 1}`, exact: true }).tap()
  await phone.getByRole('button', { name: 'Ready' }).tap()
  await expect.poll(() => duel(phone, (d) => d.table.game.promises.every(Boolean))).toBe(true)
  // Ada probes first; then Grace's turn: a square picked, and picked again.
  await probe([pages[0]!, phone], 7)
  const square = phone.getByRole('button', { name: 'Ada, square 3', exact: true })
  await square.tap()
  expect(await duel(phone, (d) => d.table.game.probes[1])).toEqual([])
  await square.tap()
  await expect.poll(() => duel(pages[0]!, (d) => d.table.game.answers[0])).toEqual([{ i: 2, hit: true }])
  // The panel, from the game's button, on the phone's screen.
  await phone.getByRole('button', { name: /^Friends/ }).tap()
  const card = (await phone.locator('p3p2-panel .card').boundingBox())!
  const screen = phone.viewportSize()!
  expect(card.x).toBeGreaterThanOrEqual(0)
  expect(card.x + card.width).toBeLessThanOrEqual(screen.width)
  expect(card.y + card.height).toBeLessThanOrEqual(screen.height)
  await close([...pages, phone], owner)
})

test('what a game in turns costs the server', { tag: '@measure' }, async ({ browser, server }) => {
  const { owner, pages } = await table(browser, server, 'Counted duel', ['Ada', 'Grace'])
  // A probe every second and a half, which is quick for a person.
  const traffic = await measure(server, 'duel', pages.length, async () => {
    await hideBoth(pages[0]!, pages[1]!)
    await playOut(pages, 1500)
  })
  test.info().annotations.push({ type: 'traffic', description: JSON.stringify(traffic) })
  expect(traffic.rateDropped).toBe(0)
  expect(traffic.perPlayer.frames).toBeLessThan(5)
  await close(pages, owner)
})
