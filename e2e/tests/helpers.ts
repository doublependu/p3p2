import { mkdirSync, writeFileSync } from 'node:fs'
import { join as path } from 'node:path'
import type { ServerStats } from '@p3p2/protocol'
import { type Browser, type BrowserContext, devices, expect, firefox, type Locator, type Page, webkit } from '@playwright/test'
import jsQR from 'jsqr'
import { GAME, PASSWORD, PROXY, STATS_TOKEN } from '../playwright.config.ts'

export const CHAT = `${GAME}/chat.html`

/** A server as an invite link names it: `https://` is implied and left out; any other scheme is written. */
export function inInvite(server: string): string {
  return server.replace(/^https:\/\//, '')
}

/** A server, as the helpers need it: where it is. The test's own (`fixtures.ts`), or any other. */
export interface Server {
  url: string
}

/**
 * The owner's side: logs in to the portal of the server and creates a room for a game: the chat example unless
 * told otherwise. `players`: how many may join, where the server's default is not wanted.
 */
export async function createRoom(
  browser: Browser,
  server: Server,
  name: string,
  game: string = CHAT,
  options: { players?: number } = {},
): Promise<{ portal: Page; roomUrl: string; close: () => Promise<void> }> {
  const context = await browser.newContext()
  const portal = await context.newPage()
  await portal.goto(`${server.url}/`)
  await portal.getByLabel('Password').fill(PASSWORD)
  await portal.getByRole('button', { name: 'Log in' }).click()
  await portal.getByLabel('Game URL').fill(game)
  await portal.getByLabel('Room name').fill(name)
  if (options.players !== undefined) await portal.getByLabel('Most players').fill(String(options.players))
  await portal.getByRole('button', { name: 'Create room' }).click()
  await expect(portal.getByRole('heading', { name })).toBeVisible()
  const roomUrl = await portal.getByLabel('Room URL').inputValue()
  return { portal, roomUrl, close: () => context.close() }
}

export interface Player {
  page: Page
  context: BrowserContext
}

/** A player with a browser profile of their own. */
export async function player(browser: Browser, url: string = CHAT): Promise<Player> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(url)
  return { page, context }
}

/** Pastes the room URL into the panel, creates the invite, and returns the link to share. */
export async function host(page: Page, roomUrl: string, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  await page.getByLabel('Your name').fill(name)
  await page.getByLabel('Room URL').fill(roomUrl)
  await expect(page.getByRole('status')).toContainText('✓')
  await page.getByRole('button', { name: 'Create a multiplayer game room for my friends' }).click()
  const link = page.getByLabel('Invite link', { exact: true })
  await expect(link).toBeVisible()
  return link.inputValue()
}

/** Says yes to the "Join?" question on a page that was opened from an invite link. */
export async function accept(page: Page, name: string): Promise<void> {
  await expect(page.getByRole('button', { name: 'Join', exact: true })).toBeEnabled()
  await page.getByLabel('Your name').fill(name)
  await page.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(page.locator('#state')).toContainText(`as ${name}`)
}

/** Opens an invite link and says yes. */
export async function join(browser: Browser, invite: string, name: string): Promise<Player> {
  const p = await player(browser, invite)
  await accept(p.page, name)
  return p
}

export function selfId(page: Page): Promise<number | undefined> {
  return page.evaluate(() => (window as unknown as { p3p2: { room: { self: { id: number } } | null } }).p3p2.room?.self.id)
}

export interface Scan {
  /** What the code says, or null if it cannot be read. */
  text: string | null
  /** Brightness (0–255) of the margin around the code, and of its darkest module. */
  margin: number
  ink: number
}

/**
 * Reads a QR code from what is actually on screen. The decoder is more forgiving than a phone
 * camera (it reads black on dark grey), so the contrast is reported too.
 */
export async function scan(target: Locator): Promise<Scan> {
  const png = await target.screenshot()
  // Decode the PNG with the browser, then the QR code here. On a blank page of its own: the
  // portal's content policy, rightly, does not allow data: images.
  const scratch = await target.page().context().newPage()
  const { data, width, height } = await scratch.evaluate(async (url) => {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
    return { data: Array.from(pixels.data), width: pixels.width, height: pixels.height }
  }, `data:image/png;base64,${png.toString('base64')}`)
  await scratch.close()

  const brightness = (i: number) => Math.round((data[i]! + data[i + 1]! + data[i + 2]!) / 3)
  let ink = 255
  for (let i = 0; i < data.length; i += 4) ink = Math.min(ink, brightness(i))
  // Just inside the corner, past the rounding: part of the quiet zone a scanner relies on.
  const margin = brightness((10 * width + 10) * 4)
  return { text: jsQR(new Uint8ClampedArray(data), width, height)?.data ?? null, margin, ink }
}

// ---- other browsers, and a phone ----

export interface Engine {
  name: 'firefox' | 'webkit'
  browser: Browser
}

let engines: Promise<Engine[]> | null = null

/**
 * Firefox and WebKit (Safari's engine), next to the Chrome every test gets: for checks that all
 * three build the same thing from the same numbers. The run's setup (`setup.ts`) has made sure
 * both start on this machine, so an engine that does not is a failure, not a reason to leave it
 * out. Close them with `closeEngines()` when the file's tests are done.
 */
