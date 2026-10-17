// A server that is stopped and started again, as an update does. Its database is in a folder of the test's own.

import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import { CHAT, createRoom, host, join, player } from './helpers.ts'

test.use({ onDisk: true })

test('the server restarts: everyone comes back by themselves, to the same room and its saved world', async ({ browser, server }) => {
  const owner = await createRoom(browser, server, 'Restart room', CHAT)
  const ada = await player(browser)
  const invite = await host(ada.page, owner.roomUrl, 'Ada')
  const grace = await join(browser, invite, 'Grace')
  await expect(ada.page.locator('#state')).toContainText('2 here')
  const world = await ada.page.locator('#world').textContent()
  expect(world).toMatch(/^World seed: \d+, made by Ada$/)

  // The server says goodbye to everyone on its way down. Their pages keep trying.
  await server.stop()
  const status = (page: Page) => page.evaluate(() => (window as unknown as { p3p2: { room: { status: string } | null } }).p3p2.room?.status)
  for (const p of [ada, grace]) await expect.poll(() => status(p.page)).toBe('reconnecting')

  await server.start()
  // The page still says "2 here" from before, so it is the connection that tells who is back.
  for (const p of [ada, grace]) await expect.poll(() => status(p.page), { timeout: 20_000 }).toBe('open')
  for (const p of [ada, grace]) await expect(p.page.locator('#state')).toContainText('2 here')
  // Nobody was in the room when the first of them came back, so it is no longer certain who hosts.
  await expect
    .poll(async () => {
      const roles = await Promise.all([ada, grace].map((p) => p.page.locator('#state').textContent()))
      return roles.filter((text) => text?.includes('(the host)')).length
    })
    .toBe(1)

  // The room, its invite and its world were in the database. The talk goes on.
  for (const p of [ada, grace]) await expect(p.page.locator('#world')).toHaveText(world!)
  await grace.page.locator('#text').fill('are we back?')
  await grace.page.locator('#send').click()
  await expect(ada.page.locator('#log li')).toHaveText(['Grace: are we back?'])
  const late = await join(browser, invite, 'Edsger')
  await expect(late.page.locator('#world')).toHaveText(world!)

  for (const p of [ada, grace, late]) await p.context.close()
  await owner.close()
})
