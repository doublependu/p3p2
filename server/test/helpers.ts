import { type BinaryOutHeader, decodeBinary, encodeBinary, type ServerFrame } from '@p3p2/protocol'
import { Hub, type Session } from '../src/core/hub.ts'
import { newInviteCode, newRoomKey } from '../src/core/ids.ts'
import { DEFAULT_LIMITS, type Limits } from '../src/core/limits.ts'
import type { Conn, RoomRecord, VersionPolicy } from '../src/core/types.ts'
import { Store } from '../src/store/sqlite.ts'

export const GAME = 'https://game.example.com'

export class FakeConn implements Conn {
  frames: ServerFrame[] = []
  /** Binary frames, taken apart. */
  binary: { header: BinaryOutHeader; payload: number[] }[] = []
  closed = false
  queued = 0

  send(data: string | Uint8Array): void {
    if (typeof data === 'string') return void this.frames.push(JSON.parse(data) as ServerFrame)
    const parts = decodeBinary(data)!
    this.binary.push({ header: JSON.parse(parts.header) as BinaryOutHeader, payload: [...parts.payload] })
  }

  close(): void {
    this.closed = true
  }

  buffered(): number {
    return this.queued
  }

  /** Frames of one type, in order. */
  of<T extends ServerFrame['t']>(t: T): Extract<ServerFrame, { t: T }>[] {
    return this.frames.filter((f) => f.t === t) as Extract<ServerFrame, { t: T }>[]
  }

  last(): ServerFrame | undefined {
    return this.frames.at(-1)
  }

  clear(): void {
    this.frames = []
    this.binary = []
  }
}

export interface Player {
  conn: FakeConn
  session: Session
  pid: string
  id: number
  token: string
  /** Its page is in the background: it said `away`, and says nothing more. */
  hidden: boolean
  /** Its page has stopped (`World.freeze`): nothing comes from it any more. */
  frozen: boolean
  /** When it last sent something. */
  saidAt: number
}

/** Presence entries without the time the server got each value: [member id, value]. */
export function untimed(list: readonly (readonly unknown[])[]): [number, unknown][] {
  return list.map((e) => [e[0] as number, e[1]])
}

export class World {
  time = 1_000_000
  store = new Store(':memory:')
  limits: Limits
  hub: Hub
  private players = 0
  private names = 0
  /** Everybody who joined, for the second-by-second `away: false` that a page in front sends. */
  private everyone: Player[] = []

  constructor(limits: Partial<Limits> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits }
    this.hub = new Hub({ store: this.store, limits: this.limits, now: () => this.time })
  }

  room(over: Partial<{ maxMembers: number; origins: string[]; name: string; versionPolicy: VersionPolicy }> = {}): RoomRecord {
    return this.store.createRoom(
      {
        key: newRoomKey(),
        name: over.name ?? 'Friday games',
        gameUrl: `${GAME}/`,
        origins: over.origins ?? [GAME],
        maxMembers: over.maxMembers ?? 16,
        versionPolicy: over.versionPolicy,
      },
      this.time,
    )
  }

  invite(room: RoomRecord): string {
    const code = newInviteCode()
    this.store.createInvite(room.id, code, this.time, this.time + this.limits.inviteTtlMs)
    return code
  }

  connect(origin: string = GAME): { conn: FakeConn; session: Session } {
    const conn = new FakeConn()
    return { conn, session: this.hub.open(conn, origin, '10.0.0.1') }
  }

  /** Connects and says hello. `id` is 0 when the server refused. */
  join(
    auth: { key: string } | { invite: string },
    over: Partial<{
      name: string
      pid: string
      secret: string
      origin: string
      version: string
      game: string
      resume: { member: number; token: string; lastSeq?: number }
    }> = {},
  ): Player {
    const { conn, session } = this.connect(over.origin)
    const pid = over.pid ?? `player-${String(++this.players).padStart(10, '0')}`
    this.hub.receive(
      session,
      JSON.stringify({
        t: 'hello',
        proto: 1,
        auth,
        player: { pid, secret: over.secret ?? `secret-of-${pid}` },
        game: { id: over.game ?? 'test', version: over.version ?? '1.0.0' },
        // A name of its own: a room takes each name once.
        name: over.name ?? `Tester ${++this.names}`,
        resume: over.resume,
      }),
    )
    const welcome = conn.of('welcome')[0]
    const player = { conn, session, pid, id: welcome?.self.id ?? 0, token: welcome?.token ?? '', hidden: false, frozen: false, saidAt: this.time }
    if (player.id) this.everyone.push(player)
    return player
  }

  send(p: Player, frame: unknown): void {
    const f = frame as { t?: string; away?: unknown }
    if (f.t === 'away' && typeof f.away === 'boolean') p.hidden = f.away
    p.saidAt = this.time
    this.hub.receive(p.session, JSON.stringify(frame))
  }

  /** The page stops, with its connection still open: a frozen tab, a laptop whose lid was shut. */
  freeze(p: Player): void {
    p.frozen = true
  }

  sendBinary(p: Player, header: unknown, payload: number[]): void {
    p.saidAt = this.time
    this.hub.receiveBinary(p.session, encodeBinary(JSON.stringify(header), Uint8Array.from(payload)))
  }

  /** What the presence timer does. Returns what each player got since: [member id, value] pairs, without the times. */
  flush(...players: Player[]): [number, unknown][][] {
    for (const p of players) p.conn.clear()
    this.hub.flushPresence()
    return players.map((p) => untimed(p.conn.of('pres').flatMap((f) => f.list)))
  }

  /** The socket dropped without a goodbye. */
  drop(p: Player): void {
    this.hub.closed(p.session)
  }

  /**
   * Time passes, a second at most between the hub's ticks, as the socket layer runs them. Every
   * page that is connected, in front and not frozen says something each second, as the client
   * library does: `away: false`, when it has sent nothing else since the second before.
   */
  advance(ms: number): void {
    while (ms > 0) {
      for (const p of this.everyone) {
        if (!p.session.open || !p.session.joined || p.hidden || p.frozen || p.saidAt >= this.time) continue
        p.saidAt = this.time
        this.hub.receive(p.session, '{"t":"away","away":false}')
      }
      const step = Math.min(1000, ms)
      ms -= step
      this.time += step
      this.hub.tick()
    }
  }
}
