// A game with one player in charge, on the room's log: the host moves a ball and knocks bricks out
// of a wall. The role passes on when the host goes, and the wall outlives everyone.

import type { Browser, Page } from '@playwright/test'
import { GAME, HOST, serverAt } from '../playwright.config.ts'
import { startLagProxy } from '../tools/lag-proxy.ts'
import { createRoom, host, join, player, type Server, through } from './helpers.ts'
import { expect, test } from './fixtures.ts'

// A log this small is full after a few dozen ops: the host's snapshots are what keep the wall.
test.use({ settings: { P3P2_MAX_LOG_BYTES: '16384' } })

// Four times the speed: a brick about every second.
const BALL = `${GAME}/host-ball/?speed=4`
/** The ball's speed at that, in the field's units a second. The field is 400 wide. */
const SPEED = 170 * 4

/** What the page shows of its game. */
interface Game {
  x: number
  y: number
  wall: number
  gone: number[]
  hits: number
  loaded: number
  seq: number
  host: boolean
  ticks: number
  drawn: [number, number]
  kick(x: number, y: number): void
}

type Look = Omit<Game, 'kick' | 'drawn'>

function look(page: Page): Promise<Look> {
  return page.evaluate(() => {
    const g = (window as unknown as { game: Game }).game
    return { x: g.x, y: g.y, wall: g.wall, gone: g.gone, hits: g.hits, loaded: g.loaded, seq: g.seq, host: g.host, ticks: g.ticks }
  })
}

/** Sends the ball up into the wall, again and again, until `hits` bricks have gone since the beginning. */
async function until(page: Page, hits: number): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.evaluate(() => (window as unknown as { game: Game }).game.kick(40 + Math.random() * 320, 0))
        return (await look(page)).hits
      },
      { timeout: 25_000, intervals: [400] },
    )
    .toBeGreaterThanOrEqual(hits)
}

/**
 * How far the ball goes on this page in a third of a second, in short steps: a straight line
 * from start to end comes out short when the ball bounces in between.
 */
async function travel(page: Page): Promise<number> {
  let a = await look(page)
  let path = 0
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(50)
    const b = await look(page)
    path += Math.hypot(b.x - a.x, b.y - a.y)
    a = b
  }
  return path
}

/** Where the page draws the ball at each frame for `ms`: [the moment, on a clock every page here shares, x, y]. */
function frames(page: Page, ms: number): Promise<[number, number, number][]> {
  return page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const out: [number, number, number][] = []
        const end = performance.now() + ms
        requestAnimationFrame(function frame(t) {
          const [x, y] = (window as unknown as { game: Game }).game.drawn
          out.push([performance.timeOrigin + t, x, y])
          if (t < end) requestAnimationFrame(frame)
          else resolve(out)
        })
      }),
    ms,
  )
}

/**
 * The frames whose step is more than a quarter longer or shorter than the ball's speed gives, of those where the ball
 * goes straight on: a frame that turns it off a wall or a brick, or the frame before, is shorter by rights.
 */
function uneven(rows: [number, number, number][]): { straight: number; uneven: number } {
  const steps = rows.slice(1).map(([t, x, y], i) => [x - rows[i]![1], y - rows[i]![2], (t - rows[i]![0]) / 1000] as const)
  const same = (a: (typeof steps)[number], b: (typeof steps)[number]) => {
    const la = Math.hypot(a[0], a[1])
    const lb = Math.hypot(b[0], b[1])
    return !la || !lb || (a[0] * b[0] + a[1] * b[1]) / (la * lb) > 0.999
  }
  let straight = 0
  let off = 0
  for (let i = 1; i < steps.length - 1; i++) {
    const [dx, dy, dt] = steps[i]!
    if (!same(steps[i - 1]!, steps[i]!) || !same(steps[i]!, steps[i + 1]!)) continue
    straight++
    const ratio = Math.hypot(dx, dy) / (SPEED * dt)
    if (ratio < 0.75 || ratio > 1.25) off++
  }
  return { straight, uneven: off }
}

/** How far the guest's ball is from the host's at the same moment, for each of the guest's frames. */
function gaps(host: [number, number, number][], guest: [number, number, number][]): number[] {
  const out: number[] = []
  let j = 1
  for (const [t, x, y] of guest) {
    while (j < host.length - 1 && host[j]![0] < t) j++
    const [ta, xa, ya] = host[j - 1]!
    const [tb, xb, yb] = host[j]!
    if (t < ta || t > tb) continue
    const u = (t - ta) / (tb - ta || 1)
    out.push(Math.hypot(x - (xa + (xb - xa) * u), y - (ya + (yb - ya) * u)))
  }
  return out.sort((a, b) => a - b)
}

