// The cards example: a host deals each player a card in one message (`room.sendEach`), and no page
// gets anybody else's card until it is shown.

import type { Page } from '@playwright/test'
import { GAME } from '../playwright.config.ts'
import { createRoom, host, join, player } from './helpers.ts'
import { expect, test } from './fixtures.ts'

const CARDS = `${GAME}/cards.html`

/** The faces on this page's table, in the order of the members: a card, 🂠 for one dealt face down, – for none. */
const faces = (page: Page) => page.locator('#table .card').allTextContents()

/** Counts the `card` messages this page is given, from now on. */
const counting = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { p3p2: { room: { on(ch: string, h: () => void): void } }; cards: number }
    w.cards = 0
    w.p3p2.room.on('card', () => w.cards++)
  })
const counted = (page: Page) => page.evaluate(() => (window as unknown as { cards: number }).cards)

test('the host deals each player a card nobody else sees, in one message, until it is shown', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Card table', CARDS)
  const ada = await player(browser, CARDS)
  const invite = await host(ada.page, owner.roomUrl, 'Ada')
  await ada.page.locator('p3p2-panel').getByRole('button', { name: 'Close' }).click()
  const grace = await join(browser, invite, 'Grace')
  const edsger = await join(browser, invite, 'Edsger')
  const pages = [ada.page, grace.page, edsger.page]
  for (const page of pages) await expect(page.locator('#table li')).toHaveCount(3)
  await counting(grace.page)
  await counting(edsger.page)

  await ada.page.getByRole('button', { name: 'Deal' }).click()
  // Each sees its own card and the others' backs.
  const card = /^(A|[2-9]|10|J|Q|K)[♠♥♦♣]$/
  for (const [i, page] of pages.entries()) {
    await expect.poll(() => faces(page)).toHaveLength(3)
    await expect.poll(async () => (await faces(page)).filter((f) => card.test(f)).length).toBe(1)
    await expect.poll(async () => (await faces(page)).filter((f) => f === '🂠').length).toBe(2)
    expect(card.test((await faces(page))[i]!)).toBe(true)
  }
  // Three different cards, and each guest was sent exactly one: its own.
  const own = await Promise.all(pages.map(async (page, i) => (await faces(page))[i]))
  expect(new Set(own).size).toBe(3)
  expect([await counted(grace.page), await counted(edsger.page)]).toEqual([1, 1])

  // Grace shows hers: now everybody has it.
  await grace.page.getByRole('button', { name: 'Show my card' }).click()
  for (const page of pages) await expect.poll(async () => (await faces(page))[1]).toBe(own[1])
  expect((await faces(edsger.page))[0]).toBe('🂠')

  for (const p of [ada, grace, edsger]) await p.context.close()
  await owner.close()
})
