// Simulated players. A Member is one WebSocket that speaks the real protocol; a Room is the
// members of one room and the traffic its profile gives them.

import {
  type Auth,
  type BinaryOutHeader,
  type ClientFrame,
  decodeBinary,
  encodeBinary,
  PROTO,
  type ServerFrame,
  type WelcomeFrame,
} from '@p3p2/protocol'
import { WebSocket } from 'ws'
import type { Metrics, Series } from './metrics.ts'
import { type Driver, PROFILES } from './profiles.ts'
import type { RoomPlan, WorkerInit } from './types.ts'

/** What the client library does: one `ping` every 10 seconds... */
const PING_MS = 10_000
/** ...and, from a page in front, `away: false` every second when it has sent nothing else for half of one. */
const HERE_MS = 1000
/** How many of a room's guests join at the same time. */
const JOIN_LANES = 8
const RETRY_MS = 2000
const LEAVE_TIMEOUT_MS = 2000

/** Timers that are cancelled together. */
class Timers {
  private readonly live = new Set<ReturnType<typeof setTimeout>>()

  after(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.live.delete(t)
      fn()
    }, ms)
    this.live.add(t)
  }

  /** Calls `fn` every `ms`, the first time after a random part of it, without drifting. */
  every(ms: number, fn: (now: number) => void): void {
    let next = performance.now() + Math.random() * ms
    const fire = () => {
      const now = performance.now()
      fn(now)
      next += ms
      // A generator that stalled skips what it missed rather than sending it all at once.
      if (next < now) next = now + ms
      this.after(next - now, fire)
    }
    this.after(next - performance.now(), fire)
  }

  clear(): void {
    for (const t of this.live) clearTimeout(t)
    this.live.clear()
  }
}

export class Member {
  readonly room: Room
  /** Place in the room. Slot 0 holds the room key; the others come in through the invite. */
  readonly slot: number
  id: number = 0
  /** The number of the last op of the room's log this member has. */
  seq: number = 0
  /** Joined, on an open connection. */
  ready: boolean = false
  /** When it last sent something, `performance.now()`. */
  private saidAt: number = 0
  private ws: WebSocket | null = null
  private token: string = ''
  private leaving: boolean = false
  private readonly timers = new Timers()
  /** Per series and sender: the number of the last message that arrived. */
  private readonly seen = new Map<Series, Map<number, number>>()

  constructor(room: Room, slot: number) {
    this.room = room
    this.slot = slot
  }

  get isHost(): boolean {
    return this.ready && this.room.host === this.id
  }

