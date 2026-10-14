// The main thread's side of a load: rooms made through the portal as an owner would make them,
// generator threads that fill them, and measurements taken from both ends.

import type { RecordableHistogram } from 'node:perf_hooks'
import { Worker } from 'node:worker_threads'
import type { InviteGrant, ServerStats } from '@p3p2/protocol'
import { newHistogram, summarize } from './metrics.ts'
import type { Target } from './target.ts'
import type { Command, ProfileName, Result, RoomPlan, WorkerInit, WorkerReport } from './types.ts'

/** The site the benchmark's rooms are for. `.invalid` never resolves, so no real game is named. */
export const ORIGIN = 'https://bench.invalid'
const SAMPLE_MS = 5000
/** The server's hard cap on the members of a room. */
export const ROOM_MAX = 64

export class ServerGone extends Error {}

/** The owner's and the game page's calls: log in, make rooms and invites, read the stats. */
export class Admin {
  private cookie = ''
  private readonly target: Target

  constructor(target: Target) {
    this.target = target
  }

  private async form(path: string, fields: Record<string, string>): Promise<Response> {
    const res = await fetch(this.target.url + path, {
      method: 'POST',
      headers: { cookie: this.cookie, origin: this.target.url, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
    const set = res.headers.get('set-cookie')
    if (set) this.cookie = set.split(';')[0]!
    return res
  }

  async login(): Promise<void> {
    const res = await this.form('/login', { password: this.target.password })
    if (res.status !== 302) throw new Error(`could not log in to the portal at ${this.target.url}: ${res.status}`)
  }

  /** Creates a room and its invite, as the owner and then the host's game page would. */
  async room(index: number, members: number): Promise<RoomPlan> {
    // As large as a room can be: a member that lost its connection holds its place for a while,
    // and whoever comes in meanwhile must still fit.
    const res = await this.form('/rooms', { game: ORIGIN, name: `bench ${index}`, max: String(ROOM_MAX) })
    const key = res.headers.get('location')?.split('/').pop()
    if (res.status !== 302 || !key) throw new Error(`could not create a room: ${res.status} ${(await res.text()).slice(0, 200)}`)
    const invite = await fetch(`${this.target.url}/api/v1/room/invite`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, origin: ORIGIN },
      signal: AbortSignal.timeout(10_000),
    })
    if (!invite.ok) throw new Error(`could not create an invite: ${invite.status}`)
    return { index, key, invite: ((await invite.json()) as InviteGrant).code, members }
  }

  async deleteRoom(key: string): Promise<void> {
    await this.form(`/room/${key}/delete`, {})
  }

  async stats(reset: boolean = false): Promise<ServerStats> {
    let res: Response
    try {
      res = await fetch(`${this.target.url}/api/v1/stats${reset ? '?reset=1' : ''}`, {
        headers: { authorization: `Bearer ${this.target.statsToken}` },
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new ServerGone((await this.target.postMortem?.()) ?? 'the server stopped answering')
    }
    if (!res.ok) throw new Error(`the server refused the stats token: ${res.status}`)
    return (await res.json()) as ServerStats
  }
}

/** One generator thread, and a way to ask it things. */
class Thread {
  private readonly worker: Worker
  private readonly waiting = new Map<number, { resolve: (v: WorkerReport | null) => void; reject: (e: Error) => void }>()
  private nextId = 1

  constructor(init: WorkerInit) {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { workerData: init })
    this.worker.on('message', (m: { id: number; result?: WorkerReport | null; error?: string }) => {
      const w = this.waiting.get(m.id)
      this.waiting.delete(m.id)
      if (m.error !== undefined) return w?.reject(new Error(m.error))
      // A histogram that arrives is the thread's own, still counting: copy it before it moves on.
      for (const [name, h] of Object.entries(m.result?.histograms ?? {})) {
        const copy = newHistogram()
        copy.add(h as RecordableHistogram)
        m.result!.histograms[name] = copy
      }
      w?.resolve(m.result ?? null)
    })
    this.worker.on('error', (err) => {
      for (const w of this.waiting.values()) w.reject(err)
      this.waiting.clear()
    })
  }

  call(command: Command): Promise<WorkerReport | null> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      this.waiting.set(id, { resolve, reject })
      this.worker.postMessage({ id, command })
    })
  }

  async close(): Promise<void> {
    await this.worker.terminate()
  }
}

