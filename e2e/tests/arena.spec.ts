// The arena example (examples/arena/): one page runs the bots and a ball for everybody and tells each player only
// what it can see; players move their own figures, drawn by the others with Smooth; the round is a value the room
// keeps, and outlives its host. Built by Vite with the client under test (setup.ts), and once more with another
// build id: a newer version of the game.

import type { Browser, BrowserContext, Page, WebSocketRoute } from '@playwright/test'
import { GAME, HOST, PROXY, serverAt } from '../playwright.config.ts'
import { startLagProxy } from '../tools/lag-proxy.ts'
import { expect, type TestServer, test } from './fixtures.ts'
import { accept, closeEngines, createRoom, fingers, host, measure, otherEngines, phoneContext, through } from './helpers.ts'

const ARENA = `${GAME}/arena/`
const NEXT = `${GAME}/arena-next/`

test.skip(PROXY, 'Caddy serves the examples as they are, and this one is built by Vite')
test.afterAll(closeEngines)

type Point = [number, number]

interface Arena {
  me: { x: number; y: number }
  host: boolean
  inRoom: boolean
  round: { n: number; start: number; scores: Record<string, number> }
  caught: number
  seen: Record<string, Point>
  others(): Record<string, Point>
  targets: Record<string, string>
  told: Record<string, number>
  got: { bytes: number; things: string[] }
  push(x: number, y: number): void
  goTo(x: number, y: number): void
  kick(): void
  track(name: string, ms: number): Promise<[number, number, number][]>
}

/** Runs `read` in the page, on its arena. `read` is sent as text: it can use only its arguments. */
function arena<T, A = undefined>(page: Page, read: (a: Arena, arg: A) => T, arg?: A): Promise<Awaited<T>> {
  return page.evaluate(
    ({ source, arg }) => new Function('a', 'arg', `return (${source})(a, arg)`)((window as unknown as { example: Arena }).example, arg),
    { source: read.toString(), arg },
  ) as Promise<Awaited<T>>
}

async function visit(browser: Browser | BrowserContext, url: string = ARENA): Promise<Page> {
  const page = 'newContext' in browser ? await (await browser.newContext()).newPage() : await browser.newPage()
  await page.goto(url)
  await page.waitForFunction(() => (window as unknown as { example?: Arena }).example)
  return page
}

const inRoom = (page: Page) => expect.poll(() => arena(page, (a) => a.inRoom)).toBe(true)

async function guest(browser: Browser | BrowserContext, invite: string, name: string): Promise<Page> {
  const page = await visit(browser, invite)
  await accept(page, name)
  await inRoom(page)
  return page
}

async function crew(browser: Browser, server: TestServer, name: string, players: string[], url: string = ARENA) {
  const owner = await createRoom(browser, server, name, url)
  const first = await visit(browser, url)
  const invite = await host(first, owner.invite, players[0]!)
  await first.locator('p3p2-panel').getByRole('button', { name: 'Close' }).click()
  await inRoom(first)
  const pages = [first]
  for (const n of players.slice(1)) pages.push(await guest(browser, invite, n))
  return { owner, invite, pages }
}

const close = async (pages: Page[], owner?: { close(): Promise<void> }) => {
  for (const page of pages) await page.context().close()
  await owner?.close()
}

/** Where `watcher` draws the figure of the player called `name`. */
const drawn = async (watcher: Page, name: string) => (await arena(watcher, (a) => a.others()))[name]

/** Puts a player somewhere, and waits until `watcher` draws them there. */
async function place(page: Page, x: number, y: number, watchers: Page[], name: string): Promise<void> {
  await arena(page, (a, [x, y]) => a.goTo(x!, y!), [x, y])
  for (const w of watchers) {
    await expect.poll(async () => {
      const at = await drawn(w, name)
      return at ? Math.hypot(at[0] - x, at[1] - y) : 999
    }).toBeLessThan(2)
  }
}

