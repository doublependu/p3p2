// A p3p2 server for one browser test: the checkout's, as a process, or the published image, as a container. On a
// port of the test's own, with the test's settings, its data in memory or in a folder. It can be stopped and
// started again on the same folder, days later if asked, and as the other kind: that is how a server is updated.

import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { userInfo } from 'node:os'
import { join } from 'node:path'

export type ServerKind = 'checkout' | 'image'

/** The published image the image run starts. `latest` is the newest release. */
export const IMAGE = process.env.E2E_IMAGE || 'p3p2/p3p2:latest'

const MAIN = join(import.meta.dirname, '..', '..', 'server', 'src', 'main.ts')
const LATER = join(import.meta.dirname, 'later.mjs')

export interface ServerOptions {
  kind: ServerKind
  /** The address to listen on and to be reached at, and the port. */
  host: string
  port: number
  /** P3P2_* settings, over the tests' own. */
  settings: Record<string, string>
  /** A folder for the database, or null to keep everything in memory. */
  dataDir: string | null
  password: string
  statsToken: string
}

export interface TestServer {
  /** Where the browsers reach it, as a room URL names it. */
  readonly url: string
  readonly port: number
  readonly kind: ServerKind
  readonly dataDir: string | null
  /** Starts it again after `stop()`, on the same folder: `days` later than the real clock, and as `kind`. */
  start(options?: { days?: number; kind?: ServerKind }): Promise<void>
  stop(): Promise<void>
  /** Both: what an update does, or a server that comes back another day. */
  restart(options?: { days?: number; kind?: ServerKind }): Promise<void>
}

/** Every process and container this one started, so that a worker that goes down takes them with it. */
const running = new Set<() => void>()
process.once('exit', () => {
  for (const stop of running) stop()
})

function env(o: ServerOptions, days: number): Record<string, string> {
  return {
    P3P2_PUBLIC_URL: `http://${o.host}:${o.port}`,
    P3P2_DATA_DIR: o.dataDir ? '/data' : ':memory:',
    P3P2_OWNER_PASSWORD: o.password,
    P3P2_STATS_TOKEN: o.statsToken,
    P3P2_LOG_LEVEL: 'warn',
    ...(days ? { P3P2_E2E_DAYS: String(days) } : {}),
    ...o.settings,
  }
}

async function healthy(url: string, gone: () => string | null): Promise<void> {
  const deadline = Date.now() + 30_000
  for (;;) {
    const why = gone()
    if (why) throw new Error(`The server at ${url} did not start: ${why}`)
    const ok = await fetch(`${url}/healthz`).then(
      (res) => res.ok,
      () => false,
    )
    if (ok) return
    if (Date.now() > deadline) throw new Error(`${url}/healthz did not answer in 30 s`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/** The checkout's server: Node itself, not `npm run`, so that the process that is stopped is the server. */
async function startProcess(o: ServerOptions, days: number): Promise<() => Promise<void>> {
  const vars: Record<string, string> = {
    ...env(o, days),
    P3P2_PORT: String(o.port),
    P3P2_HOST: o.host === '127.0.0.1' ? o.host : '0.0.0.0',
  }
  if (o.dataDir) vars.P3P2_DATA_DIR = o.dataDir
  const child: ChildProcess = spawn(process.execPath, [...(days ? ['--import', LATER] : []), MAIN], {
    env: { ...process.env, ...vars },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  const kill = () => child.kill('SIGKILL')
  running.add(kill)
  const exited = () => (child.exitCode !== null || child.signalCode !== null ? `it exited (${child.exitCode ?? child.signalCode})` : null)
  try {
    await healthy(`http://${o.host}:${o.port}`, exited)
  } catch (err) {
    kill()
    running.delete(kill)
    throw err
  }
  return () => {
    running.delete(kill)
    if (exited()) return Promise.resolve()
    return new Promise((resolve) => {
      child.once('exit', () => resolve())
      child.kill('SIGTERM')
    })
  }
}

function docker(...args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/**
 * The published image, as an operator runs it, with the test's port and settings. It runs as whoever runs the
 * tests, so that what it writes in the test's folder is theirs, as it is in CI where that is not the image's user.
 */
async function startContainer(o: ServerOptions, days: number): Promise<() => Promise<void>> {
  const name = `p3p2-e2e-${o.port}`
  try {
    docker('rm', '-f', name)
  } catch {
    // Nothing was left behind.
  }
  const { uid, gid } = userInfo()
  const args = ['run', '-d', '--name', name, '--user', `${uid}:${gid}`, '-p', `${o.host}:${o.port}:8080`]
  const vars = env(o, days)
  if (days) {
    args.push('-v', `${LATER}:/e2e/later.mjs:ro`)
    vars.NODE_OPTIONS = '--import=/e2e/later.mjs'
  }
  if (o.dataDir) args.push('-v', `${o.dataDir}:/data`)
  for (const [key, value] of Object.entries(vars)) args.push('-e', `${key}=${value}`)
  docker(...args, IMAGE)
  const remove = () => {
    try {
      docker('rm', '-f', name)
    } catch {
      // Already gone.
    }
  }
  running.add(remove)
  const exited = () => {
    try {
      return docker('inspect', '-f', '{{.State.Running}}', name) === 'true' ? null : 'the container stopped'
    } catch {
      return 'the container is gone'
    }
  }
  try {
    await healthy(`http://${o.host}:${o.port}`, exited)
  } catch (err) {
    let logs = ''
    try {
      logs = execFileSync('docker', ['logs', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      // No logs to show.
    }
    remove()
    running.delete(remove)
    throw new Error(`${(err as Error).message}\n${logs}`)
  }
  return async () => {
    running.delete(remove)
    try {
      // SIGTERM, as `docker stop` sends it: the server says goodbye and closes its database.
      docker('stop', '-t', '10', name)
    } catch {
      // Removed below either way.
    }
    // Here, and not with --rm: that removes it in the background, and the next test on this port would find the
    // name still taken.
    remove()
  }
}

export async function startTestServer(o: ServerOptions): Promise<TestServer> {
  let kind = o.kind
  let stopping: (() => Promise<void>) | null = null
  const start = async (options: { days?: number; kind?: ServerKind } = {}) => {
    if (stopping) throw new Error('The server is running already')
    kind = options.kind ?? kind
    const days = options.days ?? 0
    stopping = kind === 'image' ? await startContainer(o, days) : await startProcess(o, days)
  }
  const stop = async () => {
    const s = stopping
    stopping = null
    await s?.()
  }
  await start()
  return {
    url: `http://${o.host}:${o.port}`,
    port: o.port,
    get kind() {
      return kind
    },
    dataDir: o.dataDir,
    start,
    stop,
    async restart(options) {
      await stop()
      await start(options)
    },
  }
}
