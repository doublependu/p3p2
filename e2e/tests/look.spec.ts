// How the portal and the panel look, and what they show under the pointer and the keyboard: fields nobody can
// change, the focus ring, a link too long for its field, phones, headings and colours, and the multiplayer
// button's mark.

import type { Browser, Locator, Page } from '@playwright/test'
import { GAME, HOST, PROXY, serverAt } from '../playwright.config.ts'
import { startLagProxy } from '../tools/lag-proxy.ts'
import { closeEngines, createRoom, host, otherEngines, player, through } from './helpers.ts'
import { expect, test } from './fixtures.ts'

test.afterAll(closeEngines)

/** The background and the edge of a field, as drawn. */
const look = (field: Locator) =>
  field.evaluate((el) => {
    const s = getComputedStyle(el)
    return { background: s.backgroundColor, edge: s.borderTopColor }
  })
const TRANSPARENT = 'rgba(0, 0, 0, 0)'

/** How the focus ring around a field is drawn: `none`, or `solid`. */
const ring = (field: Locator) => field.evaluate((el) => getComputedStyle(el).outlineStyle)

/** Whether a field's text is longer than the field. */
const cut = (field: Locator) => field.evaluate((el) => el.scrollWidth > el.clientWidth)

/** The colour of a text, as drawn. */
const colour = (text: Locator) => text.evaluate((el) => getComputedStyle(el).color)

/** The mark on the panel's multiplayer button, as drawn: its colour, and whether it pulses. */
const mark = (page: Page) =>
  page.locator('p3p2-panel .mark').evaluate((el) => ({
    colour: getComputedStyle(el).color,
    pulse: el.getAnimations().some((a) => a.playState === 'running'),
  }))
const GRAY = 'rgb(163, 160, 148)'
const TEAL = 'rgb(44, 199, 177)'

/** The room's status, as the game sees it. */
const status = (page: Page) => page.evaluate(() => (window as unknown as { p3p2: { room: { status: string } | null } }).p3p2.room?.status)

test('in the portal, a field nobody can change looks unlike one the owner can, light and dark', { tag: '@this-server' }, async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Look room')
  for (const colorScheme of ['light', 'dark'] as const) {
    await owner.portal.emulateMedia({ colorScheme })
    const fixed = await look(owner.portal.getByLabel('Invite link', { exact: true }))
    const changes = await look(owner.portal.getByLabel('Room name', { exact: true }))
    expect(fixed.background, colorScheme).not.toBe(changes.background)
    expect(fixed.edge, colorScheme).toBe(TRANSPARENT)
    expect(changes.edge, colorScheme).not.toBe(TRANSPARENT)
  }
  await owner.close()
})

test('in the panel, the invite link and the chat log look unlike the fields a player types in, light and dark', { tag: '@this-client' }, async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Panel look room')
  const ada = await player(browser)
  await host(ada.page, owner.invite, 'Ada')
  for (const colorScheme of ['light', 'dark'] as const) {
    await ada.page.emulateMedia({ colorScheme })
    const changes = await look(ada.page.getByPlaceholder('Say something…'))
    for (const fixed of [await look(ada.page.getByLabel('Invite link', { exact: true })), await look(ada.page.locator('p3p2-panel .log'))]) {
      expect(fixed.background, colorScheme).not.toBe(changes.background)
      expect(fixed.edge, colorScheme).toBe(TRANSPARENT)
    }
    expect(changes.edge, colorScheme).not.toBe(TRANSPARENT)
  }
  await ada.context.close()
  await owner.close()
})

test('in the portal, a click on an invite link draws no focus ring and Tab does, and a link that does not fit shows whole', { tag: '@this-server' }, async ({ browser, server }) => {
  // The examples' own page as the game: its link is short enough to fit beside Play on the front page.
  const owner = await createRoom(browser, server, 'Ring room', `${GAME}/`, { front: 0 })
  const { portal } = owner
  // Narrow enough that the link doesn't fit beside Copy and Open, wide enough that they stay beside it.
  await portal.setViewportSize({ width: 600, height: 800 })
  const link = portal.getByLabel('Invite link', { exact: true })
  const whole = portal.locator('.whole')
  expect(await cut(link)).toBe(true)
  await expect(whole).toBeHidden()

  await link.click()
  await expect(link).toBeFocused()
  expect(await ring(link)).toBe('none')
  // Selected, ready to copy.
  expect(await link.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, owner.invite.length])
  // Under the pointer, the whole link, under the field. Away from it, nothing.
  await expect(whole).toBeVisible()
  await expect(whole).toHaveText(owner.invite)
  await portal.mouse.move(0, 0)
  await expect(whole).toBeHidden()
  // With the keyboard: the ring, and the whole link.
  await portal.getByRole('button', { name: 'Copy' }).focus()
  await portal.keyboard.press('Shift+Tab')
  await expect(link).toBeFocused()
  expect(await ring(link)).toBe('solid')
  await expect(whole).toBeVisible()

  // The front page: the same ring, and a link that fits beside Play has nothing more to show.
  const visitor = await player(browser, `${server.url}/`)
  const shown = visitor.page.getByLabel('Invite link to Ring room')
  expect(await cut(shown)).toBe(false)
  await shown.click()
  expect(await ring(shown)).toBe('none')
  await expect(visitor.page.locator('.whole')).toBeHidden()
  await visitor.page.getByRole('link', { name: 'Play', exact: true }).focus()
  await visitor.page.keyboard.press('Shift+Tab')
  await expect(shown).toBeFocused()
  expect(await ring(shown)).toBe('solid')
  await expect(visitor.page.locator('.whole')).toBeHidden()
  await visitor.context.close()
  await owner.close()
})

