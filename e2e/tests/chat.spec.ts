import type { Page, WebSocketRoute } from '@playwright/test'
import { GAME, OTHER_SITE } from '../playwright.config.ts'
import { accept, CHAT, createRoom, end, host, inInvite, join, kick, type Player, player, scan, selfId } from './helpers.ts'
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
  await expect(page.getByRole('dialog', { name: 'Multiplayer' })).toBeVisible()
  expect(scripts.sort()).toEqual(['/dist/p3p2-core.js', '/dist/p3p2-panel.js', '/dist/p3p2.js'])
  await context.close()
})

test('a host and two guests chat, and share a world', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Friday games')
  const ada = await player(browser)
  const invite = await host(ada.page, owner.invite, 'Ada')
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
    const invite = await host(page, owner.invite, 'Ada')

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
  const invite = await host(ada.page, owner.invite, 'Ada')

  // The invite, opened in the same game on another site.
  const guest = await player(browser, invite.replace(GAME, OTHER_SITE))
  await expect(guest.page.getByRole('status')).toContainText(`isn't set up for ${OTHER_SITE}`)
  await expect(guest.page.getByRole('button', { name: 'Join', exact: true })).toBeDisabled()
  await guest.page.getByRole('button', { name: 'Play alone' }).click()
  await expect(guest.page.locator('#state')).toContainText('Playing alone')
  expect(new URL(guest.page.url()).search).toBe('')

  for (const p of [ada, guest]) await p.context.close()
  await owner.close()
})

test('a room is for the game first played in it: another game on the same site is turned away, until the owner lets it in', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'One game room')
  const ada = await player(browser)
  const invite = await host(ada.page, owner.invite, 'Ada')

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
  const invite = await host(page, owner.invite, 'Ada')
  await page.locator('p3p2-panel').getByRole('button', { name: 'Share' }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { shared: { url: string }[] }).shared.map((s) => s.url))).toEqual([invite])
  // Without one, there is no Share button at all.
  const plain = await player(browser)
  await host(plain.page, owner.invite, 'Grace')
  await expect(plain.page.locator('p3p2-panel').getByRole('button', { name: 'Share' })).toBeHidden()
  for (const c of [context, plain.context]) await c.close()
  await owner.close()
})

test('an invite that was replaced is refused; the new one works', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Renewed room')
  const ada = await player(browser)
  const old = await host(ada.page, owner.invite, 'Ada')

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
  const invite = await host(ada.page, owner.invite, 'Ada')
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
  // Still in the room, with the link to pass on.
  await ada.page.getByRole('button', { name: 'Multiplayer' }).click()
  await expect(ada.page.getByLabel('Invite link', { exact: true })).toHaveValue(invite)

  // Nobody saw anyone leave.
  await grace.page.getByRole('button', { name: 'Multiplayer' }).click()
  await expect(grace.page.locator('.log')).not.toContainText('left')
  await expect(grace.page.locator('.members li')).toHaveCount(2)

  for (const p of [ada, grace]) await p.context.close()
  await owner.close()
})

test("leave; and the owner's Kick and End session, in the portal, where the players' panels have neither", async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Bouncer room')
  const ada = await player(browser)
  const invite = await host(ada.page, owner.invite, 'Ada')
  const grace = await join(browser, invite, 'Grace')
  const edsger = await join(browser, invite, 'Edsger')
  const barbara = await join(browser, invite, 'Barbara')

  await grace.page.getByRole('button', { name: 'Multiplayer' }).click()
  await grace.page.getByRole('button', { name: 'Leave' }).click()
  await expect(grace.page.locator('#state')).toHaveText('Playing alone again (left).')
  await expect(ada.page.locator('#state')).toContainText('3 here')
  await expect(ada.page.locator('.log')).toContainText('Grace left')

  // Everybody came in through the invite, the first one too: nobody's panel can remove a player or end the game.
  await barbara.page.getByRole('button', { name: 'Multiplayer' }).click()
  for (const p of [ada, barbara]) {
    await expect(p.page.getByRole('button', { name: /^Remove/ })).toHaveCount(0)
    await expect(p.page.getByRole('button', { name: 'End for everyone' })).toHaveCount(0)
  }

  await kick(owner, 'Edsger')
  await expect(edsger.page.locator('#state')).toHaveText('Playing alone again (kicked).')
  await expect(edsger.page.getByRole('status')).toHaveText('You were removed from the room.')
  await expect(ada.page.locator('#state')).toContainText('2 here')

  await end(owner)
  await expect(barbara.page.locator('#state')).toHaveText('Playing alone again (ended).')
  await expect(barbara.page.getByRole('status')).toHaveText('The session was ended.')
  await expect(ada.page.locator('#state')).toHaveText('Playing alone again (ended).')

  for (const p of [ada, grace, edsger, barbara]) await p.context.close()
  await owner.close()
})