/** The page as a browser reports it when its tab is not the one in front, or is again. */
const background = (page: Page, hidden: boolean) =>
  page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') })
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)

/**
 * Every page has the same round, as the room keeps it: the same number, the same scores. (The host's own runs ahead
 * by what happened since it last wrote it down, every two seconds.)
 */
async function sameRound(pages: Page[]): Promise<{ n: number; scores: Record<string, number> }> {
  let last = { n: 0, scores: {} }
  const kept = (page: Page) =>
    page.evaluate(() => {
      const r = (window as unknown as { p3p2: { room: { retained(ch: string): { n: number; scores: object } | undefined } } }).p3p2.room.retained('round')
      return JSON.stringify(r ? { n: r.n, scores: r.scores } : null)
    })
  await expect
    .poll(async () => {
      const all = await Promise.all(pages.map(kept))
      last = JSON.parse(all[0]!) ?? last
      return all[0] !== 'null' && new Set(all).size === 1
    })
    .toBe(true)
  return last
}

test('an ordinary visit asks no server anything, and loads only the game; alone, the bots come for you', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const scripts: string[] = []
  const elsewhere: string[] = []
  page.on('request', (r) => {
    if (r.resourceType() === 'script') scripts.push(new URL(r.url()).pathname)
    if (!r.url().startsWith(GAME)) elsewhere.push(r.url())
  })
  await page.goto(ARENA)
  await expect(page.locator('#state')).toContainText('Playing alone')
  const start = await arena(page, (a) => a.seen.b1!)
  await expect.poll(async () => (await arena(page, (a) => a.seen.b1!))[1]).toBeGreaterThan(start[1] + 20)
  expect(scripts.filter((s) => /p3p2-(core|panel|qr|local)/.test(s))).toEqual([])
  expect(scripts.every((s) => s.startsWith('/arena/assets/'))).toBe(true)
  expect(elsewhere).toEqual([])
  await context.close()
})

test('the host runs the bots and the ball: each player is told only what it can see, a guest\'s kick reaches the host, and a bot that catches two tells both in one message', async ({ browser, server }) => {
  const { owner, pages } = await crew(browser, server, 'Bots', ['Ada', 'Grace', 'Edsger'])
  const [ada, grace, edsger] = pages as [Page, Page, Page]
  // Ada stands in the middle, Grace in a corner, Edsger in the opposite one.
  await place(ada, 600, 400, [grace, edsger], 'Ada')
  await place(grace, 60, 60, [ada], 'Grace')
  await place(edsger, 1140, 740, [ada], 'Edsger')

  // What each guest is shown is what is near it on the host, and nothing else.
  const near = async (page: Page, at: Point) => {
    const all = await arena(ada, (a) => a.seen)
    const mine = await arena(page, (a) => a.got.things)
    const far = (key: string) => Math.hypot(all[key]![0] - at[0], all[key]![1] - at[1])
    return mine.every((key) => far(key) < 360 + 40) && Object.keys(all).every((key) => far(key) < 360 - 40 || far(key) > 360 + 40 ? mine.includes(key) === far(key) < 360 : true)
  }
  await expect.poll(() => near(grace, [60, 60])).toBe(true)
  await expect.poll(() => near(edsger, [1140, 740])).toBe(true)
  await expect.poll(() => arena(ada, (a) => Object.keys(a.told).sort())).toEqual(['Edsger', 'Grace'])

  // Grace walks up to the ball and kicks it: the host moves it.
  const ball = (await arena(ada, (a) => a.seen.ball))!
  await place(grace, ball[0] - 20, ball[1], [ada], 'Grace')
  await arena(grace, (a) => a.kick())
  await expect.poll(async () => (await arena(ada, (a) => a.seen.ball))![0]).toBeGreaterThan(ball[0] + 30)

  // Grace and Edsger stand together beside a bot: it catches both, and tells both in one message.
  await ada.evaluate(() => {
    const w = window as unknown as { sent: unknown[]; p3p2: { room: { send(ch: string, d: unknown, o?: { to?: unknown }): boolean } } }
    const room = w.p3p2.room
    const send = room.send.bind(room)
    w.sent = []
    room.send = (ch, d, o) => {
      if (ch === 'caught') w.sent.push(o?.to)
      return send(ch, d, o)
    }
  })
  await place(ada, 1100, 60, [], 'Ada')
  const bot = (await arena(ada, (a) => a.seen.b3))!
  const spot = [Math.max(80, Math.min(1120, bot[0])), Math.max(80, Math.min(720, bot[1] + 60))] as const
  await Promise.all([arena(grace, (a, s) => a.goTo(s[0]!, s[1]!), spot), arena(edsger, (a, s) => a.goTo(s[0]!, s[1]!), spot)])
  await expect.poll(() => ada.evaluate(() => (window as unknown as { sent: number[][] }).sent.some((to) => Array.isArray(to) && to.length === 2)), { timeout: 15_000 }).toBe(true)
  for (const page of [grace, edsger]) await expect.poll(() => arena(page, (a) => a.caught)).toBeGreaterThan(0)
  await sameRound(pages)
  await close(pages, owner)
})

