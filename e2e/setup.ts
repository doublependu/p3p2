// What a run of the browser tests needs before its first test (Playwright's global setup):
//
// - Firefox and WebKit, which some tests start beside Chrome. One that cannot start is installed (with the system
//   libraries it needs, in CI), and one that still cannot fails the run;
// - the client under test: the checkout's, packed, or the tarball E2E_CLIENT names (tools/clients.ts);
// - the examples that Vite builds, built with that client outside the repository, and kept for the next run;
// - the two sites the examples are served on, with that client at /dist/;
// - for the image run, the published image.
//
// Behind the proxy (E2E_PROXY=1) Caddy serves the sites instead, with this checkout's client/dist: see proxy/setup.ts.

import { execFileSync } from 'node:child_process'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { firefox, webkit } from '@playwright/test'
import { buildExamples } from '../examples/build.ts'
import { serveExamples } from '../examples/serve.ts'
import { PROXY, SERVER_KIND } from './playwright.config.ts'
import proxySetup from './proxy/setup.ts'
import { CACHE, clientUnderTest } from './tools/clients.ts'
import { IMAGE } from './tools/server.ts'

const CLI = join(import.meta.dirname, '..', 'node_modules', 'playwright', 'cli.js')

/** Starts each engine once, and installs the ones that will not. */
async function engines(): Promise<void> {
  const all = { firefox, webkit }
  for (const [name, type] of Object.entries(all)) {
    const starts = () =>
      type.launch().then(
        async (browser) => {
          await browser.close()
          return null
        },
        (err: Error) => err,
      )
    if (!(await starts())) continue
    console.log(`[setup] ${name} does not start here; installing it`)
    execFileSync(process.execPath, [CLI, 'install', ...(process.env.CI ? ['--with-deps'] : []), name], { stdio: 'inherit' })
    const err = await starts()
    if (err) throw new Error(`${name} does not start on this machine, even after "playwright install": ${err.message}`)
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  const done: (() => unknown)[] = []
  await engines()
  if (PROXY) {
    done.push(await proxySetup())
  } else {
    const client = clientUnderTest()
    const built = buildExamples(client.tarball, join(CACHE, 'builds'))
    // For the tests, in every worker.
    process.env.E2E_CLIENT_DIR = client.dir
    process.env.E2E_CLIENT_VERSION = client.version
    process.env.E2E_PROJECTS = built.projects
    process.env.E2E_BUILD_IDS = JSON.stringify(built.ids)
    console.log(`[setup] client ${client.version}${process.env.E2E_CLIENT ? ` (${process.env.E2E_CLIENT})` : ', this checkout'}; examples built in ${built.dir}`)
    const roots = { dist: join(client.dir, 'dist'), builds: built.dir }
    const sites: Server[] = [await serveExamples(5181, roots), await serveExamples(5182, roots)]
    done.push(() => Promise.all(sites.map((s) => new Promise((resolve) => s.close(resolve)))))
  }
  if (SERVER_KIND === 'image') {
    try {
      execFileSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore' })
    } catch {
      execFileSync('docker', ['pull', '--quiet', IMAGE], { stdio: 'inherit' })
    }
  }
  return async () => {
    for (const end of done.reverse()) await end()
  }
}
