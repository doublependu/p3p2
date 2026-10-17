import { defineConfig } from '@playwright/test'

// Every test starts a p3p2 server of its own (tests/fixtures.ts): the server's limits are per address, and every
// browser here is on the same one. Two static servers stay up for the whole run (setup.ts): the examples on the
// "game" origin, and the same examples on a second origin that no room accepts.
//
// E2E_HOST=<this machine's LAN address> runs everything over plain http on that address. Browsers
// do not treat such pages as secure contexts (no Clipboard API, for one), which is exactly what
// a phone on the same Wi-Fi gets. The default, 127.0.0.1, counts as secure.
//
// E2E_SERVER=image starts the published image (tools/server.ts) in place of the checkout's server.
//
// E2E_PROXY=1 runs the same tests against deploy/docker-compose.yml instead: the server in its
// container behind Caddy, and the examples on HTTPS sites of their own (proxy/). That is a
// deployed server as a browser meets it: https and wss, with a proxy in between. Caddy signs
// the certificates itself, so the browsers are told to accept them. Needs Docker, and ports 80
// and 443 of this machine. Every test then shares that one server.
export const PROXY = process.env.E2E_PROXY === '1'
export const HOST = PROXY ? '127.0.0.1' : (process.env.E2E_HOST ?? '127.0.0.1')
export const GAME = PROXY ? 'https://game.localhost' : `http://${HOST}:5181`
export const OTHER_SITE = PROXY ? 'https://other.localhost' : `http://${HOST}:5182`
export const PASSWORD = 'e2e owner password'
/** Behind the proxy: the one server every test is handed. */
export const PROXY_SERVER = 'https://p3p2.localhost'
/** The settings that server has (proxy/docker-compose.yml). A test that needs others is skipped there. */
export const PROXY_SETTINGS: Record<string, string> = { P3P2_MAX_LOG_BYTES: '16384', P3P2_MAX_ROOMS: '500' }
/** The server the tests start: the checkout's, or the published image. */
export const SERVER_KIND: 'checkout' | 'image' = process.env.E2E_SERVER === 'image' ? 'image' : 'checkout'

/** A server's address with another port: where a lag proxy in front of it listens. */
export function serverAt(server: string, port: number): string {
  const url = new URL(server)
  url.port = String(port)
  return url.origin
}

/** Lets the tests read the server's numbers (`/api/v1/stats`): what a game sends, and how late the server ran. */
export const STATS_TOKEN = 'e2e-stats-token-0123456789'

export default defineConfig({
  testDir: 'tests',
  timeout: 30_000,
  // Four at a time, here and in CI, whose runners have four cores. Tests that time something are tagged @alone,
  // and tools/run.ts runs those afterwards, one at a time.
  fullyParallel: true,
  workers: 4,
  reporter: [['list']],
  use: {
    // The Chrome installed on this machine; no browser download needed.
    channel: 'chrome',
    ignoreHTTPSErrors: PROXY,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // The engines, the client under test, the examples built with it, and the two sites: see setup.ts.
  globalSetup: './setup.ts',
})