  /** Connects and says hello; as the member it was before, when it was one. */
  join(): Promise<void> {
    const { init, plan } = this.room
    const pid = `bench-room${plan.index}-member${this.slot}`
    const auth: Auth = this.slot === 0 ? { key: plan.key } : { invite: plan.invite }
    const hello: ClientFrame = {
      t: 'hello',
      proto: PROTO,
      auth,
      player: { pid, secret: `${pid}-secret` },
      game: { id: 'bench', version: '1' },
      name: `Bench ${this.slot}`,
    }
    if (this.id) hello.resume = { member: this.id, token: this.token }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${init.server.replace(/^http/, 'ws')}/api/v1/ws`, { origin: init.origin, perMessageDeflate: false })
      this.ws = ws
      let joined = false
      ws.on('open', () => ws.send(JSON.stringify(hello)))
      ws.on('message', (data: Buffer, isBinary: boolean) => {
        const now = performance.now()
        if (isBinary) return this.binary(data, now)
        const f = JSON.parse(data.toString()) as ServerFrame
        if (f.t === 'welcome') {
          joined = true
          this.welcome(f)
          resolve()
        } else if (f.t === 'error' && !joined) {
          reject(new Error(`room ${plan.index}, member ${this.slot}: ${f.code}: ${f.message}`))
        } else this.frame(f, now)
      })
      ws.on('unexpected-response', (_req, res) => reject(new Error(`the server refused the connection: ${res.statusCode}`)))
      ws.on('close', () => {
        if (this.ws !== ws) return
        this.ready = false
        if (!joined) return reject(new Error(`room ${plan.index}, member ${this.slot}: closed before welcome`))
        if (this.leaving) return
        // Not our doing. Count it, and come back as a player's page would.
        this.room.metrics.closes++
        this.reconnect()
      })
      // An error is always followed by 'close'; without a listener it would crash the thread.
      ws.on('error', () => {})
    })
  }

  private welcome(f: WelcomeFrame): void {
    this.id = f.self.id
    this.token = f.token
    this.seq = f.log?.ops.at(-1)?.seq ?? f.log?.snap?.upTo ?? this.seq
    this.room.host = f.host
    // After a resume, what the others sent meanwhile is gone by design: not a gap to count.
    this.seen.clear()
    this.ready = true
  }

  private reconnect(): void {
    this.room.timers.after(RETRY_MS, () => {
      if (!this.leaving) this.join().catch(() => this.reconnect())
    })
  }

  /** Starts this member's traffic: the client library's pings and word that it is here, and its share of the profile. */
  start(): void {
    const { ping } = this.room
    this.every(PING_MS, (now) => {
      this.send({ t: 'ping', c: now })
      ping.sent++
    })
    // In real time, whatever the profile's speed: it is the server's clock that counts the silence.
    this.timers.every(HERE_MS, (now) => {
      if (this.ready && now - this.saidAt >= HERE_MS / 2) this.send({ t: 'away', away: false })
    })
    this.room.driver.member(this)
  }

  /** Calls `fn` every `ms` (at the profile's speed) while this member is in the room. */
  every(ms: number, fn: (now: number) => void): void {
    this.timers.every(ms / this.room.init.speed, (now) => {
      if (this.ready) fn(now)
    })
  }

  send(frame: ClientFrame): void {
    if (!this.ready) return
    this.ws?.send(JSON.stringify(frame))
    this.saidAt = performance.now()
  }

  sendBinary(header: string, payload: Uint8Array): void {
    if (!this.ready) return
    this.ws?.send(encodeBinary(header, payload))
    this.saidAt = performance.now()
  }

  /**
   * Counts one delivery: `n` is the number its sender gave it, `sentAt` when it was sent. A
   * jump in a sender's numbers means deliveries that never came.
   */
  track(series: Series, from: number, n: number, sentAt: number, now: number): void {
    series.record(now - sentAt)
    let seen = this.seen.get(series)
    if (!seen) {
      seen = new Map()
      this.seen.set(series, seen)
    }
    const last = seen.get(from)
    if (last !== undefined && n > last + 1) series.missed += n - last - 1
    seen.set(from, n)
  }

  private frame(f: ServerFrame, now: number): void {
    const { driver, metrics } = this.room
    switch (f.t) {
      case 'pres':
        return driver.pres?.(this, f.list, now)
      case 'msg':
        return driver.msg?.(this, f, now)
      case 'op':
        this.seq = f.seq
        return driver.op?.(this, f, now)
      case 'snap':
        return driver.snap?.(this)
      case 'pong':
        return this.room.ping.record(now - f.c)
      case 'host':
        this.room.host = f.id
        return
      case 'member-':
        for (const seen of this.seen.values()) seen.delete(f.id)
        return
      case 'error':
        return metrics.error(f.code)
      case 'bye':
        return metrics.error(`bye ${f.reason}`)
    }
  }

  private binary(data: Buffer, now: number): void {
    const parts = decodeBinary(data)
    if (parts) this.room.driver.binary?.(this, JSON.parse(parts.header) as BinaryOutHeader, parts.payload, now)
  }

  /** Leaves for good. Resolves when the connection has closed. */
  leave(): Promise<void> {
    this.leaving = true
    this.ready = false
    this.timers.clear()
    const ws = this.ws
    if (!ws || ws.readyState === WebSocket.CLOSED) return Promise.resolve()
    return new Promise((resolve) => {
      const giveUp = setTimeout(() => ws.terminate(), LEAVE_TIMEOUT_MS)
      ws.once('close', () => {
        clearTimeout(giveUp)
        resolve()
      })
      if (ws.readyState === WebSocket.OPEN) {
        ws.send('{"t":"leave"}')
        ws.close()
      } else ws.terminate()
    })
  }

  /** Loses its connection the way a phone does, and resumes `ms` later. */
  cut(ms: number): void {
    if (!this.ready) return
    const ws = this.ws
    this.ws = null
    this.ready = false
    ws?.terminate()
    this.room.after(ms, () => {
      if (!this.leaving) this.join().catch(() => this.reconnect())
    })
  }
}

export class Room {
  readonly plan: RoomPlan
  readonly init: WorkerInit
  readonly metrics: Metrics
  readonly ping: Series
  readonly driver: Driver
  readonly members: Member[] = []
  /** Member id of the host, as the server last said. */
  host: number = 0
  readonly timers: Timers = new Timers()
  private stopped: boolean = false

  constructor(plan: RoomPlan, init: WorkerInit, metrics: Metrics) {
    this.plan = plan
    this.init = init
    this.metrics = metrics
    this.ping = metrics.series('ping')
    this.driver = PROFILES[init.profile].drive(this)
  }

  series(name: string): Series {
    return this.metrics.series(name)
  }

  /** Like the members' `every`, for what the room does as a whole. */
  every(ms: number, fn: (now: number) => void): void {
    this.timers.every(ms / this.init.speed, fn)
  }

  after(ms: number, fn: () => void): void {
    this.timers.after(ms / this.init.speed, fn)
  }

  /** Fills the room: the key holder first, so that it is the host, then the guests. */
  async start(): Promise<void> {
    await this.add(0)
    let next = 1
    const lane = async () => {
      while (next < this.plan.members) await this.add(next++)
    }
    await Promise.all(Array.from({ length: JOIN_LANES }, lane))
    this.driver.room?.()
  }

  private async add(slot: number): Promise<void> {
    const m = new Member(this, slot)
    this.members[slot] = m
    await m.join()
    m.start()
  }

  /** The member in this slot leaves, and `ms` later the same player comes in as a new member. */
  replace(slot: number, ms: number): void {
    void this.members[slot]?.leave()
    const rejoin = () => {
      if (this.stopped) return
      this.add(slot).catch(() => {
        // Count it and keep trying: a soak must not lose a player for good over one refusal.
        this.metrics.error('rejoin')
        this.timers.after(RETRY_MS, rejoin)
      })
    }
    this.after(ms, rejoin)
  }

  get ready(): number {
    let n = 0
    for (const m of this.members) if (m.ready) n++
    return n
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.timers.clear()
    await Promise.all(this.members.map((m) => m.leave()))
  }
}