test('a guest whose page is in the background is nobody\'s target; a host whose page freezes, or goes to the background, hands the bots on within seconds', { tag: '@alone' }, async ({ browser, server }) => {
  const { owner, pages } = await crew(browser, server, 'Away', ['Ada', 'Grace', 'Edsger'])
  const [ada, grace, edsger] = pages as [Page, Page, Page]
  // Grace stands alone in the middle; the others far off in two corners.
  await place(grace, 600, 400, [ada], 'Grace')
  await place(ada, 1180, 20, [], 'Ada')
  await place(edsger, 20, 780, [ada], 'Edsger')
  await expect.poll(async () => Object.values(await arena(ada, (a) => a.targets)).filter((n) => n === 'Grace').length).toBeGreaterThan(0)

  // Her page goes to the background: everybody is told, and no bot goes for her. Back in front, she is prey again.
  await background(grace, true)
  await expect(edsger.locator('#who')).toContainText('Grace: in the background')
  await expect.poll(async () => Object.values(await arena(ada, (a) => a.targets))).not.toContain('Grace')
  await background(grace, false)
  await expect.poll(async () => Object.values(await arena(ada, (a) => a.targets))).toContain('Grace')

  // Ada's page stops for six seconds, connected and in front. Within five Grace runs the bots, from where she saw them.
  const round = await sameRound(pages)
  const stopped = Date.now()
  const frozen = ada.evaluate(() => {
    const end = Date.now() + 6000
    while (Date.now() < end) {
      // nothing, as a page stuck in a long task does nothing
    }
  })
  await expect.poll(() => arena(grace, (a) => a.host), { timeout: 10_000 }).toBe(true)
  expect(Date.now() - stopped).toBeLessThan(5500)
  await expect(edsger.locator('#who')).toContainText('Ada: not heard from')
  expect((await arena(grace, (a) => a.round.n))).toBe(round.n)
  await frozen
  await expect.poll(() => arena(ada, (a) => a.host)).toBe(false)

  // Grace's page goes to the background: Ada, in front, takes the bots back.
  await background(grace, true)
  await expect.poll(() => arena(ada, (a) => a.host), { timeout: 10_000 }).toBe(true)
  await expect.poll(() => arena(edsger, (a) => Object.keys(a.seen).length)).toBeGreaterThan(0)
  await close(pages, owner)
})

