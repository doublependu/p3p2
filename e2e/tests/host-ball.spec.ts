// A game with one player in charge, on the room's log: the host moves a ball and knocks bricks out
// of a wall. The role passes on when the host goes, and the wall outlives everyone.

import { type Browser, expect, type Page, test } from '@playwright/test'
import { GAME } from '../playwright.config.ts'
import { createRoom, host, join, player } from './helpers.ts'

// Four times the speed: a brick about every second.
const BALL = `${GAME}/host-ball/?speed=4`

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
  kick(x: number, y: number): void
}

type Look = Omit<Game, 'kick'>

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

async function trio(browser: Browser, name: string) {
  const owner = await createRoom(browser, name, BALL)
  const ada = await player(browser, BALL)
  const invite = await host(ada.page, owner.roomUrl, 'Ada')
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

test('the host moves the ball for everyone; when its page closes, the next player carries on with the same wall', async ({ browser }) => {
  test.setTimeout(120_000)
  const { owner, invite, ada, grace, edsger } = await trio(browser, 'Ball room')
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

test('a host whose page stops, connected and in front, hands the role on; everybody sees who is not here', async ({ browser }) => {
  const { owner, ada, grace, edsger } = await trio(browser, 'Frozen room')
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

test('a host whose tab goes to the background hands the role on', async ({ browser }) => {
  const { owner, ada, grace, edsger } = await trio(browser, 'Tab room')

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