test('the host role moves on when the host leaves', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Handover room')
  const ada = await player(browser)
  const invite = await host(ada.page, owner.invite, 'Ada')
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
  await host(ada.page, owner.invite, 'Ada')
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
  await host(page, owner.invite, 'Ada')
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
  const invite = await host(ada.page, owner.invite, 'Ada')

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
  const invite = await host(ada.page, owner.invite, 'Ada')
  await ada.page.getByRole('button', { name: 'Copy' }).click()
  // With the Clipboard API: copied. Without it (plain http): the old command, or at least the
  // link is selected, ready for Ctrl+C or a long press.
  await expect(ada.page.getByRole('button', { name: /^(Copied|Selected)$/ })).toBeVisible()
  const selected = await ada.page.getByLabel('Invite link', { exact: true }).evaluate((el: HTMLInputElement) => el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0))
  if (await ada.page.getByRole('button', { name: 'Selected' }).count()) expect(selected).toBe(invite)
  await ada.context.close()
  await owner.close()
})

test('chat that comes while the panel is closed is counted on the multiplayer button', { tag: '@this-client' }, async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Unread room')
  const ada = await player(browser)
  const invite = await host(ada.page, owner.invite, 'Ada')
  const grace = await join(browser, invite, 'Grace')
  await ada.page.getByRole('button', { name: 'Close' }).click()
  const pill = (p: Player) => p.page.locator('p3p2-panel').getByRole('button', { name: /^Multiplayer/ })
  const badge = (p: Player) => p.page.locator('p3p2-panel .unread')
  // On the button's top-right corner, clear of the count of players beside the mark.
  const onCorner = async (p: Player) => {
    const b = (await badge(p).boundingBox())!
    const count = (await p.page.locator('p3p2-panel .mark + span').boundingBox())!
    const button = (await pill(p).boundingBox())!
    const apart = b.x >= count.x + count.width || count.x >= b.x + b.width || b.y >= count.y + count.height || count.y >= b.y + b.height
    expect(apart).toBe(true)
    expect(b.x + b.width).toBeGreaterThan(button.x + button.width)
    expect(b.y).toBeLessThan(button.y)
  }
  let said = 0
  const say = async (lines: number) => {
    for (let i = 0; i < lines; i++) {
      await ada.page.locator('#text').fill(`line ${++said}`)
      await ada.page.locator('#send').click()
    }
    await expect(grace.page.locator('#log li')).toHaveCount(said)
  }

  await say(3)
  await expect(badge(grace)).toHaveText('3')
  await expect(pill(grace)).toHaveAccessibleName('Multiplayer, 3 unread messages')
  await onCorner(grace)
  // Ada's own lines are no news to her.
  await expect(badge(ada)).toBeHidden()
  await expect(pill(ada)).toHaveAccessibleName('Multiplayer')

  await say(7)
  await expect(badge(grace)).toHaveText('9+')
  await expect(pill(grace)).toHaveAccessibleName('Multiplayer, 10 unread messages')
  await onCorner(grace)

  // Opening the panel reads them; closing it again starts from none.
  await pill(grace).click()
  await expect(grace.page.locator('p3p2-panel .log li', { hasText: 'line 10' })).toBeVisible()
  await grace.page.getByRole('button', { name: 'Close' }).click()
  await expect(badge(grace)).toBeHidden()
  await expect(pill(grace)).toHaveAccessibleName('Multiplayer')
  await say(1)
  await expect(badge(grace)).toHaveText('1')
  await expect(pill(grace)).toHaveAccessibleName('Multiplayer, 1 unread message')

  for (const p of [ada, grace]) await p.context.close()
  await owner.close()
})