test('in the portal on a phone, an invite link has a line of its own, with its buttons under it, and a room in the list its badges under its name', { tag: '@this-server' }, async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Phone room', undefined, { front: 0 })
  const box = async (l: Locator) => (await l.boundingBox())!
  const alone = async (link: Locator, button: Locator, card: Locator) => {
    const [l, b, c] = [await box(link), await box(button), await box(card)]
    expect(l.width).toBeGreaterThan(c.width * 0.85)
    expect(b.y).toBeGreaterThanOrEqual(l.y + l.height)
  }
  await owner.portal.setViewportSize({ width: 390, height: 844 })
  const portal = owner.portal
  await alone(portal.getByLabel('Invite link', { exact: true }), portal.getByRole('button', { name: 'Copy' }), portal.locator('.card').first())

  // On the front page, with its invite open: three badges, which used to leave the name a few letters a line.
  await portal.getByRole('link', { name: '← Rooms' }).click()
  const room = portal.getByRole('listitem').filter({ hasText: 'Phone room' })
  await expect(room.locator('.badge')).toHaveCount(3)
  const [r, words, badges] = [await box(room), await box(room.locator('.grow')), await box(room.locator('.badges'))]
  expect(words.width).toBeGreaterThan(r.width * 0.9)
  expect(badges.y).toBeGreaterThanOrEqual(words.y + words.height)
  const name = room.getByRole('link', { name: 'Phone room' })
  const line = await name.evaluate((el) => Number.parseFloat(getComputedStyle(el).lineHeight))
  expect((await box(name)).height).toBeLessThan(line * 1.5)

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const front = await context.newPage()
  await front.goto(`${server.url}/`)
  await alone(front.getByLabel('Invite link to Phone room'), front.getByRole('link', { name: 'Play', exact: true }), front.locator('.card').first())
  await context.close()
  await owner.close()
})

test("in the portal, a part of a card is a step below the card's heading, and links are p3p2's teal, not the green of who is here", { tag: '@this-server' }, async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Colour room')
  const ada = await player(browser)
  await host(ada.page, owner.invite, 'Ada')
  const { portal } = owner
  await portal.reload()
  const size = (heading: string) => portal.getByRole('heading', { name: heading, exact: true }).evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))
  expect(await size('The game')).toBeLessThan(await size('Settings'))
  for (const colorScheme of ['light', 'dark'] as const) {
    await portal.emulateMedia({ colorScheme })
    const link = await colour(portal.getByRole('link', { name: '← Rooms' }))
    const here = await colour(portal.locator('.badge.on', { hasText: /^host$/ }))
    expect(link, colorScheme).not.toBe(here)
  }
  await ada.context.close()
  await owner.close()
})

test('in the panel, a click on the invite link draws no focus ring and Tab does, and it shows whole: Chrome, Firefox and WebKit', { tag: '@this-client' }, async ({ browser, server }) => {
  test.setTimeout(90_000)
  const owner = await createRoom(browser, server, 'Panel ring room')
  const browsers: [string, Browser][] = [['Chrome', browser], ...(await otherEngines()).map(({ name, browser }): [string, Browser] => [name, browser])]
  for (const [name, engine] of browsers) {
    const p = await player(engine)
    const invite = await host(p.page, owner.invite, name)
    const link = p.page.getByLabel('Invite link', { exact: true })
    const whole = p.page.locator('p3p2-panel .whole')
    // The panel is 300 px wide: no invite link fits.
    expect(await cut(link), name).toBe(true)

    await link.click()
    await expect(link, name).toBeFocused()
    expect(await ring(link), name).toBe('none')
    await expect(whole, name).toBeVisible()
    await expect(whole, name).toHaveText(invite)
    await p.page.mouse.move(0, 0)
    await expect(whole, name).toBeHidden()

    await p.page.getByRole('button', { name: 'Copy' }).focus()
    await p.page.keyboard.press('Shift+Tab')
    await expect(link, name).toBeFocused()
    expect(await ring(link), name).toBe('solid')
    await expect(whole, name).toBeVisible()
    await p.context.close()
  }
  await owner.close()
})