/** Everyone ends up with the same wall, and at the same place in the log. */
async function agree(pages: Page[]): Promise<Look> {
  let last: Look | undefined
  await expect
    .poll(async () => {
      const all = await Promise.all(pages.map(look))
      last = all[0]
      return new Set(all.map((s) => JSON.stringify([s.seq, s.wall, s.hits, s.gone]))).size
    })
    .toBe(1)
  return last!
}

/** The page as a browser reports it when its tab is not the one in front, or is again. */
async function background(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') })
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)
}

/** Leaves through the panel: at once, where a closed page keeps its place for a while. */
async function leave(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Leave' })
  if (!(await button.isVisible())) await page.getByRole('button', { name: 'Multiplayer' }).click()
  await button.click()
  await expect(page.locator('#state')).toContainText('Playing alone')
}

async function trio(browser: Browser, server: Server, name: string) {
  const owner = await createRoom(browser, server, name, BALL)
  const ada = await player(browser, BALL)
  const invite = await host(ada.page, owner.invite, 'Ada')
  const grace = await join(browser, invite, 'Grace')
  const edsger = await join(browser, invite, 'Edsger')
  return { owner, invite, ada, grace, edsger }
}

test('alone, the same game plays in a room of one', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const scripts: string[] = []
  const calls: string[] = []
  page.on('request', (r) => {
    if (r.resourceType() === 'script') scripts.push(new URL(r.url()).pathname)
    else if (!r.url().startsWith(GAME)) calls.push(r.url())
  })
  await page.goto(BALL)
  await expect(page.locator('#state')).toContainText('Playing alone')
  expect((await look(page)).host).toBe(true)
  await until(page, 3)
  const s = await look(page)
  expect(s.gone.length).toBe(s.hits)
  expect(s.seq).toBe(s.hits)
  expect(scripts).toEqual(['/dist/p3p2.js', '/dist/p3p2-local.js'])
  expect(calls).toEqual([])
  await context.close()
})

test('the host moves the ball for everyone; when its page closes, the next player carries on with the same wall', async ({ browser, server }) => {
  test.setTimeout(120_000)
  const { owner, invite, ada, grace, edsger } = await trio(browser, server, 'Ball room')
  expect([await look(ada.page), await look(grace.page), await look(edsger.page)].map((s) => s.host)).toEqual([true, false, false])

  // The guests see the ball go where the host moves it, and can send it somewhere.
  expect(await travel(grace.page)).toBeGreaterThan(20)
  await until(edsger.page, 4)
  const early = await agree([ada.page, grace.page, edsger.page])
  expect(early.gone.length).toBe(early.hits)

  // The host is gone, without a goodbye. A moment later the earliest of the others is in charge.
  await ada.context.close()
  await expect(grace.page.locator('#state')).toHaveText('In "Ball room" as Grace (the host), 3 here.', { timeout: 15_000 })
  await expect(edsger.page.locator('#state')).toHaveText('In "Ball room" as Edsger (hosted by Grace), 3 here.')
  expect((await look(grace.page)).host).toBe(true)
  // Not at once: the new host's first positions are still on their way.
  await expect.poll(() => travel(edsger.page)).toBeGreaterThan(20)

  // The wall is the one they had, and it keeps coming down: past the tenth brick, where the host saves a snapshot.
  await until(edsger.page, 13)
  const later = await agree([grace.page, edsger.page])
  expect(later.seq).toBeGreaterThan(early.seq)
  for (const brick of early.gone) expect(later.gone).toContain(brick)

  // Somebody who comes in now starts from the snapshot and the few ops after it, and sees the same wall.
  const barbara = await join(browser, invite, 'Barbara')
  const late = await look(barbara.page)
  expect(late.loaded).toBeGreaterThanOrEqual(10)
  expect(late.hits).toBeGreaterThanOrEqual(later.hits)
  await agree([grace.page, edsger.page, barbara.page])

  // Everyone leaves, and the room closes. It keeps the wall.
  await leave(barbara.page)
  await leave(edsger.page)
  const last = await look(grace.page)
  await leave(grace.page)
  // Ada, who never said goodbye, keeps her place for half a minute. Then the room is empty.
  await expect
    .poll(
      async () => {
        await owner.portal.reload()
        return owner.portal.getByText('Nobody is here right now').isVisible()
      },
      { timeout: 45_000, intervals: [2000] },
    )
    .toBe(true)

  const ida = await join(browser, invite, 'Ida')
  const found = await look(ida.page)
  expect(found.host).toBe(true)
  expect(found.wall).toBe(last.wall)
  expect(found.hits).toBeGreaterThanOrEqual(last.hits)
  for (const brick of last.gone) expect(found.gone).toContain(brick)
  expect(await travel(ida.page)).toBeGreaterThan(20)
  await until(ida.page, found.hits + 1)

  for (const p of [grace, edsger, barbara, ida]) await p.context.close()
  await owner.close()
})