export function otherEngines(): Promise<Engine[]> {
  engines ??= Promise.all([
    // The test runner hands its own launch options (Chrome's channel, and its switches) to every launch. Not these two.
    firefox.launch({ channel: '', args: [] }).then((browser) => ({ name: 'firefox' as const, browser })),
    webkit.launch({ channel: '', args: [] }).then((browser) => ({ name: 'webkit' as const, browser })),
  ])
  return engines
}

export async function closeEngines(): Promise<void> {
  const open = await (engines ?? Promise.resolve([]))
  engines = null
  for (const { browser } of open) await browser.close()
}

/** A profile with a phone's screen, held upright or on its side, and fingers instead of a mouse. Chrome only. */
export function phoneContext(browser: Browser, landscape: boolean = true): Promise<BrowserContext> {
  const { defaultBrowserType: _, ...phone } = devices[landscape ? 'Pixel 7 landscape' : 'Pixel 7']!
  return browser.newContext(phone)
}

export interface Fingers {
  /** Puts finger `id` down, moves it, or lifts it. Several can be down at once. */
  down(id: number, x: number, y: number): Promise<void>
  move(id: number, x: number, y: number): Promise<void>
  up(id: number): Promise<void>
}

/** Real touches on a page of a `phoneContext`, as the browser's own input: a thumb that stays down while another finger moves. */
export async function fingers(page: Page): Promise<Fingers> {
  const cdp = await page.context().newCDPSession(page)
  const down = new Map<number, { x: number; y: number }>()
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd') =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...down].map(([id, at]) => ({ id, x: at.x, y: at.y })) })
  return {
    async down(id, x, y) {
      down.set(id, { x, y })
      await send('touchStart')
    },
    async move(id, x, y) {
      down.set(id, { x, y })
      await send('touchMove')
    },
    async up(id) {
      down.delete(id)
      await send('touchEnd')
    },
  }
}

// ---- what a game costs the server ----

export interface Traffic {
  /** What was measured: an example, and what it was doing. */
  name: string
  players: number
  seconds: number
  /** What one player sent, a second: frames and bytes, in all and by kind of frame. */
  perPlayer: { frames: number; bytes: number; kinds: Record<string, { frames: number; bytes: number }> }
  /** What the server sent to one player, a second. */
  toPlayer: { frames: number; bytes: number }
  /** Frames the rate limit refused, and volatile messages dropped for a receiver that was behind. Both should be 0. */
  rateDropped: number
  volatileDropped: number
  /** Database writes a second, for the whole room. */
  writes: number
  /** The longest the server's event loop ran late during the measurement, ms. */
  loopMaxMs: number
}

async function stats(server: Server, reset: boolean): Promise<ServerStats> {
  const res = await fetch(`${server.url}/api/v1/stats${reset ? '?reset=1' : ''}`, { headers: { authorization: `Bearer ${STATS_TOKEN}` } })
  if (!res.ok) throw new Error(`The server's stats answered ${res.status}`)
  return (await res.json()) as ServerStats
}

/** True where the server's numbers can be read: not behind the proxy, where its certificate is Caddy's own. */
export const CAN_MEASURE = !PROXY

/**
 * Counts what the players of one room send and get while `play` runs, from the server's own
 * counters. Nothing else may be using the server meanwhile: the test's own is, alone. With
 * E2E_RECORD=1 the result is also written to bench/results/examples/<name>.json; an ordinary
 * run changes no file of the checkout.
 */
export async function measure(server: Server, name: string, players: number, play: () => Promise<void>): Promise<Traffic> {
  const before = await stats(server, true)
  await play()
  const after = await stats(server, false)
  const seconds = after.uptime - before.uptime
  const rate = (a: number, b: number, per: number = players) => Math.round(((a - b) / seconds / per) * 10) / 10
  const kinds: Traffic['perPlayer']['kinds'] = {}
  for (const [kind, now] of Object.entries(after.kinds)) {
    const was = before.kinds[kind as keyof ServerStats['kinds']]
    if (now.frames > was.frames) kinds[kind] = { frames: rate(now.frames, was.frames), bytes: rate(now.bytes, was.bytes) }
  }
  const traffic: Traffic = {
    name,
    players,
    seconds: Math.round(seconds * 10) / 10,
    perPlayer: { frames: rate(after.framesIn, before.framesIn), bytes: rate(after.bytesIn, before.bytesIn), kinds },
    toPlayer: { frames: rate(after.framesOut, before.framesOut), bytes: rate(after.bytesOut, before.bytesOut) },
    rateDropped: after.rateDropped - before.rateDropped,
    volatileDropped: after.volatileDropped - before.volatileDropped,
    writes: rate(after.writes, before.writes, 1),
    loopMaxMs: after.loop.max,
  }
  if (process.env.E2E_RECORD === '1') {
    const dir = path(import.meta.dirname, '..', '..', 'bench', 'results', 'examples')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path(dir, `${name}.json`), `${JSON.stringify(traffic, null, 2)}\n`)
  }
  return traffic
}
