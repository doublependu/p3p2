// The rally example (examples/rally/): a ball whose flight is a start on the room's clock, decided by the page of
// the player it is heading to; and a menu of the game's own (`ui: false`) that does what the panel does through
// the API, says every refusal in its own words, and why a room closed. Built by Vite with the client under test.

import type { Browser, BrowserContext, Page } from '@playwright/test'
import { GAME, HOST, PROXY, serverAt } from '../playwright.config.ts'
import { startLagProxy } from '../tools/lag-proxy.ts'
import { expect, type TestServer, test } from './fixtures.ts'
import { closeEngines, createRoom, measure, otherEngines, phoneContext } from './helpers.ts'

const RALLY = `${GAME}/rally/`

test.skip(PROXY, 'Caddy serves the examples as they are, and this one is built by Vite')
test.afterAll(closeEngines)

interface Flight {
  id: number
  t0: number
  to: number
  score: number[]
}

interface Rally {
  inRoom: boolean
  side: number
  sides: (string | null)[]
  flight: Flight | null
  ball: [number, number] | null
  score: number[]
  paddle: number
  theirs: number | null
  delays: number[]
  jumps: number[]
  offset: number
  setPaddle(y: number): void
  follow(on?: boolean): void
  play(): Promise<void>
}

function rally<T, A = undefined>(page: Page, read: (r: Rally, arg: A) => T, arg?: A): Promise<Awaited<T>> {
  return page.evaluate(
    ({ source, arg }) => new Function('r', 'arg', `return (${source})(r, arg)`)((window as unknown as { example: Rally }).example, arg),
    { source: read.toString(), arg },
  ) as Promise<Awaited<T>>
}

async function visit(where: Browser | BrowserContext, url: string = RALLY): Promise<Page> {
  const page = 'newContext' in where ? await (await where.newContext()).newPage() : await where.newPage()
  await page.goto(url)
  await page.waitForFunction(() => (window as unknown as { example?: Rally }).example)
  return page
}

const inRoom = (page: Page) => expect.poll(() => rally(page, (r) => r.inRoom)).toBe(true)
const problem = (page: Page) => page.locator('#problem')

/** Hosts from the game's own menu, and returns the invite it shows. */
async function open(page: Page, roomUrl: string, name: string): Promise<string> {
  await page.getByLabel('Your name').fill(name)
  await page.getByLabel('Room URL').fill(roomUrl)
  await page.getByRole('button', { name: 'Host a game' }).click()
  await inRoom(page)
  return page.getByLabel('Invite', { exact: true }).inputValue()
}

/** Opens an invite, waits for the menu's "Join?", and says yes. */
async function guest(where: Browser | BrowserContext, invite: string, name: string): Promise<Page> {
  const page = await visit(where, invite)
  await expect(page.locator('#ask')).toContainText('Join')
  await page.getByLabel('Your name').fill(name)
  await page.getByRole('button', { name: 'Join', exact: true }).click()
  await inRoom(page)
  return page
}

/** Two players who have pressed Play, and a ball in flight. */
async function duel(browser: Browser, server: TestServer, name: string, through?: string) {
  const owner = await createRoom(browser, server, name, RALLY)
  const ada = await visit(browser)
  const invite = await open(ada, through ? owner.roomUrl.replace(server.url, through) : owner.roomUrl, 'Ada')
  const grace = await guest(browser, invite, 'Grace')
  await ada.getByRole('button', { name: 'Play' }).click()
  await grace.getByRole('button', { name: 'Play' }).click()
  await expect.poll(() => rally(ada, (r) => r.flight !== null)).toBe(true)
  return { owner, invite, ada, grace }
}

const close = async (pages: Page[], owner?: { close(): Promise<void> }) => {
  for (const page of pages) await page.context().close()
  await owner?.close()
}

