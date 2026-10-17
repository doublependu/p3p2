import type { WebSocketRoute } from '@playwright/test'
import { GAME, OTHER_SITE } from '../playwright.config.ts'
import { accept, CHAT, createRoom, host, inInvite, join, player, scan, selfId } from './helpers.ts'
import { expect, test } from './fixtures.ts'

test('a normal visit loads only the entry file', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const scripts: string[] = []
  page.on('request', (r) => {
    if (r.resourceType() === 'script') scripts.push(new URL(r.url()).pathname)
  })
  await page.goto(CHAT)
  await expect(page.getByRole('button', { name: 'Multiplayer' })).toBeVisible()
  await expect(page.locator('#state')).toContainText('Playing alone')
  expect(scripts).toEqual(['/dist/p3p2.js'])

  // The rest arrives when the player asks for it.
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  await expect(page.getByLabel('Room URL')).toBeVisible()
  expect(scripts.sort()).toEqual(['/dist/p3p2-core.js', '/dist/p3p2-panel.js', '/dist/p3p2.js'])
  await context.close()
})

test('a host and two guests chat, and share a world', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Friday games')
  const ada = await player(browser)
  const invite = await host(ada.page, owner.roomUrl, 'Ada')
  expect(invite).toMatch(new RegExp(`^${CHAT}\\?room=${inInvite(server.url)}/[0-9a-z]{10}$`))
  await expect(ada.page.locator('#state')).toHaveText('In "Friday games" as Ada (the host), 1 here.')

  const grace = await join(browser, invite, 'Grace')
  const edsger = await join(browser, invite, 'Edsger')
  await expect(edsger.page.locator('#state')).toHaveText('In "Friday games" as Edsger (hosted by Ada), 3 here.')
  await expect(ada.page.locator('#state')).toContainText('3 here')

  // From the panel's chat box, and from the page through the API: one pipe.
  await ada.page.getByPlaceholder('Say something…').fill('hello from the panel')
  await ada.page.getByPlaceholder('Say something…').press('Enter')
  await grace.page.locator('#text').fill('hello from the API')
  await grace.page.locator('#send').click()
  for (const p of [ada, grace, edsger]) {
    await expect(p.page.locator('#log li')).toHaveText(['Ada: hello from the panel', 'Grace: hello from the API'])
  }
  await edsger.page.getByRole('button', { name: 'Multiplayer' }).click()
  await expect(edsger.page.locator('.log li')).toContainText(['Ada: hello from the panel', 'Grace: hello from the API'])
  await expect(edsger.page.locator('.members li')).toHaveText([/Ada.*host/, /Grace/, /Edsger.*you/])

  // The first player's world is everyone's world.
  const world = await ada.page.locator('#world').textContent()
  expect(world).toMatch(/^World seed: \d+, made by Ada$/)
  await expect(grace.page.locator('#world')).toHaveText(world!)
  await expect(edsger.page.locator('#world')).toHaveText(world!)

  // Someone who arrives later gets the recent chat and the same world.
  const barbara = await join(browser, invite, 'Barbara')
  await expect(barbara.page.locator('#log li')).toHaveText(['Ada: hello from the panel', 'Grace: hello from the API'])
  await expect(barbara.page.locator('#world')).toHaveText(world!)

  // The portal shows the same link, the players, and a QR code.
  await owner.portal.reload()
  await expect(owner.portal.getByLabel('Invite link', { exact: true })).toHaveValue(invite)
  await expect(owner.portal.locator('ul.list li')).toHaveCount(4)
  const qr = owner.portal.getByAltText('QR code of the invite link')
  await expect(qr).toBeVisible()
  expect(await qr.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)

  for (const p of [ada, grace, edsger, barbara]) await p.context.close()
  await owner.close()
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`the QR codes scan to the invite link (${colorScheme})`, async ({ browser, server }) => {
    const owner = await createRoom(browser, server, `QR room ${colorScheme}`)
    const context = await browser.newContext({ colorScheme })
    const page = await context.newPage()
    await page.goto(CHAT)
    const invite = await host(page, owner.roomUrl, 'Ada')

    await page.getByRole('button', { name: 'QR code' }).click()
    const canvas = page.getByRole('img', { name: 'QR code of the invite link' })
    await expect(canvas).toBeVisible()
    await expect.poll(async () => (await scan(canvas)).text).toBe(invite)
    // Dark on white in either theme: a camera needs the contrast.
    const inPanel = await scan(canvas)
    expect(inPanel.margin).toBeGreaterThanOrEqual(240)
    expect(inPanel.ink).toBeLessThanOrEqual(40)

    // The portal's copy, for a TV at a LAN party.
    await owner.portal.emulateMedia({ colorScheme })
    await owner.portal.reload()
    const inPortal = await scan(owner.portal.getByAltText('QR code of the invite link'))
    expect(inPortal.text).toBe(invite)
    expect(inPortal.margin).toBeGreaterThanOrEqual(240)
    expect(inPortal.ink).toBeLessThanOrEqual(40)

    await context.close()
    await owner.close()
  })
}

