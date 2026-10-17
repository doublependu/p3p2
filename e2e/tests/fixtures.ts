// The tests' `test`: Playwright's, with a p3p2 server of the test's own. Each test that asks for `server` gets one,
// on a port of its worker's, with the default settings unless it names others:
//
//   test.use({ settings: { P3P2_MAX_LOG_BYTES: '16384' } })    // a small log, for every test of the file
//   test.use({ onDisk: true })                                  // a database in a folder, for server.restart()

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test as base } from '@playwright/test'
import { HOST, PASSWORD, PROXY, PROXY_SERVER, PROXY_SETTINGS, SERVER_KIND, STATS_TOKEN } from '../playwright.config.ts'
import { startTestServer, type TestServer } from '../tools/server.ts'

export { expect } from '@playwright/test'
export type { TestServer }

/** The first of the tests' ports. Each worker has its own: 18100, 18101, … */
export const PORTS = 18100

interface Options {
  /** P3P2_* settings for the test's server, over the default ones. */
  settings: Record<string, string>
  /** Keep the server's database in a folder of the test's own, which a restart opens again. */
  onDisk: boolean
}

/** Behind the proxy: the one server of the containers, which a test cannot stop. */
const proxied: TestServer = {
  url: PROXY_SERVER,
  port: 443,
  kind: 'image',
  dataDir: null,
  start: () => Promise.reject(new Error('The server behind the proxy cannot be stopped and started by a test')),
  stop: () => Promise.resolve(),
  restart: () => Promise.reject(new Error('The server behind the proxy cannot be stopped and started by a test')),
}

export const test = base.extend<Options & { server: TestServer }>({
  settings: [{}, { option: true }],
  onDisk: [false, { option: true }],
  server: async ({ settings, onDisk }, use, info) => {
    // Behind the proxy every test shares one server, unless it has to restart it: then it gets one of its own, on
    // this machine, as before the proxy (a page on https may use http on 127.0.0.1).
    if (PROXY && !onDisk) {
      const own = Object.entries(settings).filter(([name, value]) => PROXY_SETTINGS[name] !== value)
      info.skip(own.length > 0, `needs ${own.map(([name]) => name).join(', ')} of its own, which the server behind the proxy does not have`)
      await use(proxied)
      return
    }
    const dataDir = onDisk ? mkdtempSync(join(tmpdir(), 'p3p2-e2e-')) : null
    const server = await startTestServer({
      kind: PROXY ? 'checkout' : SERVER_KIND,
      host: HOST,
      port: PORTS + info.parallelIndex,
      settings,
      dataDir,
      password: PASSWORD,
      statsToken: STATS_TOKEN,
    })
    try {
      await use(server)
    } finally {
      await server.stop()
      if (dataDir) rmSync(dataDir, { recursive: true, force: true })
    }
  },
})