/** Where every page draws the ball at about the same moment: the same, to within what the ball moves in a frame or two. */
async function sameBall(pages: Page[]): Promise<boolean> {
  const balls = await Promise.all(pages.map((p) => rally(p, (r) => [r.ball, Date.now()] as const)))
  return balls.every(([b, t]) => {
    const [a, ta] = balls[0]!
    return b && a && Math.abs(t - ta) < 40 && Math.hypot(b[0] - a[0], b[1] - a[1]) < 40
  })
}

/** Has every page seen this many flights go by: the ball has been returned or missed so often. */
const flights = (page: Page) => rally(page, (r) => r.flight?.id ?? 0)

test('an ordinary visit asks no server anything and loads only the game; alone, the computer plays the other side', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const scripts: string[] = []
  const elsewhere: string[] = []
  page.on('request', (r) => {
    if (r.resourceType() === 'script') scripts.push(new URL(r.url()).pathname)
    if (!r.url().startsWith(GAME)) elsewhere.push(r.url())
  })
  await page.goto(RALLY)
  await expect(page.locator('#state')).toContainText('Playing alone')
  await rally(page, (r) => r.follow())
  await expect.poll(() => flights(page), { timeout: 10_000 }).toBeGreaterThan(2)
  expect(scripts.filter((s) => /p3p2-(core|panel|qr|local)/.test(s))).toEqual([])
  expect(scripts.every((s) => s.startsWith('/rally/assets/'))).toBe(true)
  expect(elsewhere).toEqual([])
  await context.close()
})

test('its own menu: hosting, an invite, "Join?" from a lookup, the players with their ping, two sides and a watcher, one ball, a point; and never the panel', async ({ browser, server }) => {
  const scripts: string[] = []
  const watch = (page: Page) => page.on('request', (r) => r.resourceType() === 'script' && scripts.push(new URL(r.url()).pathname))
  const owner = await createRoom(browser, server, 'Rally room', RALLY)
  const ada = await (await browser.newContext()).newPage()
  watch(ada)
  await ada.goto(RALLY)
  const invite = await open(ada, owner.roomUrl, 'Ada')
  expect(invite).toMatch(/\?room=/)
  await ada.getByRole('button', { name: 'Copy' }).click()

  // The invite's "Join?", in the game's words, from what the lookup says: before anything is joined.
  const grace = await (await browser.newContext()).newPage()
  watch(grace)
  await grace.goto(invite)
  await expect(grace.locator('#ask')).toHaveText('Join "Rally room", hosted by Ada, 1 of 16 players?')
  await grace.getByLabel('Your name').fill('Grace')
  await grace.getByRole('button', { name: 'Join', exact: true }).click()
  await inRoom(grace)
  // Each player, with their round trip to the server once it is measured.
  await expect(ada.locator('#members li')).toHaveText([/^Ada \(you\), watching · \d+ ms/, /^Grace, watching · \d+ ms/], { timeout: 15_000 })

  // The first two to press Play have the sides; a third, later, watches.
  await ada.getByRole('button', { name: 'Play' }).click()
  await grace.getByRole('button', { name: 'Play' }).click()
  const edsger = await guest(browser, invite, 'Edsger')
  watch(edsger)
  await expect(edsger.getByRole('button', { name: 'Play' })).toBeHidden()
  await expect(edsger.locator('#state')).toHaveText('Watching.')
  expect([await rally(ada, (r) => r.side), await rally(grace, (r) => r.side)]).toEqual([0, 1])

  // Both keep their paddles under the ball: a rally, and the same ball on every page.
  for (const page of [ada, grace]) await rally(page, (r) => r.follow())
  await expect.poll(() => flights(edsger), { timeout: 15_000 }).toBeGreaterThan(4)
  await expect.poll(() => sameBall([ada, grace, edsger])).toBe(true)
  // Grace stops, and moves away from the ball: Ada's point, on every page.
  await rally(grace, (r) => {
    r.follow(false)
    r.setPaddle((r.ball![1] + 250) % 500)
  })
  for (const page of [ada, grace, edsger]) await expect.poll(() => rally(page, (r) => r.score), { timeout: 15_000 }).toEqual([1, 0])
  // With `ui: false`, the panel and its QR code never came.
  expect(scripts.filter((s) => /p3p2-(panel|qr)/.test(s))).toEqual([])
  await expect(ada.locator('p3p2-panel')).toHaveCount(0)
  await close([ada, grace, edsger], owner)
})