test('the host closes its page mid-round: the next player carries the round on, with its scores, and the bots from where they were', async ({ browser, server }) => {
  const { owner, pages } = await crew(browser, server, 'Handover', ['Ada', 'Grace', 'Edsger'])
  const [ada, grace, edsger] = pages as [Page, Page, Page]
  // Somebody is caught, so the scores say something.
  const bot = (await arena(ada, (a) => a.seen.b2))!
  await place(edsger, bot[0], Math.min(760, bot[1] + 40), [ada], 'Edsger')
  await expect.poll(() => arena(edsger, (a) => a.caught), { timeout: 15_000 }).toBeGreaterThan(0)
  // The round is written down every two seconds: wait for one with the catch in it.
  await expect.poll(async () => Object.values((await grace.evaluate(() => (window as unknown as { p3p2: { room: { retained(ch: string): { scores: Record<string, number> } } } }).p3p2.room.retained('round').scores))).length).toBeGreaterThan(0)
  const round = await sameRound(pages)

  await ada.context().close()
  await expect.poll(() => arena(grace, (a) => a.host), { timeout: 15_000 }).toBe(true)
  const carried = await sameRound([grace, edsger])
  expect(carried.n).toBe(round.n)
  // The bots go on catching meanwhile: no score goes back.
  for (const [pid, n] of Object.entries(round.scores)) expect(carried.scores[pid] ?? 0).toBeGreaterThanOrEqual(n)
  // The bots carry on from where they were, not from where bots start: in a row along the top.
  const now = await arena(grace, (a) => a.seen)
  for (let id = 1; id <= 5; id++) expect(Math.hypot(now[`b${id}`]![0] - id * 200, now[`b${id}`]![1] - 40)).toBeGreaterThan(1)
  await close([grace, edsger], owner)
})

test('somebody drops into a running round and starts from it; somebody leaves it, and it goes on', async ({ browser, server }) => {
  const { owner, invite, pages } = await crew(browser, server, 'Drop in', ['Ada', 'Grace'])
  const [ada, grace] = pages as [Page, Page]
  const round = await sameRound(pages)
  const late = await guest(browser, invite, 'Edsger')
  expect((await arena(late, (a) => a.round)).n).toBe(round.n)
  await expect.poll(async () => Object.keys(await arena(late, (a) => a.others())).sort()).toEqual(['Ada', 'Grace'])
  await expect.poll(async () => (await arena(late, (a) => a.got.things)).length + (await arena(ada, (a) => Object.keys(a.told).length))).toBeGreaterThan(0)
  // Grace leaves through the panel: the others see one fewer, and the bots stop counting her.
  await grace.getByRole('button', { name: 'Multiplayer' }).click()
  await grace.getByRole('button', { name: 'Leave' }).click()
  await expect(ada.locator('#state')).toContainText('2 here')
  await expect.poll(async () => Object.keys(await arena(late, (a) => a.others()))).toEqual(['Ada'])
  await expect.poll(async () => Object.values(await arena(ada, (a) => a.targets))).not.toContain('Grace')
  await sameRound([ada, late])
  await close([...pages, late], owner)
})

test('a reload, of a guest and of the host, comes back to the same round, in the same place', async ({ browser, server }) => {
  const { owner, pages } = await crew(browser, server, 'Reload', ['Ada', 'Grace'])
  const [ada, grace] = pages as [Page, Page]
  await place(grace, 300, 500, [ada], 'Grace')
  const round = await sameRound(pages)
  await grace.reload()
  await inRoom(grace)
  expect(await arena(grace, (a) => a.me)).toEqual({ x: 300, y: 500 })
  await place(ada, 900, 200, [grace], 'Ada')
  await ada.reload()
  await inRoom(ada)
  expect(await arena(ada, (a) => a.me)).toEqual({ x: 900, y: 200 })
  // The role went to Grace while Ada's page was gone; the round is the same.
  await expect.poll(() => arena(grace, (a) => a.host)).toBe(true)
  expect((await sameRound(pages)).n).toBe(round.n)
  await expect.poll(async () => (await drawn(grace, 'Ada')) ?? [0, 0]).toEqual([900, 200])
  await close(pages, owner)
})