test('a room only works from its own game site', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Bound room')
  const ada = await player(browser)
  const invite = await host(ada.page, owner.roomUrl, 'Ada')

  // The room URL, pasted into the same game on another site.
  const elsewhere = await player(browser, `${OTHER_SITE}/chat.html`)
  await elsewhere.page.getByRole('button', { name: 'Multiplayer' }).click()
  await elsewhere.page.getByLabel('Room URL').fill(owner.roomUrl)
  await expect(elsewhere.page.getByRole('status')).toContainText(`isn't set up for ${OTHER_SITE}`)
  await expect(elsewhere.page.getByRole('button', { name: 'Create a multiplayer game room for my friends' })).toBeDisabled()

  // The invite, opened on another site.
  const guest = await player(browser, invite.replace(GAME, OTHER_SITE))
  await expect(guest.page.getByRole('status')).toContainText(`isn't set up for ${OTHER_SITE}`)
  await expect(guest.page.getByRole('button', { name: 'Join', exact: true })).toBeDisabled()
  await guest.page.getByRole('button', { name: 'Play alone' }).click()
  await expect(guest.page.locator('#state')).toContainText('Playing alone')
  expect(new URL(guest.page.url()).search).toBe('')

  for (const p of [ada, elsewhere, guest]) await p.context.close()
  await owner.close()
})

test('a room is for the game first played in it: another game on the same site is turned away, until the owner lets it in', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'One game room')
  const ada = await player(browser)
  const invite = await host(ada.page, owner.roomUrl, 'Ada')

  // The invite, opened in another game on the same site: same origin, another game id.
  const cards = await player(browser, invite.replace('/chat.html', '/cards.html'))
  await cards.page.getByLabel('Your name').fill('Grace')
  await cards.page.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(cards.page.locator('p3p2-panel')).toContainText('This room is for another game')
  await expect(cards.page.locator('#state')).not.toContainText('as Grace')

  // The portal says which game the room is for, and lets another in.
  await owner.portal.reload()
  await expect(owner.portal.getByText('chat-example')).toBeVisible()
  owner.portal.once('dialog', (d) => void d.accept())
  await owner.portal.getByRole('button', { name: 'Let another game in' }).click()
  await expect(owner.portal.getByText('No game has played in this room yet')).toBeVisible()
  // The next game to come in is now the one the room is for: Grace's cards. Ada's chat, still in it, is not put out.
  const again = await player(browser, invite.replace('/chat.html', '/cards.html'))
  await again.page.getByLabel('Your name').fill('Grace')
  await again.page.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(again.page.locator('#state')).toContainText('as Grace')

  for (const p of [ada, cards, again]) await p.context.close()
  await owner.close()
})

test('Share hands the invite to the system share sheet, where there is one', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Shared room')
  const context = await browser.newContext()
  // Desktop Chrome has no share sheet; a phone's would get this.
  await context.addInitScript(() => {
    const w = window as unknown as { shared: unknown[] }
    w.shared = []
    Object.defineProperty(navigator, 'share', { value: async (data: unknown) => void w.shared.push(data) })
  })
  const page = await context.newPage()
  await page.goto(CHAT)
  const invite = await host(page, owner.roomUrl, 'Ada')
  await page.locator('p3p2-panel').getByRole('button', { name: 'Share' }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { shared: { url: string }[] }).shared.map((s) => s.url))).toEqual([invite])
  // Without one, there is no Share button at all.
  const plain = await player(browser)
  await host(plain.page, owner.roomUrl, 'Grace')
  await expect(plain.page.locator('p3p2-panel').getByRole('button', { name: 'Share' })).toBeHidden()
  for (const c of [context, plain.context]) await c.close()
  await owner.close()
})

test('an invite that was replaced is refused; the new one works', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Renewed room')
  const ada = await player(browser)
  const old = await host(ada.page, owner.roomUrl, 'Ada')

  await owner.portal.reload()
  owner.portal.once('dialog', (d) => void d.accept())
  await owner.portal.getByRole('button', { name: 'Renew invite' }).click()
  const fresh = await owner.portal.getByLabel('Invite link', { exact: true }).inputValue()
  expect(fresh).not.toBe(old)

  const late = await player(browser, old)
  await expect(late.page.getByRole('status')).toContainText('expired or was replaced')
  await expect(late.page.getByRole('button', { name: 'Join', exact: true })).toBeDisabled()

  const grace = await join(browser, fresh, 'Grace')
  await expect(ada.page.locator('#state')).toContainText('2 here')

  for (const p of [ada, late, grace]) await p.context.close()
  await owner.close()
})