for (const latency of [0, 150]) {
  test(`what the other player sees of a hit, ${latency} ms each way to the server`, { tag: '@alone' }, async ({ browser, server }) => {
    test.setTimeout(60_000)
    const proxy = latency ? await startLagProxy({ listen: 0, host: HOST, to: { host: '127.0.0.1', port: server.port }, latency, jitter: latency / 5 }) : null
    try {
      const { owner, ada, grace } = await duel(browser, server, `Hits ${latency}`, proxy ? serverAt(server.url, proxy.port) : undefined)
      for (const page of [ada, grace]) await rally(page, (r) => r.follow())
      await ada.waitForTimeout(15_000)
      const seen = [...(await rally(ada, (r) => r.delays)), ...(await rally(grace, (r) => r.delays))]
      const jumps = [...(await rally(ada, (r) => r.jumps)), ...(await rally(grace, (r) => r.jumps))]
      const offsets = [await rally(ada, (r) => r.offset), await rally(grace, (r) => r.offset)]
      const median = (list: number[]) => [...list].sort((a, b) => a - b)[list.length >> 1] ?? 0
      const result = {
        latency,
        hits: seen.length,
        delay: { median: median(seen), max: Math.max(...seen) },
        jump: { median: median(jumps), max: Math.max(...jumps) },
        clocks: Math.round(Math.abs(offsets[0]! - offsets[1]!) * 10) / 10,
        score: await rally(ada, (r) => r.score),
      }
      test.info().annotations.push({ type: 'hits', description: JSON.stringify(result) })
      expect(result.hits).toBeGreaterThan(5)
      // Both keep their paddles under the ball: whatever the delay, nobody loses a point to it.
      expect(result.score).toEqual([0, 0])
      // The two pages read the room's clock alike: to a few ms, or to within the jitter of the way there and back.
      expect(result.clocks).toBeLessThan(latency ? latency / 5 + 5 : 5)
      await close([ada, grace], owner)
    } finally {
      await proxy?.close()
    }
  })
}

test('a player who reloads is back on the same side, and the rally goes on', async ({ browser, server }) => {
  const { owner, ada, grace } = await duel(browser, server, 'Reload rally')
  for (const page of [ada, grace]) await rally(page, (r) => r.follow())
  await grace.reload()
  await inRoom(grace)
  expect(await rally(grace, (r) => r.side)).toBe(1)
  await rally(grace, (r) => r.follow())
  const at = await flights(ada)
  await expect.poll(() => flights(ada), { timeout: 15_000 }).toBeGreaterThan(at + 3)
  await expect.poll(() => sameBall([ada, grace])).toBe(true)
  await close([ada, grace], owner)
})

test('leaving, being removed, and the end: each player is told why the room closed, in the game\'s words', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Closing', RALLY)
  const ada = await visit(browser)
  const invite = await open(ada, owner.roomUrl, 'Ada')
  const [grace, edsger, barbara] = [await guest(browser, invite, 'Grace'), await guest(browser, invite, 'Edsger'), await guest(browser, invite, 'Barbara')]
  await grace.getByRole('button', { name: 'Leave' }).click()
  await expect(problem(grace)).toHaveText('You left the game.')
  await expect(edsger.getByRole('button', { name: /^Remove/ })).toHaveCount(0)
  await ada.getByRole('button', { name: 'Remove Edsger' }).click()
  await expect(problem(edsger)).toHaveText('The host took you out of the game.')
  await ada.getByRole('button', { name: 'End for everyone' }).click()
  await expect(problem(barbara)).toHaveText('The host ended the game for everybody.')
  await expect(problem(ada)).toHaveText('The host ended the game for everybody.')
  for (const page of [grace, edsger, barbara]) await expect(page.locator('#state')).toContainText('Playing alone')
  await close([ada, grace, edsger, barbara], owner)
})