test("in the panel, links are p3p2's teal and the host's tag the green of who is here, and Leave is on the line that names the server", { tag: '@this-client' }, async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Panel colour room')
  const ada = await player(browser)
  // Outside a room, the panel's link to p3p2.me.
  await ada.page.getByRole('button', { name: 'Multiplayer' }).click()
  const teal = new Map<string, string>()
  for (const colorScheme of ['light', 'dark'] as const) {
    await ada.page.emulateMedia({ colorScheme })
    teal.set(colorScheme, await colour(ada.page.getByRole('link', { name: 'p3p2.me' })))
  }
  await host(ada.page, owner.invite, 'Ada')
  for (const colorScheme of ['light', 'dark'] as const) {
    await ada.page.emulateMedia({ colorScheme })
    expect(await colour(ada.page.locator('p3p2-panel .tag.host')), colorScheme).not.toBe(teal.get(colorScheme))
  }
  const line = ada.page.locator('p3p2-panel .row', { hasText: `on ${new URL(server.url).host}` })
  await expect(line.getByRole('button', { name: 'Leave' })).toBeVisible()
  await ada.context.close()
  await owner.close()
})

test("the multiplayer button's mark is gray while the player is alone, and teal and pulsing in a room", { tag: '@this-client' }, async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Mark room')
  const ada = await player(browser)
  const { page } = ada
  // Before the panel's code loads: the button that stands in for it.
  expect(await colour(page.getByRole('button', { name: 'Multiplayer', exact: true }))).toBe(GRAY)
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  await page.getByRole('button', { name: 'Close' }).click()
  expect(await mark(page)).toEqual({ colour: GRAY, pulse: false })

  await host(page, owner.invite, 'Ada')
  await page.getByRole('button', { name: 'Close' }).click()
  await expect.poll(() => mark(page)).toEqual({ colour: TEAL, pulse: true })
  // The system's "reduce motion": still, and still teal.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await mark(page)).toEqual({ colour: TEAL, pulse: false })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect.poll(() => mark(page)).toEqual({ colour: TEAL, pulse: true })

  await page.getByRole('button', { name: 'Multiplayer' }).click()
  await page.getByRole('button', { name: 'Leave' }).click()
  await page.getByRole('button', { name: 'Close' }).click()
  expect(await mark(page)).toEqual({ colour: GRAY, pulse: false })
  await ada.context.close()
  await owner.close()
})

test("the multiplayer button's mark goes gray while the server can't be heard, and teal again when it can", { tag: '@this-client' }, async ({ browser, server }) => {
  test.skip(PROXY, 'the lag proxy forwards to the server on this machine, which the proxy setup puts behind Caddy')
  test.setTimeout(90_000)
  const proxy = await startLagProxy({ listen: 0, host: HOST, to: { host: '127.0.0.1', port: server.port }, latency: 0, jitter: 0 })
  try {
    const owner = await createRoom(browser, server, 'Quiet room')
    const ada = await player(browser)
    const { page } = ada
    await host(page, through(owner.invite, server, serverAt(server.url, proxy.port)), 'Ada')
    await page.getByRole('button', { name: 'Close' }).click()
    const now = async () => ({ ...(await mark(page)), status: await status(page) })
    const live = { colour: TEAL, pulse: true, status: 'open' }
    await expect.poll(now).toEqual(live)

    // Cut, and kept from coming back: reconnecting.
    proxy.hold(true)
    expect(proxy.drop()).toBeGreaterThanOrEqual(1)
    await expect.poll(now).toEqual({ colour: GRAY, pulse: false, status: 'reconnecting' })
    proxy.hold(false)
    await expect.poll(now, { timeout: 20_000 }).toEqual(live)

    // Held alone: nothing comes, nothing closes. The connection is open as far as the page knows, and the server
    // has been quiet for 12 s.
    proxy.hold(true)
    await expect.poll(now, { timeout: 20_000 }).toEqual({ colour: GRAY, pulse: false, status: 'open' })
    proxy.hold(false)
    await expect.poll(now, { timeout: 30_000 }).toEqual(live)

    await ada.context.close()
    await owner.close()
  } finally {
    await proxy.close()
  }
})