/** Puts the room on the server's front page, without its link's last `hidden` characters, and returns them. */
async function onFrontPage(portal: Page, hidden: number): Promise<string> {
  await portal.getByLabel("On this server's front page").selectOption(String(hidden))
  await portal.getByRole('button', { name: 'Save', exact: true }).click()
  const chars = portal.locator('b.mono')
  await expect(chars).toHaveText(new RegExp(`^[0-9a-z]{${hidden}}$`))
  return (await chars.textContent())!
}

test("the owner's room page has an invite link before anyone has played, and no room URL; the link opens the game in a new tab", async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Fresh room')
  await expect(owner.portal.getByLabel('Room URL')).toHaveCount(0)
  await expect(owner.portal.getByText('everyone joins this room through it, you too')).toBeVisible()
  const link = await owner.portal.getByLabel('Invite link', { exact: true }).inputValue()
  expect(link).toMatch(new RegExp(`^${CHAT}\\?room=${inInvite(server.url)}/[0-9a-z]{10}$`))
  const [tab] = await Promise.all([owner.portal.context().waitForEvent('page'), owner.portal.getByRole('link', { name: 'Open', exact: true }).click()])
  await expect(tab).toHaveURL(link)
  await expect(tab.locator('p3p2-panel')).toContainText('Join Fresh room on')
  await expect(tab.locator('p3p2-panel')).toContainText('Nobody is here yet')
  await accept(tab, 'Ada')
  await owner.close()
})

test('a room the owner puts on the front page as it is made is there at once', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Straight in', CHAT, { front: 0 })
  await expect(owner.portal.getByLabel("On this server's front page")).toHaveValue('0')
  const visitor = await player(browser, `${server.url}/`)
  await expect(visitor.page.getByLabel('Invite link to Straight in')).toHaveValue(owner.invite)
  await visitor.context.close()
  await owner.close()
})

test("a friend who opens the server's address finds the room, types the characters its link leaves out, and plays with the host", { tag: '@this-client' }, async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Friday night')
  const hidden = await onFrontPage(owner.portal, 4)
  const ada = await player(browser)
  const invite = await host(ada.page, owner.invite, 'Ada')
  expect(invite.slice(-4)).toBe(hidden)
  const shown = `${invite.slice(0, -4)}----`

  // Only the server's address was passed on.
  const grace = await player(browser, `${server.url}/`)
  await expect(grace.page.getByRole('heading', { name: 'Friday night' })).toBeVisible()
  await expect(grace.page.getByLabel('Invite link to Friday night')).toHaveValue(shown)
  await expect(grace.page.getByText('The game asks for the last 4 characters.')).toBeVisible()
  // Play opens the game in a new tab, and the front page stays.
  const [tab] = await Promise.all([grace.context.waitForEvent('page'), grace.page.getByRole('link', { name: 'Play', exact: true }).click()])
  await expect(tab).toHaveURL(shown)
  await expect(grace.page.getByRole('heading', { name: 'Friday night' })).toBeVisible()
  await grace.page.close()
  grace.page = tab

  const chars = grace.page.getByLabel('The last 4 characters')
  await expect(chars).toBeFocused()
  const join = grace.page.getByRole('button', { name: 'Join', exact: true })
  await chars.fill((hidden[0] === '0' ? '1' : '0') + hidden.slice(1))
  await expect(grace.page.getByRole('status')).toHaveText("Those aren't the right characters.")
  await expect(join).toBeDisabled()
  // The right ones, as they might be read out over the phone: in capitals, with a space.
  await chars.fill(`${hidden.slice(0, 2)} ${hidden.slice(2)}`.toUpperCase())
  await expect(grace.page.locator('p3p2-panel')).toContainText('Join Friday night on')
  await expect(grace.page.locator('p3p2-panel')).toContainText('Hosted by Ada · 1 player')
  await accept(grace.page, 'Grace')
  await expect(ada.page.locator('#state')).toContainText('2 here')
  await expect(grace.page.locator('#world')).toHaveText((await ada.page.locator('#world').textContent())!)

  // In the room, Grace has the whole link to pass on.
  await grace.page.getByRole('button', { name: 'Multiplayer' }).click()
  await expect(grace.page.getByLabel('Invite link', { exact: true })).toHaveValue(invite)

  for (const p of [ada, grace]) await p.context.close()
  await owner.close()
})