test('refusals in the game\'s own words: a server that is not running, and an https page with a server on plain http', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Refusals', RALLY)
  const key = owner.roomUrl.split('/room/')[1]
  const ada = await visit(browser)
  await ada.getByLabel('Room URL').fill(`http://${HOST}:18999/room/${key}`)
  await ada.getByRole('button', { name: 'Host a game' }).click()
  await expect(problem(ada)).toHaveText('No answer from that server. Is it running, and is the address right?')

  // The same game, as an https site would serve it, with a room URL of a server on plain http by its name. The
  // client knows before it asks anything.
  const context = await browser.newContext()
  await context.route('https://rally.test/**', async (r) => {
    const response = await r.fetch({ url: `${GAME}${new URL(r.request().url()).pathname}` })
    await r.fulfill({ response })
  })
  const secure = await visit(context, 'https://rally.test/rally/')
  const asked: string[] = []
  secure.on('request', (r) => r.url().includes('/api/') && asked.push(r.url()))
  await secure.getByLabel('Room URL').fill(`http://p3p2.test:${server.port}/room/${key}`)
  await secure.getByRole('button', { name: 'Host a game' }).click()
  await expect(problem(secure)).toHaveText('This game is on https, and that server is on plain http: the browser will not let the two talk.')
  expect(asked).toEqual([])
  await close([ada, secure], owner)
})

test('too many lookups at once from one address: the next is refused, in the game\'s words', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Busy', RALLY)
  const ada = await visit(browser)
  const invite = await open(ada, owner.roomUrl, 'Ada')
  const code = new URL(invite).searchParams.get('room')!.split('/').at(-1)
  const lookup = () =>
    fetch(`${server.url}/api/v1/invite`, { headers: { authorization: `Bearer ${code}`, origin: GAME } }).then(
      (r) => r.status,
      () => 0,
    )
  // Forty lookups of the invite at once from this machine's address, as the game's page makes them, and the page's
  // own on top: the test holds it back until the forty are answered.
  let answers: number[] = []
  const grace = await (await browser.newContext()).newPage()
  await grace.route('**/api/v1/invite', async (r) => {
    if (r.request().method() === 'GET') answers = await Promise.all(Array.from({ length: 40 }, lookup))
    await r.continue()
  })
  await grace.goto(invite)
  await expect(problem(grace)).toHaveText('Too many tries from here just now. Wait a little, and try again.')
  expect(answers.filter((s) => s === 200).length).toBeGreaterThan(30)
  await close([ada, grace], owner)
})

test('a server that does not speak the game\'s protocol is refused, in the game\'s words', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Old server', RALLY)
  const ada = await visit(browser)
  const invite = await open(ada, owner.roomUrl, 'Ada')
  // Grace's hello is rewritten on its way to ask for a protocol the server does not take, and the server's own
  // answer comes back.
  const grace = await (await browser.newContext()).newPage()
  await grace.routeWebSocket(/\/api\/v1\/ws$/, (ws) => {
    const upstream = ws.connectToServer()
    ws.onMessage((m) => upstream.send(typeof m === 'string' && m.includes('"t":"hello"') ? m.replace('"proto":1', '"proto":99') : m))
    upstream.onMessage((m) => ws.send(m))
  })
  await grace.goto(invite)
  await expect(grace.locator('#ask')).toContainText('Join')
  await grace.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(problem(grace)).toHaveText('That server is too old for this game. Its owner has to update it.')
  await close([ada, grace], owner)
})

test('a browser that holds another player\'s id with the wrong key is refused, in the game\'s words', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Wrong key', RALLY)
  const ada = await visit(browser)
  const invite = await open(ada, owner.roomUrl, 'Ada')
  const pid = await ada.evaluate(() => (window as unknown as { p3p2: { room: { self: { pid: string } } } }).p3p2.room.self.pid)
  const context = await browser.newContext()
  await context.addInitScript(
    ([key, value]) => localStorage.setItem(key!, value!),
    [`p3p2:pid:${server.url}`, `${pid}.${'0'.repeat(32)}`],
  )
  const grace = await visit(context, invite)
  await expect(grace.locator('#ask')).toContainText('Join')
  await grace.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(problem(grace)).toHaveText("That server knows this browser's player by another key.")
  await close([ada, grace], owner)
})

