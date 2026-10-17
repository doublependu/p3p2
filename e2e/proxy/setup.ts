// E2E_PROXY=1: starts deploy/docker-compose.yml, with the server built from this checkout
// (docker-compose.build.yml) and the test sites laid over it, and takes it down again when the tests
// are done. See playwright.config.ts.

import { execFileSync } from 'node:child_process'
import { request } from 'node:https'
import { join } from 'node:path'
import { PASSWORD, PROXY_SERVER as SERVER } from '../playwright.config.ts'

const ROOT = join(import.meta.dirname, '..', '..')

/** A project of its own, so that `down -v` can never reach the volumes of a real `p3p2`. */
function compose(...args: string[]): void {
  execFileSync(
    'docker',
    ['compose', '--progress', 'quiet', '-p', 'p3p2-e2e', '-f', join(ROOT, 'deploy', 'docker-compose.yml'), '-f', join(ROOT, 'deploy', 'docker-compose.build.yml'), '-f', join(ROOT, 'e2e', 'proxy', 'docker-compose.yml'), ...args],
    {
      env: { ...process.env, P3P2_DOMAIN: new URL(SERVER).hostname, P3P2_CADDYFILE: '../e2e/proxy/Caddyfile', E2E_PASSWORD: PASSWORD },
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  )
}

/** Asks Caddy on this machine for the server's /healthz. Node, unlike a browser, has to be told where *.localhost is. */
function healthy(): Promise<boolean> {
  const { hostname } = new URL(SERVER)
  return new Promise((resolve) => {
    const req = request(
      { host: '127.0.0.1', servername: hostname, headers: { host: hostname }, path: '/healthz', rejectUnauthorized: false, timeout: 1000 },
      (res) => {
        res.resume()
        resolve(res.statusCode === 200)
      },
    )
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(false))
    req.end()
  })
}

export default async function setup(): Promise<() => void> {
  // Whatever an interrupted run left behind would bring its rooms along.
  compose('down', '-v', '--remove-orphans')
  compose('up', '-d', '--build', '--wait')
  const deadline = Date.now() + 20_000
  while (!(await healthy())) {
    if (Date.now() > deadline) {
      compose('down', '-v', '--remove-orphans')
      throw new Error(`${SERVER}/healthz did not answer through Caddy in 20 s`)
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return () => compose('down', '-v', '--remove-orphans')
}