test('a reload keeps the membership, for guest and host, and passes the host role on', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Reload room')
  const ada = await player(browser)
  const invite = await host(ada.page, owner.roomUrl, 'Ada')
  const grace = await join(browser, invite, 'Grace')
  const graceId = await selfId(grace.page)
  const adaId = await selfId(ada.page)

  await grace.page.reload()
  // No question this time: straight back in, as the same member.
  await expect(grace.page.locator('#state')).toHaveText('In "Reload room" as Grace (hosted by Ada), 2 here.')
  expect(await selfId(grace.page)).toBe(graceId)

  // The host's page is gone for a moment, and what it held of a game with it. The role does
  // not wait for it: it passes on at once, and Ada is back as the same member without it.
  await ada.page.reload()
  await expect(ada.page.locator('#state')).toHaveText('In "Reload room" as Ada (hosted by Grace), 2 here.')
  await expect(grace.page.locator('#state')).toHaveText('In "Reload room" as Grace (the host), 2 here.')
  expect(await selfId(ada.page)).toBe(adaId)
  // Still the key holder: the invite link and the controls are there.
  await ada.page.getByRole('button', { name: 'Multiplayer' }).click()
  await expect(ada.page.getByLabel('Invite link', { exact: true })).toHaveValue(invite)
  await expect(ada.page.getByRole('button', { name: 'End for everyone' })).toBeVisible()

  // Nobody saw anyone leave.
  await grace.page.getByRole('button', { name: 'Multiplayer' }).click()
  await expect(grace.page.locator('.log')).not.toContainText('left')
  await expect(grace.page.locator('.members li')).toHaveCount(2)

  for (const p of [ada, grace]) await p.context.close()
  await owner.close()
})

test('leave, kick, and end for everyone', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Bouncer room')
  const ada = await player(browser)
  const invite = await host(ada.page, owner.roomUrl, 'Ada')
  const grace = await join(browser, invite, 'Grace')
  const edsger = await join(browser, invite, 'Edsger')
  const barbara = await join(browser, invite, 'Barbara')

  await grace.page.getByRole('button', { name: 'Multiplayer' }).click()
  await grace.page.getByRole('button', { name: 'Leave' }).click()
  await expect(grace.page.locator('#state')).toHaveText('Playing alone again (left).')
  await expect(ada.page.locator('#state')).toContainText('3 here')
  await expect(ada.page.locator('.log')).toContainText('Grace left')

  await ada.page.getByRole('button', { name: 'Remove Edsger' }).click()
  await expect(edsger.page.locator('#state')).toHaveText('Playing alone again (kicked).')
  await expect(edsger.page.getByRole('status')).toHaveText('You were removed from the room.')
  await expect(ada.page.locator('#state')).toContainText('2 here')
  // Guests have no such button.
  await barbara.page.getByRole('button', { name: 'Multiplayer' }).click()
  await expect(barbara.page.getByRole('button', { name: 'Remove Ada' })).toHaveCount(0)
  await expect(barbara.page.getByRole('button', { name: 'End for everyone' })).toHaveCount(0)

  await ada.page.getByRole('button', { name: 'End for everyone' }).click()
  await expect(barbara.page.locator('#state')).toHaveText('Playing alone again (ended).')
  await expect(barbara.page.getByRole('status')).toHaveText('The session was ended.')
  await expect(ada.page.locator('#state')).toHaveText('Playing alone again (ended).')

  for (const p of [ada, grace, edsger, barbara]) await p.context.close()
  await owner.close()
})

test('the host role moves on when the host leaves', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Handover room')
  const ada = await player(browser)
  const invite = await host(ada.page, owner.roomUrl, 'Ada')
  const grace = await join(browser, invite, 'Grace')
  const edsger = await join(browser, invite, 'Edsger')

  await ada.page.getByRole('button', { name: 'Leave' }).click()
  await expect(grace.page.locator('#state')).toHaveText('In "Handover room" as Grace (the host), 2 here.')
  await expect(edsger.page.locator('#state')).toHaveText('In "Handover room" as Edsger (hosted by Grace), 2 here.')

  for (const p of [ada, grace, edsger]) await p.context.close()
  await owner.close()
})