test('through a server far away that drops: the menu shows each round trip, at least twice the way, and the rally comes back', async ({ browser, server }) => {
  const latency = 100
  const proxy = await startLagProxy({ listen: 0, host: HOST, to: { host: '127.0.0.1', port: server.port }, latency, jitter: 10 })
  try {
    const { owner, ada, grace } = await duel(browser, server, 'Far rally', serverAt(server.url, proxy.port))
    const ping = async (page: Page) => {
      const texts = await page.locator('#members li').allTextContents()
      return Math.min(...texts.map((t) => Number(/· (\d+) ms/.exec(t)?.[1] ?? 0)))
    }
    for (const page of [ada, grace]) await expect.poll(() => ping(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(2 * latency)
    for (const page of [ada, grace]) await rally(page, (r) => r.follow())
    expect(proxy.drop()).toBeGreaterThanOrEqual(2)
    const at = await flights(ada)
    await expect.poll(() => flights(grace), { timeout: 20_000 }).toBeGreaterThan(at + 3)
    expect([await rally(ada, (r) => r.side), await rally(grace, (r) => r.side)]).toEqual([0, 1])
    await expect.poll(() => sameBall([ada, grace])).toBe(true)
    await close([ada, grace], owner)
  } finally {
    await proxy.close()
  }
})

test('Chrome against Firefox and WebKit: the same ball', async ({ browser, server }) => {
  for (const { name, browser: other } of await otherEngines()) {
    const owner = await createRoom(browser, server, `Rally ${name}`, RALLY)
    const ada = await visit(browser)
    const invite = await open(ada, owner.roomUrl, 'Ada')
    const them = await guest(other, invite, name)
    await ada.getByRole('button', { name: 'Play' }).click()
    await them.getByRole('button', { name: 'Play' }).click()
    for (const page of [ada, them]) await rally(page, (r) => r.follow())
    await expect.poll(() => flights(ada), { timeout: 15_000 }).toBeGreaterThan(3)
    await expect.poll(() => sameBall([ada, them])).toBe(true)
    expect(await rally(ada, (r) => r.score)).toEqual([0, 0])
    await close([ada, them], owner)
  }
})

test('on a phone, a finger moves the paddle', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Pocket rally', RALLY)
  const ada = await visit(browser)
  const invite = await open(ada, owner.roomUrl, 'Ada')
  const phone = await guest(await phoneContext(browser, false), invite, 'Grace')
  await ada.getByRole('button', { name: 'Play' }).click()
  await phone.getByRole('button', { name: 'Play' }).tap()
  await expect.poll(() => rally(phone, (r) => r.side)).toBe(1)
  await phone.locator('#court').scrollIntoViewIfNeeded()
  const court = (await phone.locator('#court').boundingBox())!
  await phone.touchscreen.tap(court.x + court.width * 0.9, court.y + court.height * 0.2)
  await expect.poll(() => rally(phone, (r) => Math.round(r.paddle))).toBe(100)
  await expect.poll(async () => Math.round((await rally(ada, (r) => r.theirs)) ?? 0)).toBe(100)
  await close([ada, phone], owner)
})

test('what a rally costs the server', { tag: '@measure' }, async ({ browser, server }) => {
  const { owner, ada, grace } = await duel(browser, server, 'Counted rally')
  for (const page of [ada, grace]) await rally(page, (r) => r.follow())
  const traffic = await measure(server, 'rally', 2, () => ada.waitForTimeout(10_000))
  test.info().annotations.push({ type: 'traffic', description: JSON.stringify(traffic) })
  expect(traffic.rateDropped).toBe(0)
  expect(traffic.volatileDropped).toBe(0)
  expect(traffic.perPlayer.frames).toBeLessThan(30)
  await close([ada, grace], owner)
})