test('two players whose server is far away, and drops them: they come back to the same round and see each other', async ({ browser, server }) => {
  const proxy = await startLagProxy({ listen: 0, host: HOST, to: { host: '127.0.0.1', port: server.port }, latency: 150, jitter: 50 })
  try {
    const owner = await createRoom(browser, server, 'Far arena', ARENA)
    const ada = await visit(browser)
    const invite = await host(ada, through(owner.invite, server, serverAt(server.url, proxy.port)), 'Ada')
    await ada.locator('p3p2-panel').getByRole('button', { name: 'Close' }).click()
    const grace = await guest(browser, invite, 'Grace')
    await place(grace, 400, 300, [ada], 'Grace')
    const round = await sameRound([ada, grace])
    expect(proxy.drop()).toBeGreaterThanOrEqual(2)
    await place(grace, 500, 350, [ada], 'Grace')
    expect((await sameRound([ada, grace])).n).toBe(round.n)
    await expect.poll(() => arena(grace, (a) => a.got.things.length), { timeout: 15_000 }).toBeGreaterThan(0)
    await close([ada, grace], owner)
  } finally {
    await proxy.close()
  }
})

test('Chrome, Firefox and WebKit in one arena: the same round, each other where they are, and the same bots', async ({ browser, server }) => {
  test.setTimeout(90_000)
  const engines = await otherEngines()
  const owner = await createRoom(browser, server, 'Three engines', ARENA)
  const ada = await visit(browser)
  const invite = await host(ada, owner.invite, 'Ada')
  await ada.locator('p3p2-panel').getByRole('button', { name: 'Close' }).click()
  const pages = [ada]
  for (const { name, browser: other } of engines) pages.push(await guest(other, invite, name))
  // Everybody in the middle, where they all see the same bots.
  const names = ['Ada', ...engines.map((e) => e.name)]
  for (const [i, page] of pages.entries()) await place(page, 560 + i * 40, 400, pages.filter((p) => p !== page), names[i]!)
  await sameRound(pages)
  for (const page of pages.slice(1)) {
    await expect
      .poll(async () => {
        const [mine, host] = [await arena(page, (a) => a.seen), await arena(ada, (a) => a.seen)]
        // What a guest draws is a little behind the host: a bot moves 120 units a second.
        return Object.keys(mine).length > 0 && Object.keys(mine).every((k) => Math.hypot(mine[k]![0] - host[k]![0], mine[k]![1] - host[k]![1]) < 60)
      })
      .toBe(true)
  }
  await close(pages, owner)
})

test('another build of the game is turned away, until the owner lets players on other versions in', async ({ browser, server }) => {
  const { owner, invite, pages } = await crew(browser, server, 'Versions', ['Ada'])
  const next = await visit(browser, invite.replace(ARENA, NEXT))
  await next.getByLabel('Your name').fill('Grace')
  const join = next.getByRole('button', { name: 'Join', exact: true })
  await join.click()
  await expect(next.locator('p3p2-panel').getByRole('status')).toContainText('different version of the game')
  await owner.portal.reload()
  await owner.portal.getByLabel('Players on different versions of the game').selectOption('off')
  await owner.portal.getByRole('button', { name: 'Save', exact: true }).click()
  await join.click()
  await inRoom(next)
  await expect(pages[0]!.locator('#state')).toContainText('2 here')
  await close([...pages, next], owner)
})

