// An operator updates the server: the published image, on a folder of its own, is stopped, and this checkout's
// server opens the same folder on the same port. Whatever the rooms held is there, the invite made before still
// lets a guest in, and every player is the same player. Run by the image run (`npm run e2e:image`).

import { readFileSync } from 'node:fs'
import type { BrowserContext, Page } from '@playwright/test'
import { GAME, OTHER_SITE } from '../playwright.config.ts'
import { expect, test } from './fixtures.ts'
import { accept, CHAT, createRoom, host } from './helpers.ts'

const WORLD = `${GAME}/world/`
const DUEL = `${GAME}/duel/`
const CDN = 'https://cdn.jsdelivr.net/npm/@p3p2/client@0.1/dist/p3p2.iife.js'

test.use({ onDisk: true })

/** What these tests use of the world example's and the duel example's `window.example`. */
interface World {
  inRoom: boolean
  seed: number
  taken: unknown
  walls: unknown
  wallCount: number
  where: { x: number; y: number }
  standOn(stone: number): boolean
  goTo(x: number, y: number): boolean
  build(walls: number[][]): number
  ground(scattered?: boolean): number[][]
}

interface Duel {
  inRoom: boolean
  table: { seats: (string | null)[]; game: { answers: { i: number; hit: boolean }[][] } }
  turn: number
  hide(squares: number[]): boolean
  probe(i: number): boolean
}

/** Runs `read` in the page, on its `window.example`. `read` is sent as text: it can use only its arguments. */
function example<E, T, A = undefined>(page: Page, read: (e: E, arg: A) => T, arg?: A): Promise<T> {
  return page.evaluate(
    ({ source, arg }) => new Function('e', 'arg', `return (${source})(e, arg)`)((window as unknown as { example: unknown }).example, arg),
    { source: read.toString(), arg },
  ) as Promise<T>
}
const world = <T, A = undefined>(page: Page, read: (w: World, arg: A) => T, arg?: A) => example(page, read, arg)
const duel = <T, A = undefined>(page: Page, read: (d: Duel, arg: A) => T, arg?: A) => example(page, read, arg)

const pid = (page: Page) => page.evaluate(() => (window as unknown as { p3p2: { room: { self: { pid: string } } } }).p3p2.room.self.pid)
const ready = (page: Page) => page.waitForFunction(() => (window as unknown as { example?: { inRoom: boolean } }).example?.inRoom)
const print = (page: Page) => world(page, (w) => JSON.stringify([w.seed, w.taken, w.walls]))

async function opened(context: BrowserContext, url: string, name?: string): Promise<Page> {
  const page = await context.newPage()
  await page.goto(url)
  if (name) await accept(page, name)
  return page
}

