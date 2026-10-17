// The turns example: noughts and crosses kept in the room's log alone. Two take the seats, a third watches, an op
// against the rules changes nothing anywhere, and a game waits for a player who left.

import type { Page } from '@playwright/test'
import { GAME } from '../playwright.config.ts'
import { createRoom, host, join, player } from './helpers.ts'
import { expect, test } from './fixtures.ts'

const TURNS = `${GAME}/turns.html`

const cells = (page: Page) => page.locator('#board button').allTextContents()
const cell = (page: Page, i: number) => page.getByRole('button', { name: `Cell ${i + 1}`, exact: true })

test('two players take turns, a third watches, and every page has the same board', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Noughts', TURNS)
  const ada = await player(browser, TURNS)
  const invite = await host(ada.page, owner.roomUrl, 'Ada')
  await ada.page.locator('p3p2-panel').getByRole('button', { name: 'Close' }).click()
  await expect(ada.page.locator('#state')).toContainText('playing X')
  const grace = await join(browser, invite, 'Grace')
  await expect(grace.page.locator('#state')).toContainText('playing O')
  const edsger = await join(browser, invite, 'Edsger')
  await expect(edsger.page.locator('#state')).toContainText('watching')
  const pages = [ada.page, grace.page, edsger.page]

  // Out of turn, or watching: the cells cannot be pressed. Sent anyway, the op changes nothing.
  await expect(cell(grace.page, 0)).toBeDisabled()
  await expect(cell(edsger.page, 0)).toBeDisabled()
  await edsger.page.evaluate(() => (window as unknown as { p3p2: { room: { log: { submit(op: unknown): void } } } }).p3p2.room.log.submit({ t: 'move', n: 1, i: 0 }))

  for (const [page, i] of [[ada.page, 4], [grace.page, 0], [ada.page, 2], [grace.page, 6], [ada.page, 3], [grace.page, 5], [ada.page, 1], [grace.page, 7], [ada.page, 8]] as const) {
    await cell(page, i).click()
    await expect(cell(page, i)).not.toHaveText('')
  }
  for (const page of pages) {
    await expect.poll(() => cells(page)).toEqual(['O', 'X', 'X', 'X', 'X', 'O', 'O', 'O', 'X'])
    await expect(page.locator('#state')).toContainText('A draw.')
  }

  // The next game: the players change places.
  await grace.page.getByRole('button', { name: 'Next game' }).click()
  await expect(grace.page.locator('#state')).toContainText('playing X')
  await expect(ada.page.locator('#state')).toContainText('playing O')

  // Grace moves, and Ada closes the page. The move she owes waits for her, and is there when she is back.
  await cell(grace.page, 4).click()
  await expect.poll(() => cells(ada.page)).toEqual(['', '', '', '', 'X', '', '', '', ''])
  await ada.page.close()
  const back = await ada.context.newPage()
  await back.goto(invite)
  await back.getByLabel('Your name').fill('Ada')
  await back.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(back.locator('#state')).toContainText('playing O. Your move.')
  await expect.poll(() => cells(back)).toEqual(['', '', '', '', 'X', '', '', '', ''])

  for (const p of [ada, grace, edsger]) await p.context.close()
  await owner.close()
})