test('the ball moves as evenly on a guest as on the host, over a network like a LAN', { tag: '@alone' }, async ({ browser, server }) => {
  // A millisecond each way, and up to three more, as between two computers on one LAN. Without it the two pages'
  // timers tick together here, and a guest that is a tick out stays a tick out and looks smooth.
  const proxy = await startLagProxy({ listen: 0, host: HOST, to: { host: '127.0.0.1', port: server.port }, latency: 1, jitter: 3 })
  try {
    const owner = await createRoom(browser, server, 'Even room', BALL)
    const ada = await player(browser, BALL)
    const invite = await host(ada.page, through(owner.invite, server, serverAt(server.url, proxy.port)), 'Ada')
    const grace = await join(browser, invite, 'Grace')
    // The pages' readings of the room's clock settle, and the ball flies.
    await grace.page.waitForTimeout(1500)
    const [hosted, seen] = await Promise.all([frames(ada.page, 4000), frames(grace.page, 4000)])
    const onHost = uneven(hosted)
    const onGuest = uneven(seen)
    const apart = gaps(hosted, seen)
    const p95 = apart[Math.floor(apart.length * 0.95)]!
    test.info().annotations.push({ type: 'even', description: JSON.stringify({ host: onHost, guest: onGuest, apartP95: Math.round(p95 * 100) / 100 }) })
    expect(onHost.straight).toBeGreaterThan(100)
    expect(onGuest.straight).toBeGreaterThan(100)
    // Before each page drew the ball where it is at each frame: 8 of the host's and 13 to 21 of the guest's.
    expect(onHost.uneven).toBeLessThanOrEqual(2)
    expect(onGuest.uneven).toBeLessThanOrEqual(2)
    // Before the host's word said when: 10.9, a tick's travel. Now what is left is the pages' readings of the clock.
    expect(p95).toBeLessThan(5)
    for (const p of [ada, grace]) await p.context.close()
    await owner.close()
  } finally {
    await proxy.close()
  }
})

test('a host whose page stops, connected and in front, hands the role on; everybody sees who is not here', { tag: '@alone' }, async ({ browser, server }) => {
  const { owner, ada, grace, edsger } = await trio(browser, server, 'Frozen room')
  await expect(grace.page.locator('#who')).toHaveText('Ada: here · Grace: here · Edsger: here')

  // Edsger's tab goes to the background: the others see it, and he stays in the room.
  await background(edsger.page, true)
  await expect(grace.page.locator('#who')).toHaveText('Ada: here · Grace: here · Edsger: in the background')
  await background(edsger.page, false)
  await expect(ada.page.locator('#who')).toHaveText('Ada: here · Grace: here · Edsger: here')

  // Ada's page stops for six seconds, as a page does that is stuck in a long task, or whose
  // laptop lid was shut. Its connection stays open the whole time: only silence gives it away.
  const stopped = Date.now()
  const frozen = ada.page.evaluate(() => {
    const end = Date.now() + 6000
    while (Date.now() < end) {
      // nothing: the page does nothing else meanwhile
    }
  })
  await expect(grace.page.locator('#state')).toHaveText('In "Frozen room" as Grace (the host), 3 here.', { timeout: 10_000 })
  const handover = Date.now() - stopped
  await expect(edsger.page.locator('#who')).toHaveText('Ada: not heard from · Grace: here · Edsger: here')
  // Three seconds of silence, and the server looks once a second.
  expect(handover).toBeLessThan(5500)
  expect(await travel(edsger.page)).toBeGreaterThan(20)

  // It wakes up: here again, and not the host again.
  await frozen
  await expect(grace.page.locator('#who')).toHaveText('Ada: here · Grace: here · Edsger: here')
  await expect(ada.page.locator('#state')).toHaveText('In "Frozen room" as Ada (hosted by Grace), 3 here.')

  for (const p of [ada, grace, edsger]) await p.context.close()
  await owner.close()
})

test('a host whose tab goes to the background hands the role on', { tag: '@alone' }, async ({ browser, server }) => {
  const { owner, ada, grace, edsger } = await trio(browser, server, 'Tab room')

  // Edsger looks away first: he is passed over.
  await background(edsger.page, true)
  await background(ada.page, true)
  await expect(grace.page.locator('#state')).toHaveText('In "Tab room" as Grace (the host), 3 here.')
  await expect(ada.page.locator('#state')).toHaveText('In "Tab room" as Ada (hosted by Grace), 3 here.')
  expect(await travel(ada.page)).toBeGreaterThan(20)

  // Coming back does not take the role back.
  await background(ada.page, false)
  await ada.page.waitForTimeout(1500)
  await expect(ada.page.locator('#state')).toHaveText('In "Tab room" as Ada (hosted by Grace), 3 here.')

  // It goes to Ada again when Grace looks away: Ada is in front, Edsger is not.
  await background(grace.page, true)
  await expect(ada.page.locator('#state')).toHaveText('In "Tab room" as Ada (the host), 3 here.')

  for (const p of [ada, grace, edsger]) await p.context.close()
  await owner.close()
})