test('typing in the panel does not reach the game, but key releases do', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Keys room')
  const ada = await player(browser)
  await host(ada.page, owner.roomUrl, 'Ada')
  await ada.page.evaluate(() => {
    const w = window as unknown as { keys: { down: number; up: number; press: number } }
    w.keys = { down: 0, up: 0, press: 0 }
    addEventListener('keydown', () => w.keys.down++)
    addEventListener('keypress', () => w.keys.press++)
    addEventListener('keyup', () => w.keys.up++)
  })
  const keys = () => ada.page.evaluate(() => (window as unknown as { keys: object }).keys)
  const typing = () =>
    ada.page.evaluate(() => (window as unknown as { p3p2: { constructor: { isTyping: boolean } } }).p3p2.constructor.isTyping)

  await ada.page.getByPlaceholder('Say something…').click()
  expect(await typing()).toBe(true)
  await ada.page.keyboard.type('wasd')
  expect(await keys()).toEqual({ down: 0, up: 4, press: 0 })

  // Escape closes the panel and gives the keyboard back.
  await ada.page.keyboard.press('Escape')
  await expect(ada.page.getByRole('button', { name: 'Multiplayer' })).toBeVisible()
  expect(await typing()).toBe(false)
  await ada.page.keyboard.press('w')
  expect(await keys()).toEqual({ down: 1, up: 6, press: 1 })

  // Enter opens chat, with the unsent draft still there; the line is sent and the game has the
  // keyboard again.
  await ada.page.keyboard.press('Enter')
  await expect(ada.page.getByPlaceholder('Say something…')).toBeFocused()
  await expect(ada.page.getByPlaceholder('Say something…')).toHaveValue('wasd')
  await ada.page.keyboard.type(' gg')
  await ada.page.keyboard.press('Enter')
  await expect(ada.page.locator('#log li')).toHaveText(['Ada: wasd gg'])
  await expect(ada.page.getByRole('button', { name: 'Multiplayer' })).toBeVisible()
  expect(await typing()).toBe(false)

  await ada.context.close()
  await owner.close()
})

test('the panel fits a phone', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Phone room')
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true })
  const page = await context.newPage()
  await page.goto(CHAT)
  await host(page, owner.roomUrl, 'Ada')
  const box = await page.locator('.card').boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(360)
  expect(box!.y + box!.height).toBeLessThanOrEqual(640)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)

  // With the QR code open the panel is taller than the screen: it scrolls, and nothing is squashed.
  await page.getByRole('button', { name: 'QR code' }).click()
  await expect(page.getByRole('img', { name: 'QR code of the invite link' })).toBeVisible()
  const tall = await page.locator('.card').boundingBox()
  expect(tall!.y + tall!.height).toBeLessThanOrEqual(640)
  expect((await page.locator('.log').boundingBox())!.height).toBeGreaterThanOrEqual(100)
  expect((await page.getByRole('img', { name: 'QR code of the invite link' }).boundingBox())!.width).toBeGreaterThanOrEqual(190)
  const body = page.locator('.card > .body')
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)

  // A thumb sends a line with the button; a phone's keyboard may have no Enter.
  await page.getByPlaceholder('Say something…').fill('from my pocket')
  await page.locator('p3p2-panel').getByRole('button', { name: 'Send' }).tap()
  await expect(page.locator('.log li').last()).toHaveText('Ada: from my pocket')
  await expect(page.getByPlaceholder('Say something…')).toHaveValue('')

  // A game that cancels every touch on the page, as one does to keep a double tap from zooming,
  // makes the browser send no click. The panel's buttons still work under a finger.
  await page.evaluate(() => document.addEventListener('touchend', (e) => e.preventDefault(), { passive: false }))
  await page.locator('p3p2-panel').getByRole('button', { name: 'Close' }).tap()
  await expect(page.locator('.card')).toBeHidden()
  await page.getByRole('button', { name: 'Multiplayer' }).tap()
  await expect(page.locator('.card')).toBeVisible()
  await context.close()
  await owner.close()
})