test('the published image\'s data, opened by this checkout\'s server: worlds, a game in progress, invites, settings and players', { tag: '@docker' }, async ({ browser, server }) => {
  test.skip(server.kind !== 'image', 'starts on the published image: E2E_SERVER=image, as `npm run e2e:image` sets it')
  test.setTimeout(120_000)
  const contexts = await Promise.all([1, 2, 3, 4].map(() => browser.newContext()))
  const [adas, graces, edsgers, barbaras] = contexts as [BrowserContext, BrowserContext, BrowserContext, BrowserContext]
  const iife = readFileSync(`${process.env.E2E_CLIENT_DIR}/dist/p3p2.iife.js`)
  for (const c of [edsgers, barbaras]) await c.route(CDN, (r) => r.fulfill({ body: iife, contentType: 'text/javascript' }))

  // A world: stones taken, walls built, a snapshot, ops after it, and where each player stood.
  const kept = await createRoom(browser, server, 'Kept world', WORLD)
  const ada = await opened(adas, WORLD)
  const worldInvite = await host(ada, kept.roomUrl, 'Ada')
  await ready(ada)
  const grace = await opened(graces, worldInvite, 'Grace')
  await ready(grace)
  await world(grace, (w) => w.standOn(1))
  await world(ada, (w) => w.build(w.ground().slice(0, 500)))
  await expect.poll(() => world(grace, (w) => w.wallCount)).toBe(500)
  await ada.evaluate(() => (window as unknown as { p3p2: { room: { log: { snapshot(): boolean } } } }).p3p2.room.log.snapshot())
  await world(ada, (w) => w.build(w.ground().slice(500, 520)))
  await world(grace, (w) => w.goTo(...(w.ground(true)[0]!.slice(0, 2) as [number, number])))
  await grace.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const stood = await world(grace, (w) => w.where)
  const gracePid = await pid(grace)
  const theirs = (page: Page, of: string) =>
    page.evaluate((p) => (window as unknown as { p3p2: { room: { retained(c: string, o: object): unknown } } }).p3p2.room.retained('stand:yard', { player: p }), of)
  await expect.poll(() => theirs(ada, gracePid)).toEqual([stood.x, stood.y])
  await expect.poll(() => world(grace, (w) => w.wallCount)).toBe(520)
  const before = await print(ada)

  // A duel in progress: seats, two hidden boards, a probe and its answer.
  const duelRoom = await createRoom(browser, server, 'Kept duel', DUEL)
  const edsger = await opened(edsgers, DUEL)
  await edsger.getByRole('button', { name: 'Friends' }).click()
  await edsger.getByLabel('Your name').fill('Edsger')
  await edsger.getByLabel('Room URL').fill(duelRoom.roomUrl)
  await expect(edsger.getByRole('status')).toContainText('✓')
  await edsger.getByRole('button', { name: 'Create a multiplayer game room for my friends' }).click()
  const duelInvite = await edsger.getByLabel('Invite link', { exact: true }).inputValue()
  const barbara = await opened(barbaras, duelInvite, 'Barbara')
  for (const page of [edsger, barbara]) await ready(page)
  await expect.poll(() => duel(edsger, (d) => d.table.seats.every(Boolean))).toBe(true)
  await duel(edsger, (d) => d.hide([0, 1, 2, 3, 4]))
  await duel(barbara, (d) => d.hide([30, 31, 32, 33, 34]))
  await expect.poll(() => duel(edsger, (d) => d.turn)).toBe(0)
  await duel(edsger, (d) => d.probe(32))
  await expect.poll(() => duel(edsger, (d) => d.table.game.answers[1]!.length)).toBe(1)
  const table = await duel(edsger, (d) => JSON.stringify(d.table))

  // A room with settings of its own: how many may join, a second site, and its rule for versions.
  const settled = await createRoom(browser, server, 'Settled', CHAT, { players: 3 })
  await settled.portal.getByLabel('Sites that may use this room').fill(OTHER_SITE)
  await settled.portal.getByLabel('Players on different versions of the game').selectOption('major')
  await settled.portal.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(settled.portal.getByLabel('Players on different versions of the game')).toHaveValue('major')

  // The update: every page closes, the image stops, and this checkout's server starts on the same folder.
  for (const page of [ada, grace, edsger, barbara]) await page.close()
  await server.restart({ kind: 'checkout' })

  // The invite made before lets Grace in, as the same player, to the same world, where she stood.
  const graceBack = await opened(graces, worldInvite, 'Grace')
  await ready(graceBack)
  expect(await pid(graceBack)).toBe(gracePid)
  expect(await print(graceBack)).toBe(before)
  expect(await world(graceBack, (w) => w.where)).toEqual(stood)
  // The host pastes the room URL: the same room.
  const adaBack = await opened(adas, WORLD)
  await host(adaBack, kept.roomUrl, 'Ada')
  await ready(adaBack)
  await expect(adaBack.locator('#state')).toContainText('In "Kept world" as Ada')
  expect(await print(adaBack)).toBe(before)

  // The duel goes on: the same table, and Edsger's page still holds his squares and answers the next probe.
  const edsgerBack = await opened(edsgers, duelInvite, 'Edsger')
  const barbaraBack = await opened(barbaras, duelInvite, 'Barbara')
  for (const page of [edsgerBack, barbaraBack]) await ready(page)
  expect(await duel(barbaraBack, (d) => JSON.stringify(d.table))).toBe(table)
  await expect.poll(() => duel(barbaraBack, (d) => d.turn)).toBe(1)
  await duel(barbaraBack, (d) => d.probe(9))
  await expect.poll(() => duel(edsgerBack, (d) => d.table.game.answers[0])).toEqual([{ i: 9, hit: false }])

  // The room's settings are its own still, and the owner's portal session too.
  await settled.portal.reload()
  await expect(settled.portal.getByLabel('Most players')).toHaveValue('3')
  // The game's own site, which is always allowed, and the second.
  await expect(settled.portal.getByLabel('Sites that may use this room')).toHaveValue(`${GAME}\n${OTHER_SITE}`)
  await expect(settled.portal.getByLabel('Players on different versions of the game')).toHaveValue('major')

  // No room was on a front page before the update, and none is after it: the server's address is for logging in.
  await expect(settled.portal.getByLabel("On this server's front page")).toHaveValue('off')
  const visitor = await opened(adas, `${server.url}/`)
  await expect(visitor).toHaveURL(`${server.url}/login`)
  await visitor.close()

  for (const c of contexts) await c.close()
  for (const owner of [kept, duelRoom, settled]) await owner.close()
})