for (const latency of [0, 150]) {
  test(`a figure moving at an even speed is drawn going steadily, never back${latency ? `, through ${latency} ms each way` : ''}`, { tag: '@alone' }, async ({ browser, server }) => {
    const proxy = latency ? await startLagProxy({ listen: 0, host: HOST, to: { host: '127.0.0.1', port: server.port }, latency, jitter: latency / 3 }) : null
    try {
      const owner = await createRoom(browser, server, 'Steady', ARENA)
      const ada = await visit(browser)
      const invite = await host(ada, proxy ? through(owner.invite, server, serverAt(server.url, proxy.port)) : owner.invite, 'Ada')
      await ada.locator('p3p2-panel').getByRole('button', { name: 'Close' }).click()
      const grace = await guest(browser, invite, 'Grace')
      await place(ada, 40, 400, [grace], 'Ada')
      // Ada walks right at full speed, and Grace watches for three seconds.
      await arena(ada, (a) => a.push(1, 0))
      await ada.waitForTimeout(500)
      const frames = await arena(grace, (a) => a.track('Ada', 3000))
      await arena(ada, (a) => a.push(0, 0))
      const moving = frames.filter(([, x]) => x > 60 && x < 1160)
      expect(moving.length).toBeGreaterThan(100)
      // Never back, and steady: how far each frame's x is from a straight line through them all.
      const back = Math.min(...moving.slice(1).map(([, x], i) => x - moving[i]![1]))
      const n = moving.length
      const [mt, mx] = [moving.reduce((s, [t]) => s + t, 0) / n, moving.reduce((s, [, x]) => s + x, 0) / n]
      const slope = moving.reduce((s, [t, x]) => s + (t - mt) * (x - mx), 0) / moving.reduce((s, [t]) => s + (t - mt) ** 2, 0)
      const rms = Math.sqrt(moving.reduce((s, [t, x]) => s + (x - (mx + slope * (t - mt))) ** 2, 0) / n)
      test.info().annotations.push({ type: 'steady', description: JSON.stringify({ latency, frames: n, speed: Math.round(slope * 1000), rms: Math.round(rms * 10) / 10, back: Math.round(back * 10) / 10 }) })
      expect(back).toBeGreaterThan(-0.5)
      expect(slope * 1000).toBeGreaterThan(200)
      // 240 units a second; a unit is a pixel and a half on a phone. A few units off a straight line at most.
      expect(rms).toBeLessThan(latency ? 8 : 4)
      await close([ada, grace], owner)
    } finally {
      await proxy?.close()
    }
  })
}

// ---- phones, and many players ----

/** The page's own thumb stick, under a real finger, and where it moved the figure. */
async function thumb(page: Page, dx: number, dy: number, ms: number): Promise<void> {
  const box = (await page.locator('#field').boundingBox())!
  const touch = await fingers(page)
  const [x, y] = [box.x + box.width * 0.2, box.y + box.height * 0.6]
  await touch.down(1, x, y)
  await touch.move(1, x + dx / 2, y + dy / 2)
  await touch.move(1, x + dx, y + dy)
  await page.waitForTimeout(ms)
  await touch.up(1)
}

for (const landscape of [false, true]) {
  test(`on a phone ${landscape ? 'on its side' : 'held upright'}: the thumb stick walks, quick touches are the page's, and the panel's button still answers in the other corner`, async ({ browser, server }) => {
    const { owner, invite, pages } = await crew(browser, server, 'Pocket arena', ['Ada'])
    const phone = await (await phoneContext(browser, landscape)).newPage()
    await phone.goto(invite)
    await phone.getByLabel('Your name').fill('Grace')
    await phone.getByRole('button', { name: 'Join', exact: true }).tap()
    await inRoom(phone)
    const screen = phone.viewportSize()!
    // The panel's button is in the bottom right corner, clear of the stick.
    const button = (await phone.getByRole('button', { name: 'Multiplayer' }).boundingBox())!
    expect(button.x).toBeGreaterThan(screen.width / 2)
    expect(button.y).toBeGreaterThan(screen.height / 2)

    const from = await arena(phone, (a) => a.me)
    await thumb(phone, 60, 0, 800)
    const to = await arena(phone, (a) => a.me)
    expect(to.x - from.x).toBeGreaterThan(50)
    await expect.poll(async () => (await drawn(pages[0]!, 'Grace'))?.[0] ?? 0).toBeGreaterThan(from.x + 40)

    // The page cancels quick touches for itself. The panel's button still opens it, and the panel fits.
    expect(await phone.evaluate(() => {
      const e = new TouchEvent('touchend', { cancelable: true, bubbles: true })
      document.body.dispatchEvent(e)
      return e.defaultPrevented
    })).toBe(true)
    await phone.getByRole('button', { name: 'Multiplayer' }).tap()
    const card = (await phone.locator('p3p2-panel .card').boundingBox())!
    expect(card.x).toBeGreaterThanOrEqual(0)
    expect(card.x + card.width).toBeLessThanOrEqual(screen.width)
    expect(card.y).toBeGreaterThanOrEqual(0)
    expect(card.y + card.height).toBeLessThanOrEqual(screen.height)
    await phone.locator('p3p2-panel').getByRole('button', { name: 'Close' }).tap()
    await expect(phone.locator('p3p2-panel .card')).toBeHidden()
    await close([...pages, phone], owner)
  })
}