test('a dropped connection comes back by itself, as the same member', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Blip room')
  const ada = await player(browser)
  const invite = await host(ada.page, owner.roomUrl, 'Ada')

  // Grace's sockets pass through the test, which can cut them.
  const context = await browser.newContext()
  const page = await context.newPage()
  const sockets: WebSocketRoute[] = []
  await page.routeWebSocket(/\/api\/v1\/ws$/, (ws) => {
    ws.connectToServer()
    sockets.push(ws)
  })
  await page.goto(invite)
  await accept(page, 'Grace')
  const id = await selfId(page)
  await page.evaluate(() => {
    const w = window as unknown as { statuses: string[]; p3p2: { room: { on(e: string, f: (s: string) => void): void } } }
    w.statuses = []
    w.p3p2.room.on('status', (s) => w.statuses.push(s))
  })

  await sockets[0]!.close()
  await expect.poll(() => page.evaluate(() => (window as unknown as { statuses: string[] }).statuses)).toEqual(['reconnecting', 'open'])
  expect(sockets.length).toBe(2)
  expect(await selfId(page)).toBe(id)
  await expect(page.locator('#state')).toHaveText('In "Blip room" as Grace (hosted by Ada), 2 here.')

  // The room carries on as if nothing happened.
  await page.locator('#text').fill('back again')
  await page.locator('#send').click()
  await expect(ada.page.locator('#log li')).toHaveText(['Grace: back again'])
  await expect(ada.page.locator('.log')).not.toContainText('left')
  await expect(ada.page.locator('.members li')).toHaveCount(2)

  await context.close()
  await ada.context.close()
  await owner.close()
})

test('the invite link can be copied', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Copy room')
  const ada = await player(browser)
  const invite = await host(ada.page, owner.roomUrl, 'Ada')
  await ada.page.getByRole('button', { name: 'Copy' }).click()
  // With the Clipboard API: copied. Without it (plain http): the old command, or at least the
  // link is selected, ready for Ctrl+C or a long press.
  await expect(ada.page.getByRole('button', { name: /^(Copied|Selected)$/ })).toBeVisible()
  const selected = await ada.page.getByLabel('Invite link', { exact: true }).evaluate((el: HTMLInputElement) => el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0))
  if (await ada.page.getByRole('button', { name: 'Selected' }).count()) expect(selected).toBe(invite)
  await ada.context.close()
  await owner.close()
})

test('the single-file build works without a bundler or modules', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Script tag room')
  const context = await browser.newContext()
  const page = await context.newPage()
  const scripts: string[] = []
  page.on('request', (r) => {
    if (r.resourceType() === 'script') scripts.push(new URL(r.url()).pathname)
  })
  // A page of the game's site that knows nothing about p3p2.
  await page.goto(`${GAME}/index.html`)
  await page.addScriptTag({ url: '/dist/p3p2.iife.js' })
  const result = await page.evaluate(async (roomUrl) => {
    type Client = { host(url: string, o: { name: string }): Promise<{ self: { name: string }; isHost: boolean; inviteUrl: string }> }
    const P3P2 = (window as unknown as { P3P2: (new (o: object) => Client) & { fromUrl(p: string, h: string): unknown } }).P3P2
    const parsed = P3P2.fromUrl('room', 'https://game.example.com/?room=p3p2.example.com/789xyz0abc')
    const p3p2 = new P3P2({ game: { id: 'script-tag', version: '1.0.0' } })
    const room = await p3p2.host(roomUrl, { name: 'Ida' })
    return { parsed, name: room.self.name, isHost: room.isHost, invite: room.inviteUrl }
  }, owner.roomUrl)
  expect(result.parsed).toEqual({ server: 'https://p3p2.example.com', code: '789xyz0abc' })
  expect(result.name).toBe('Ida')
  expect(result.isHost).toBe(true)
  expect(result.invite).toMatch(new RegExp(`^${GAME}/index.html\\?room=${inInvite(server.url)}/[0-9a-z]{10}$`))
  await expect(page.getByLabel('Invite link', { exact: true })).toHaveValue(result.invite)
  expect(scripts).toEqual(['/dist/p3p2.iife.js'])
  await context.close()
  await owner.close()
})

test('a game with a button of its own: the panel shows none, and opens when the game says', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${GAME}/index.html`)
  await page.addScriptTag({ url: '/dist/p3p2.iife.js' })
  await page.evaluate(() => {
    const w = window as unknown as { P3P2: new (o: object) => { open(): Promise<void> }; p3p2: { open(): Promise<void> } }
    w.p3p2 = new w.P3P2({ game: { id: 'own-button', version: '1.0.0' }, ui: { button: false } })
  })
  // The 👥 button, and not the one in the panel whose words happen to contain its name.
  const button = page.getByRole('button', { name: 'Multiplayer', exact: true })
  await expect(button).toHaveCount(0)

  await page.evaluate(() => (window as unknown as { p3p2: { open(): Promise<void> } }).p3p2.open())
  await expect(page.getByLabel('Room URL')).toBeVisible()
  await expect(button).toHaveCount(0)
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByLabel('Room URL')).toBeHidden()
  await expect(button).toHaveCount(0)
  await context.close()
})
