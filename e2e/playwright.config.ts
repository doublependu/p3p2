import { defineConfig } from '@playwright/test'

// Three local servers: the p3p2 server, the examples on the "game" origin, and the same
// examples on a second origin that no room accepts.
//
// E2E_HOST=<this machine's LAN address> runs everything over plain http on that address. Browsers
// do not treat such pages as secure contexts (no Clipboard API, for one), which is exactly what
// a phone on the same Wi-Fi gets. The default, 127.0.0.1, counts as secure.
//
// E2E_PROXY=1 runs the same tests against deploy/docker-compose.yml instead: the server in its
// container behind Caddy, and the examples on HTTPS sites of their own (proxy/). That is a
// deployed server as a browser meets it: https and wss, with a proxy in between. Caddy signs
// the certificates itself, so the browsers are told to accept them. Needs Docker, and ports 80
// and 443 of this machine.
export const PROXY = process.env.E2E_PROXY === '1'
export const HOST = PROXY ? '127.0.0.1' : (process.env.E2E_HOST ?? '127.0.0.1')
export const SERVER_PORT = PROXY ? 443 : 18080
export const SERVER = PROXY ? 'https://p3p2.localhost' : `http://${HOST}:${SERVER_PORT}`
export const GAME = PROXY ? 'https://game.localhost' : `http://${HOST}:5181`
export const OTHER_SITE = PROXY ? 'https://other.localhost' : `http://${HOST}:5182`
export const PASSWORD = 'e2e owner password'

/** The server's address with another port: where a lag proxy in front of it listens. */
export function serverAt(port: number): string {
  const url = new URL(SERVER)
  url.port = String(port)
  return url.origin
}

/** Lets the tests read the server's numbers (`/api/v1/stats`): what a game sends, and how late the server ran. */
export const STATS_TOKEN = 'e2e-stats-token-0123456789'

// Without a proxy: three servers on this machine, started here.
const local = [
  {
    command: 'node ../server/src/main.ts',
    url: `${SERVER}/healthz`,
    reuseExistingServer: false,
    env: {
      P3P2_PORT: String(SERVER_PORT),
      P3P2_HOST: HOST === '127.0.0.1' ? HOST : '0.0.0.0',
      P3P2_PUBLIC_URL: SERVER,
      P3P2_DATA_DIR: ':memory:',
      P3P2_OWNER_PASSWORD: PASSWORD,
      P3P2_LOG_LEVEL: 'warn',
      P3P2_STATS_TOKEN: STATS_TOKEN,
      // A log this small is full after a few dozen ops, so the tests see what happens then.
      P3P2_MAX_LOG_BYTES: '16384',
      // Every test makes a room of its own, and the server keeps them all: the tests are not held to the 50 of a default server.
      P3P2_MAX_ROOMS: '500',
    },
  },
  { command: 'node ../examples/serve.ts 5181', url: `${GAME}/chat.html`, reuseExistingServer: false },
  { command: 'node ../examples/serve.ts 5182', url: `${OTHER_SITE}/chat.html`, reuseExistingServer: false },
]

export default defineConfig({
  testDir: 'tests',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    // The Chrome installed on this machine; no browser download needed.
    channel: 'chrome',
    ignoreHTTPSErrors: PROXY,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Behind the proxy they are containers instead, started and removed by proxy/setup.ts.
  globalSetup: PROXY ? './proxy/setup.ts' : undefined,
  webServer: PROXY ? [] : local,
})