export interface LoadOptions {
  profile: ProfileName
  /** Members per room. */
  members: number
  /** Generator threads. Rooms are dealt out among them. */
  workers: number
  speed: number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class Load {
  readonly admin: Admin
  private readonly target: Target
  private readonly options: LoadOptions
  private readonly threads: Thread[] = []
  private readonly plans: RoomPlan[] = []
  private running = 0

  private constructor(target: Target, options: LoadOptions) {
    this.target = target
    this.options = options
    this.admin = new Admin(target)
  }

  static async start(target: Target, options: LoadOptions): Promise<Load> {
    const load = new Load(target, options)
    await load.admin.login()
    const init: WorkerInit = { server: target.url, origin: ORIGIN, profile: options.profile, speed: options.speed }
    for (let i = 0; i < options.workers; i++) load.threads.push(new Thread(init))
    return load
  }

  get rooms(): number {
    return this.running
  }

  /** Brings the number of full rooms to `rooms`: fills new ones, or empties the last ones. */
  async scale(rooms: number): Promise<void> {
    while (this.plans.length < rooms) this.plans.push(await this.admin.room(this.plans.length, this.options.members))
    this.running = rooms
    await Promise.all(
      this.threads.map((thread, i) =>
        thread.call({ cmd: 'rooms', plans: this.plans.slice(0, rooms).filter((p) => p.index % this.threads.length === i) }),
      ),
    )
  }

  /** Counts for `seconds`, on the generator and on the server. */
  async measure(seconds: number): Promise<Result> {
    await Promise.all(this.threads.map((t) => t.call({ cmd: 'mark' })))
    const throttledBefore = await this.target.throttledMs?.()
    const before = await this.admin.stats(true)
    let rssPeak = before.memory.rss
    const end = performance.now() + seconds * 1000
    for (;;) {
      const left = end - performance.now()
      await sleep(Math.min(SAMPLE_MS, Math.max(0, left)))
      if (left <= SAMPLE_MS) break
      rssPeak = Math.max(rssPeak, (await this.admin.stats()).memory.rss)
    }
    const after = await this.admin.stats()
    const reports = (await Promise.all(this.threads.map((t) => t.call({ cmd: 'report' })))) as WorkerReport[]
    const throttledAfter = await this.target.throttledMs?.()

    const elapsed = after.uptime - before.uptime
    const rate = (key: 'framesIn' | 'framesOut' | 'bytesIn' | 'bytesOut' | 'writes') => (after[key] - before[key]) / elapsed
    const share = (held: number, passed: number) => (held + passed > 0 ? held / (held + passed) : 0)
    const result: Result = {
      profile: this.options.profile,
      rooms: this.running,
      members: this.options.members,
      connections: after.connections,
      seconds: elapsed,
      cpu: (after.cpu.user + after.cpu.system - before.cpu.user - before.cpu.system) / 1000 / elapsed,
      rss: after.memory.rss,
      rssPeak: Math.max(rssPeak, after.memory.rss),
      heapUsed: after.memory.heapUsed,
      loopP99: after.loop.p99,
      loopMax: after.loop.max,
      framesIn: rate('framesIn'),
      framesOut: rate('framesOut'),
      bytesIn: rate('bytesIn'),
      bytesOut: rate('bytesOut'),
      writes: rate('writes'),
      presenceSkipped: share(after.presenceSkipped - before.presenceSkipped, after.presenceOut - before.presenceOut),
      // Volatile messages that did go out are not counted apart from the other frames.
      volatileDropped: share(after.volatileDropped - before.volatileDropped, after.framesOut - before.framesOut),
      series: {},
      errors: {},
      closes: 0,
      generatorLoopP99: 0,
    }
    if (throttledBefore !== undefined && throttledAfter !== undefined) result.throttledMs = throttledAfter - throttledBefore

    const names = new Set(reports.flatMap((r) => Object.keys(r.counts)))
    for (const name of names) {
      const hist = newHistogram()
      const counts = { sent: 0, received: 0, missed: 0 }
      for (const r of reports) {
        const c = r.counts[name]
        if (!c) continue
        hist.add(r.histograms[name] as RecordableHistogram)
        counts.sent += c.sent
        counts.received += c.received
        counts.missed += c.missed
      }
      if (counts.sent || counts.received) result.series[name] = summarize(hist, counts)
    }
    for (const r of reports) {
      for (const [code, n] of Object.entries(r.errors)) result.errors[code] = (result.errors[code] ?? 0) + n
      result.closes += r.closes
      result.generatorLoopP99 = Math.max(result.generatorLoopP99, r.loopP99)
    }
    return result
  }

  /** Empties the rooms and stops the threads. On a server that stays, the rooms are deleted too. */
  async close(): Promise<void> {
    await Promise.all(this.threads.map((t) => t.call({ cmd: 'stop' }).catch(() => null)))
    await Promise.all(this.threads.map((t) => t.close()))
    if (!this.target.disposable) for (const plan of this.plans) await this.admin.deleteRoom(plan.key).catch(() => {})
  }
}