test('a game with its own Join? puts in the characters the link leaves out itself', { tag: '@this-client' }, async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Own menu room')
  const hidden = await onFrontPage(owner.portal, 4)
  const ada = await player(browser)
  await host(ada.page, owner.invite, 'Ada')
  const visitor = await player(browser, `${server.url}/`)
  const shown = new URL(await visitor.page.getByLabel('Invite link to Own menu room').inputValue()).searchParams.get('room')!

  // A page of the game's site with a menu of its own, opened with what the front page shows.
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${GAME}/index.html?room=${shown}`)
  await page.addScriptTag({ url: '/dist/p3p2.iife.js' })
  const result = await page.evaluate(async (chars) => {
    type Invite = { server: string; code: string }
    type Room = { self: { name: string }; members: unknown[]; inviteUrl: string }
    type Client = { invite: Invite | null; peek(i: Invite): Promise<unknown>; join(i: Invite, o: object): Promise<Room> }
    const P3P2 = (window as unknown as { P3P2: new (o: object) => Client }).P3P2
    const p3p2 = new P3P2({ game: { id: 'chat-example', version: '1.0.0' }, ui: false })
    const invite = p3p2.invite!
    const code = (e: { code: string }) => e.code
    const peek = await p3p2.peek(invite).then(() => '', code)
    const join = await p3p2.join(invite, { ask: false }).then(() => '', code)
    // As docs/api.md says: the characters in place of the dashes.
    const room = await p3p2.join({ ...invite, code: invite.code.replace(/-+$/, '') + chars }, { ask: false, name: 'Grace' })
    return { code: invite.code, peek, join, name: room.self.name, members: room.members.length, inviteUrl: room.inviteUrl }
  }, hidden)
  expect(result.code).toMatch(/^[0-9a-z]{6}----$/)
  expect([result.peek, result.join]).toEqual(['hidden', 'hidden'])
  expect([result.name, result.members]).toEqual(['Grace', 2])
  expect(result.inviteUrl).toBe(`${GAME}/index.html?room=${inInvite(server.url)}/${result.code.slice(0, 6)}${hidden}`)
  await expect(ada.page.locator('#state')).toContainText('2 here')

  for (const c of [ada.context, visitor.context, context]) await c.close()
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
  const result = await page.evaluate(async (invite) => {
    type Room = { self: { name: string }; isHost: boolean; inviteUrl: string }
    type Client = { join(i: unknown, o: { ask: boolean; name: string }): Promise<Room> }
    const P3P2 = (window as unknown as { P3P2: (new (o: object) => Client) & { fromUrl(p: string, h: string): unknown } }).P3P2
    const parsed = P3P2.fromUrl('room', 'https://game.example.com/?room=p3p2.example.com/789xyz0abc')
    const p3p2 = new P3P2({ game: { id: 'script-tag', version: '1.0.0' } })
    const room = await p3p2.join(P3P2.fromUrl('room', invite), { ask: false, name: 'Ida' })
    return { parsed, name: room.self.name, isHost: room.isHost, invite: room.inviteUrl }
  }, owner.invite)
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
  // The multiplayer button, and not the one in the panel whose words happen to contain its name.
  const button = page.getByRole('button', { name: 'Multiplayer', exact: true })
  await expect(button).toHaveCount(0)

  await page.evaluate(() => (window as unknown as { p3p2: { open(): Promise<void> } }).p3p2.open())
  const panel = page.getByRole('dialog', { name: 'Multiplayer' })
  await expect(panel).toBeVisible()
  await expect(button).toHaveCount(0)
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(panel).toBeHidden()
  await expect(button).toHaveCount(0)
  await context.close()
})

test('outside a room the panel is powered by p3p2, says to open an invite link from a server, has no room URL, and links to p3p2.me in a new tab', { tag: '@this-client' }, async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(CHAT)
  await page.getByRole('button', { name: 'Multiplayer' }).click()
  const panel = page.getByRole('dialog', { name: 'Multiplayer' })
  await expect(panel.locator('header b')).toHaveText('Multiplayer – Powered by p3p2')
  // The name in a face of its own: a bold serif, upright, beside the panel's plain sans-serif.
  const name = await panel.locator('header .wordmark').evaluate((el) => {
    const s = getComputedStyle(el)
    return { style: s.fontStyle, weight: s.fontWeight, serif: s.fontFamily.endsWith('serif') && !s.fontFamily.endsWith('sans-serif') }
  })
  expect(name).toEqual({ style: 'normal', weight: '700', serif: true })
  await expect(panel.locator('p')).toHaveText([
    'Share one small p3p2 relay server.',
    'Already have one? Open the invite link from the server.',
    'No server yet? p3p2.me says how to get one.',
  ])
  await expect(panel.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByLabel('Room URL')).toHaveCount(0)
  // Where to get a server, in a tab of its own: the game stays open. Not followed: the tests use no site but their own.
  const site = panel.getByRole('link', { name: 'p3p2.me' })
  await expect(site).toHaveAttribute('href', 'https://p3p2.me/')
  await expect(site).toHaveAttribute('target', '_blank')
  await context.close()
})

test('two tabs of one browser are one player: the newer takes the place, and the older says why', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Two tabs room')
  const ada = await player(browser)
  const invite = await host(ada.page, owner.invite, 'Ada')
  const grace = await join(browser, invite, 'Grace')
  const id = await selfId(grace.page)
  // The same invite, opened again in another tab of Grace's browser.
  const tab = await grace.context.newPage()
  await tab.goto(invite)
  await accept(tab, 'Grace')
  expect(await selfId(tab)).toBe(id)
  await expect(grace.page.locator('#state')).toHaveText('Playing alone again (replaced).')
  await expect(grace.page.getByRole('status')).toHaveText('This room is now open in another tab.')
  // The others saw nobody come or go.
  await expect(ada.page.locator('#state')).toContainText('2 here')
  await expect(ada.page.locator('.members li')).toHaveCount(2)
  await expect(ada.page.locator('.log li', { hasText: 'Grace joined' })).toHaveCount(1)
  await expect(ada.page.locator('.log')).not.toContainText('Grace left')
  for (const p of [ada, grace]) await p.context.close()
  await owner.close()
})

test('a player who picks a name already in the room is asked for another, and gets in with it', { tag: '@this-client' }, async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Names room')
  const ada = await player(browser)
  const invite = await host(ada.page, owner.invite, 'Ada')
  const other = await player(browser, invite)
  const join = other.page.getByRole('button', { name: 'Join', exact: true })
  const name = other.page.getByLabel('Your name')
  await expect(join).toBeEnabled()
  await name.fill('ADA')
  await join.click()
  await expect(other.page.getByRole('status')).toHaveText('Somebody in this room already has that name. Choose another.')
  await expect(name).toBeFocused()
  await expect(ada.page.locator('#state')).toContainText('1 here')
  // Leaving the field shows the name as it will be: without what a name cannot have.
  await name.fill('Ada 🎮 2')
  await name.blur()
  await expect(name).toHaveValue('Ada 2')
  await accept(other.page, 'Ada 2')
  await expect(ada.page.locator('#state')).toContainText('2 here')
  for (const p of [ada, other]) await p.context.close()
  await owner.close()
})
