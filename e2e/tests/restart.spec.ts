// A server that is stopped and started again, as an update does. It has a database of its own,
// on disk, and is started here: the tests' own server keeps everything in memory.

import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as path } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { HOST, PASSWORD } from '../playwright.config.ts'
import { CHAT, createRoom, host, join, player } from './helpers.ts'

const PORT = 18090
const SERVER = `http://${HOST}:${PORT}`

/** Node itself, not `npm run`: the process that is stopped has to be the server. */
async function start(dataDir: string): Promise<ChildProcess> {
  const server = spawn(process.execPath, [path(import.meta.dirname, '..', '..', 'server', 'src', 'main.ts')], {
    env: {
      ...process.env,
      P3P2_PORT: String(PORT),
      P3P2_HOST: HOST,
      P3P2_PUBLIC_URL: SERVER,
      P3P2_DATA_DIR: dataDir,
      P3P2_OWNER_PASSWORD: PASSWORD,
      P3P2_LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  await expect
    .poll(async () => {
      if (server.exitCode !== null) throw new Error(`the server exited with ${server.exitCode}`)
      return fetch(`${SERVER}/healthz`).then(
        (res) => res.ok,
        () => false,
      )
    })
    .toBe(true)
  return server
}

function stop(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    server.once('exit', () => resolve())
    server.kill('SIGTERM')
  })
}

test('the server restarts: everyone comes back by themselves, to the same room and its saved world', async ({ browser }) => {
  const dataDir = mkdtempSync(path(tmpdir(), 'p3p2-e2e-'))
  let server = await start(dataDir)
  try {
    const owner = await createRoom(browser, 'Restart room', CHAT, SERVER)
    const ada = await player(browser)
    const invite = await host(ada.page, owner.roomUrl, 'Ada')
    const grace = await join(browser, invite, 'Grace')
    await expect(ada.page.locator('#state')).toContainText('2 here')
    const world = await ada.page.locator('#world').textContent()
    expect(world).toMatch(/^World seed: \d+, made by Ada$/)

    // The server says goodbye to everyone on its way down. Their pages keep trying.
    await stop(server)
    const status = (page: Page) => page.evaluate(() => (window as unknown as { p3p2: { room: { status: string } | null } }).p3p2.room?.status)
    for (const p of [ada, grace]) await expect.poll(() => status(p.page)).toBe('reconnecting')

    server = await start(dataDir)
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
  } finally {
    await stop(server)
    rmSync(dataDir, { recursive: true, force: true })
  }
})
