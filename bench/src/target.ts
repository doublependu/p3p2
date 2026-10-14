// The server under test: in a container sized like a small VPS, as a plain process on this
// machine, or one that is already running somewhere.

import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const ROOT = join(import.meta.dirname, '..', '..')
const IMAGE = 'p3p2/p3p2:bench'

export interface Target {
  /** Server base URL. */
  url: string
  password: string
  statsToken: string
  /** For reports: where the server runs. */
  where: string
  /** The server was started for this run and goes away with it, rooms and all. */
  disposable: boolean
  /** Only for a container: ms the kernel has paused it so far for using up its CPU share. */
  throttledMs?(): Promise<number>
  /** Why the server is gone, when it is. */
  postMortem?(): Promise<string>
  stop(): Promise<void>
}

export interface TargetOptions {
  /** `docker`, `local`, or the URL of a running server. */
  target: string
  /** Container name; two runs at the same time need two names. */
  name: string
  cpus: string
  memory: string
  /** For `local`: write a CPU profile of the server into this directory when it exits. */
  profileDir?: string
}

/**
 * What the benchmark changes about a server: nothing but the limits per address, since all of
 * a generator's players come from one address, and the number of rooms.
 */
function serverEnv(password: string, statsToken: string): Record<string, string> {
  return {
    P3P2_OWNER_PASSWORD: password,
    P3P2_STATS_TOKEN: statsToken,
    P3P2_CONNECT_RATE: '10000',
    P3P2_API_RATE: '10000',
    P3P2_MAX_ROOMS: '100000',
  }
}

async function untilHealthy(url: string, alive: () => Promise<string | null>): Promise<void> {
  const deadline = Date.now() + 20_000
  for (;;) {
    try {
      if ((await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1000) })).ok) return
    } catch {
      // Not listening yet.
    }
    const dead = await alive()
    if (dead) throw new Error(`the server did not start: ${dead}`)
    if (Date.now() > deadline) throw new Error(`the server at ${url} did not answer /healthz in 20 s`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function docker(...args: string[]): Promise<string> {
  return (await exec('docker', args, { maxBuffer: 16 * 1024 * 1024 })).stdout.trim()
}

let built = false

async function startDocker(o: TargetOptions): Promise<Target> {
  if (!built) {
    console.error(`Building ${IMAGE} …`)
    await docker('build', '-q', '-f', join(ROOT, 'deploy', 'Dockerfile'), '-t', IMAGE, ROOT)
    built = true
  }
  const password = randomBytes(18).toString('base64url')
  const statsToken = randomBytes(18).toString('base64url')
  await docker('rm', '-f', '-v', o.name).catch(() => {})
  const env = Object.entries(serverEnv(password, statsToken)).flatMap(([k, v]) => ['-e', `${k}=${v}`])
  // No swap: a 512 MB machine that runs out of memory should show it, not hide it.
  await docker('run', '-d', '--name', o.name, '--cpus', o.cpus, '--memory', o.memory, '--memory-swap', o.memory, ...env, IMAGE)
  // The container's own address on the Docker bridge: no published port, no userland proxy in between.
  const ip = await docker('inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', o.name)
  const url = `http://${ip}:8080`
  const state = () => docker('inspect', '-f', '{{.State.Status}} {{.State.OOMKilled}} {{.State.ExitCode}}', o.name)
  const postMortem = async () => {
    const [status, oom, code] = (await state().catch(() => 'removed false 0')).split(' ')
    if (status === 'running') return 'the container is running, but the server does not answer'
    return oom === 'true' ? 'the container ran out of memory and was killed' : `the container ${status} (exit code ${code})`
  }
  await untilHealthy(url, async () => ((await state()).startsWith('running') ? null : `${await postMortem()}\n${await docker('logs', o.name)}`))
  return {
    url,
    password,
    statsToken,
    where: `Docker container, --cpus=${o.cpus} --memory=${o.memory}`,
    disposable: true,
    async throttledMs() {
      const stat = await docker('exec', o.name, 'cat', '/sys/fs/cgroup/cpu.stat')
      return Number(/^throttled_usec (\d+)$/m.exec(stat)?.[1] ?? 0) / 1000
    },
    postMortem,
    async stop() {
      await docker('rm', '-f', '-v', o.name).catch(() => {})
    },
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
  })
}

async function startLocal(o: TargetOptions): Promise<Target> {
  const password = randomBytes(18).toString('base64url')
  const statsToken = randomBytes(18).toString('base64url')
  const port = await freePort()
  const dataDir = mkdtempSync(join(tmpdir(), 'p3p2-bench-'))
  const url = `http://127.0.0.1:${port}`
  const flags = o.profileDir ? ['--cpu-prof', '--cpu-prof-dir', o.profileDir] : []
  // Node itself, not `npm run`: the process we stop must be the server, not a wrapper around it.
  const child: ChildProcess = spawn(process.execPath, [...flags, join(ROOT, 'server', 'src', 'main.ts')], {
    env: {
      ...process.env,
      ...serverEnv(password, statsToken),
      P3P2_PORT: String(port),
      P3P2_HOST: '127.0.0.1',
      P3P2_PUBLIC_URL: url,
      P3P2_DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  const dead = async () => (child.exitCode === null && child.signalCode === null ? null : `it exited with ${child.exitCode ?? child.signalCode}`)
  try {
    await untilHealthy(url, dead)
  } catch (err) {
    child.kill('SIGKILL')
    throw err
  }
  return {
    url,
    password,
    statsToken,
    where: 'a process on this machine, all cores',
    disposable: true,
    postMortem: async () => (await dead()) ?? 'the process is running, but the server does not answer',
    async stop() {
      // SIGTERM lets the server close, and Node write the CPU profile.
      child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
      await exited
      clearTimeout(timer)
      rmSync(dataDir, { recursive: true, force: true })
    },
  }
}

export async function startTarget(o: TargetOptions): Promise<Target> {
  if (o.target === 'docker') return startDocker(o)
  if (o.target === 'local') return startLocal(o)
  if (!/^https?:\/\//.test(o.target)) throw new Error(`--target must be docker, local or a server URL, got "${o.target}"`)
  const password = process.env.BENCH_PASSWORD
  const statsToken = process.env.BENCH_STATS_TOKEN
  if (!password || !statsToken) {
    throw new Error('For a running server, set BENCH_PASSWORD (the owner password) and BENCH_STATS_TOKEN (its P3P2_STATS_TOKEN)')
  }
  return {
    url: o.target.replace(/\/+$/, ''),
    password,
    statsToken,
    where: o.target,
    disposable: false,
    async stop() {},
  }
}