test('eight players from one address join at the same moment, and a phone that dropped comes back while they do', async ({ browser, server }) => {
  test.setTimeout(60_000)
  const { owner, invite, pages } = await crew(browser, server, 'Eight', ['Ada'])
  // Grace, on a phone whose connection the test can cut.
  const phone = await (await phoneContext(browser)).newPage()
  const sockets: WebSocketRoute[] = []
  await phone.routeWebSocket(/\/api\/v1\/ws$/, (ws) => {
    ws.connectToServer()
    sockets.push(ws)
  })
  await phone.goto(invite)
  await phone.getByLabel('Your name').fill('Grace')
  await phone.getByRole('button', { name: 'Join', exact: true }).tap()
  await inRoom(phone)
  const id = () => phone.evaluate(() => (window as unknown as { p3p2: { room: { self: { id: number } } } }).p3p2.room.self.id)
  const before = await id()

  // Six more open the link, and all say yes at once, while Grace's connection drops.
  const names = ['Edsger', 'Barbara', 'Alan', 'Frances', 'Donald', 'Radia']
  const late = await Promise.all(names.map(async (name) => {
    const page = await visit(browser, invite)
    await page.getByLabel('Your name').fill(name)
    await expect(page.getByRole('button', { name: 'Join', exact: true })).toBeEnabled()
    return page
  }))
  await sockets[0]!.close()
  await Promise.all(late.map((page) => page.getByRole('button', { name: 'Join', exact: true }).click()))
  for (const page of late) await inRoom(page)
  await expect.poll(() => phone.evaluate(() => (window as unknown as { p3p2: { room: { status: string } } }).p3p2.room.status), { timeout: 15_000 }).toBe('open')
  expect(await id()).toBe(before)
  const all = [...pages, phone, ...late]
  for (const page of all) await expect(page.locator('#state')).toContainText('8 here')
  await sameRound(all)
  await close(all, owner)
})

test('what a round with three players costs the server', { tag: '@measure' }, async ({ browser, server }) => {
  const { owner, pages } = await crew(browser, server, 'Counted arena', ['Ada', 'Grace', 'Edsger'])
  // Everybody walks about, which is as busy as presence gets, while the host runs the bots and reports.
  const traffic = await measure(server, 'arena', pages.length, async () => {
    await Promise.all(pages.map(async (page, n) => {
      for (let t = 0; t < 20; t++) {
        await arena(page, (a, [t, n]) => a.push(Math.cos(t! + n!), Math.sin(t! + n!)), [t, n])
        await page.waitForTimeout(500)
      }
      await arena(page, (a) => a.push(0, 0))
    }))
  })
  test.info().annotations.push({ type: 'traffic', description: JSON.stringify(traffic) })
  expect(traffic.rateDropped).toBe(0)
  expect(traffic.volatileDropped).toBe(0)
  expect(traffic.perPlayer.frames).toBeLessThan(45)
  await close(pages, owner)
})
