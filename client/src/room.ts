// One room, over one WebSocket. Reconnects by itself and resumes the same member when it can.
// The server is untrusted: frames that fail validation are dropped, and nothing it sends is
// ever run, or put into the page as markup.

import {
  type Auth,
  CHAT_CHANNEL,
  cleanName,
  cleanText,
  decodeBinary,
  encodeBinary,
  type MemberInfo,
  parseBinaryOutHeader,
  parseServerFrame,
  PROTO,
  type ServerFrame,
  type WelcomeFrame,
  type WelcomeLog,
} from '@p3p2/protocol'
import { Failure, thenable } from './errors.ts'
import type {
  Chat,
  ChatMessage,
  CloseReason,
  LeaveReason,
  Log,
  LogEntry,
  LogReader,
  Member,
  MemberState,
  MessageHandler,
  Presence,
  PresenceHandler,
  Room,
  RoomEvents,
  RoomStatus,
  SendOptions,
} from './types.ts'

export const CHAT_MAX = 500
const CHAT_KEPT = 100
const PING_MS = 10_000
/** At most this many ops wait for a connection that is coming back. */
const OPS_WAITING = 256

/** Presence is sent at most this often. The server passes it on in batches at about this rate anyway. */
const PRESENCE_MS = 50
/** A page that has been hidden this long tells the server: a browser slows it down, so it should not be the host. */
const AWAY_MS = 1000
/**
 * A page in front says something this often, at least: `away: false` when it has said nothing else
 * for half of it. A member the server has not heard from for a few seconds counts as lost.
 */
const HERE_MS = 1000
/** How long to keep trying before the room counts as lost. */
const GIVE_UP_MS = 60_000
/** `room.on()` serves both channels and these events, so a channel cannot have one of their names. */
const EVENTS = new Set(['member-join', 'member-leave', 'host-change', 'member-state', 'latency', 'status', 'error', 'close'])
/** Fired after every welcome but the first. For the panel; `$` names are the library's own. */
export const SYNC = '$sync'
/** Refusals that will not change by trying again. */
const FINAL = new Set(['auth', 'origin', 'player', 'full', 'proto', 'version', 'game'])

export interface Resume {
  member: number
  token: string
}

export interface RoomParams {
  server: string
  auth: Auth
  game: { id: string; version: string }
  name: string
  identity: { pid: string; secret: string }
  inviteUrl: string | null
  resume: Resume | null
  /** Called after every welcome, with what a later resume needs. */
  onWelcome: (resume: Resume) => void
  onClose: (reason: CloseReason) => void
}

type Handler = (...args: never[]) => void

/** Binary data as the bytes to send, or null for anything else. */
function bytesOf(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
}

function chatMessage(from: number, pid: string, name: string, data: unknown, ts: number, selfPid: string): ChatMessage | null {
  const text = cleanText(data, CHAT_MAX)
  if (!text) return null
  return { from, pid, name: cleanName(name) || 'Player', text, ts, self: pid === selfPid }
}

export class RoomClient implements Room {
  name: string = ''
  status: RoomStatus = 'reconnecting'
  self: Member
  members: Member[] = []
  host: Member | null = null
  isMod: boolean = false
  readonly server: string
  readonly inviteUrl: string | null
  limits = { maxFrameBytes: Number.POSITIVE_INFINITY, maxLogBytes: Number.POSITIVE_INFINITY }
  readonly chat: Chat
  readonly presence: Presence
  readonly log: Log

  private readonly p: RoomParams
  private ws: WebSocket | null = null
  private readonly byId = new Map<number, Member>()
  private readonly values = new Map<string, unknown>()
  /** Saved values per player id, then per channel. */
  private readonly playerValues = new Map<string, Map<string, unknown>>()
  /** The others' presence, by member id. */
  private readonly presences = new Map<number, unknown>()
  /** When the server got each of those values, on this page's `performance.now()` clock. */
  private readonly presenceAt = new Map<number, number>()
  private readonly presenceHandlers = new Set<PresenceHandler>()
  /** This member's own presence (undefined until first set), and the JSON of what the server has. */
  /** Ops the game submitted while the connection was coming back, as frames, in order. */
  private readonly opsWaiting: string[] = []
  private mine: unknown
  /** When the game set it, on the server's clock. */
  private mineAt = 0
  private mineSent = ''
  private presenceTimer: ReturnType<typeof setTimeout> | undefined
  private readonly handlers = new Map<string, Set<Handler>>()
  private readonly chatLog: ChatMessage[] = []
  private readonly chatHandlers = new Set<(m: ChatMessage) => void>()
  /** The log: the numbers of the newest op this page has and of the last one its reader was given, and what waits in between. */
  private logSeq = 0
  private logGiven = 0
  private logBase: unknown
  private logFresh = true
  private logWaiting: LogEntry[] = []
  private reader: LogReader | null = null
  /** Set while the reader is still taking in a state: see `feed`. */
  private loading: Promise<void> | null = null
  /** The server asked this host for a snapshot. */
  private snapWanted = false
  /** What the server was last told about this page being in the background. */
  private away = false
  private awayTimer: ReturnType<typeof setTimeout> | undefined
  /** When something was last sent, and the timer that says something when nothing has been. */
  private saidAt = 0
  private herer: ReturnType<typeof setInterval> | undefined
  private resume: Resume | null
  private welcomed = false
  private refusal: string | null = null
  private bye: string | null = null
  private downSince = 0
  private attempts = 0
  private retry: ReturnType<typeof setTimeout> | undefined
  private pinger: ReturnType<typeof setInterval> | undefined
  private offset = 0
  private bestRtt = Number.POSITIVE_INFINITY
  private opening: { resolve: () => void; reject: (err: Error) => void } | null = null

  constructor(params: RoomParams) {
    this.p = params
    this.server = params.server
    this.inviteUrl = params.inviteUrl
    this.resume = params.resume
    this.self = { id: 0, pid: params.identity.pid, name: params.name, order: 0, rtt: null, state: 'here' }
    const log = this.chatLog
    this.chat = {
      messages: log,
      send: (text) => {
        const clean = cleanText(text, CHAT_MAX)
        // 'all', so the sender shows its own line when the server has placed it among the others.
        if (clean) this.send(CHAT_CHANNEL, clean, { to: 'all', retain: 'tail' })
      },
      on: (handler) => {
        this.chatHandlers.add(handler)
        return () => this.chatHandlers.delete(handler)
      },
    }
    this.presence = {
      set: (value) => {
        this.mine = value === undefined ? null : value
        this.mineAt = this.now()
        this.sendPresence()
      },
      get: (member) => {
        const id = typeof member === 'number' ? member : member.id
        return id === this.self.id ? this.mine : this.presences.get(id)
      },
      at: (member) => {
        const id = typeof member === 'number' ? member : member.id
        return id === this.self.id ? undefined : this.presenceAt.get(id)
      },
      on: (handler) => {
        this.presenceHandlers.add(handler)
        return () => this.presenceHandlers.delete(handler)
      },
    }
    const seq = () => this.logGiven
    this.log = {
      get seq() {
        return seq()
      },
      submit: (op) => this.submit(op),
      open: (reader) => {
        if (this.reader) throw new Error('The log of this room is already open')
        this.reader = reader
        this.feed()
        if (this.snapWanted) this.snapshot()
        return Promise.resolve(this.loading ?? undefined)
      },
      snapshot: (state) => this.snapshot(state),
    }
  }

  /** Connects. Resolves at the first welcome; rejects if the server refuses or cannot be reached. */
  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.opening = { resolve, reject }
      this.connect()
    })
  }

  get isHost(): boolean {
    return this.host !== null && this.host === this.self
  }

  now(): number {
    return Date.now() + this.offset
  }

  retained(channel: string, of?: { player: string }): unknown {
    return (of ? this.playerValues.get(of.player) : this.values)?.get(channel)
  }

  send(channel: string, data: unknown, options: SendOptions = {}): boolean {
    if (EVENTS.has(channel)) throw new TypeError(`"${channel}" is one of the room's own events; use another channel name`)
    const bytes = bytesOf(data)
    if (!bytes) return this.write({ t: 'msg', ch: channel, data: data === undefined ? null : data, ...options })
    if (options.retain) throw new TypeError('Binary data cannot be retained; send JSON on that channel instead')
    const { to, volatile } = options
    return this.raw(encodeBinary(JSON.stringify({ t: 'msg', ch: channel, to, volatile }), bytes))
  }

  sendEach(channel: string, parts: Iterable<readonly [Member | number, ArrayBuffer | ArrayBufferView]>, options: { volatile?: boolean } = {}): boolean {
    if (EVENTS.has(channel)) throw new TypeError(`"${channel}" is one of the room's own events; use another channel name`)
    const list: [number, number][] = []
    const chunks: Uint8Array[] = []
    let length = 0
    for (const [to, data] of parts) {
      const bytes = bytesOf(data)
      if (!bytes) throw new TypeError('Each part is binary data: an ArrayBuffer or a typed array')
      const id = typeof to === 'number' ? to : to.id
      // Once for each member: a second part for the same member would be refused by the server.
      if (list.some(([other]) => other === id)) continue
      list.push([id, bytes.length])
      chunks.push(bytes)
      length += bytes.length
    }
    if (list.length === 0) return true
    const payload = new Uint8Array(length)
    let at = 0
    for (const chunk of chunks) {
      payload.set(chunk, at)
      at += chunk.length
    }
    const header = JSON.stringify({ t: 'msg', ch: channel, parts: list, volatile: options.volatile || undefined })
    return this.raw(encodeBinary(header, payload))
  }

  offer(channel: string, data: unknown): Promise<unknown> {
    return new Promise((resolve) => {
      const done = () => {
        for (const off of offs) off()
        resolve(this.retained(channel))
      }
      const ask = () => this.send(channel, data, { retain: 'room', first: true })
      const offs = [
        // The answer is the next saved value on the channel: this one coming back, or the one that was there.
        this.on(channel, (_data, _from, meta) => {
          if (meta.retained) done()
        }),
        // After a gap the question may have been lost. The welcome says what the room has now.
        this.on(SYNC, () => {
          if (this.retained(channel) !== undefined) done()
          else ask()
        }),
        this.on('close', done),
      ]
      if (this.status === 'closed') done()
      else ask()
    })
  }

  on<E extends keyof RoomEvents>(event: E, handler: RoomEvents[E]): () => void
  on(channel: string, handler: MessageHandler): () => void
  on(name: string, handler: Handler | MessageHandler): () => void {
    let set = this.handlers.get(name)
    if (!set) {
      set = new Set()
      this.handlers.set(name, set)
    }
    set.add(handler as Handler)
    return () => set.delete(handler as Handler)
  }

  leave(): void {
    this.write({ t: 'leave' })
    this.finish('left')
  }

  kick(memberId: number): void {
    this.write({ t: 'kick', id: memberId })
  }

  end(): void {
    this.write({ t: 'end' })
  }

  // ---- connection ----

  private connect(): void {
    const ws = new WebSocket(`${this.server.replace(/^http/, 'ws')}/api/v1/ws`)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    this.refusal = null
    this.bye = null
    ws.onopen = () => {
      const { auth, identity, game, name } = this.p
      const hello: Record<string, unknown> = { t: 'hello', proto: PROTO, auth, player: identity, game, name }
      // After a gap in the connection this page still has the log up to `lastSeq`. After a reload it has none of it.
      if (this.resume) hello.resume = this.welcomed ? { ...this.resume, lastSeq: this.logSeq } : this.resume
      ws.send(JSON.stringify(hello))
    }
    ws.onmessage = (event) => {
      if (this.ws !== ws) return
      if (typeof event.data !== 'string') return this.binary(event.data)
      const frame = parseServerFrame(event.data)
      if (frame) this.handle(frame)
    }
    ws.onclose = () => {
      if (this.ws === ws) this.dropped()
    }
  }

  private write(frame: object): boolean {
    try {
      return this.raw(JSON.stringify(frame))
    } catch {
      // Not serializable (a cycle, a BigInt): the game's bug, but not a reason to throw mid-frame.
      return false
    }
  }

  private raw(frame: string | Uint8Array<ArrayBuffer>): boolean {
    if (!this.connected() || this.tooBig(frame)) return false
    this.ws!.send(frame)
    this.saidAt = Date.now()
    return true
  }

  private connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.status === 'open'
  }

  /** The server closes the connection on a frame over its limit. Text is at most 3 bytes a character. */
  private tooBig(frame: string | Uint8Array<ArrayBuffer>): boolean {
    const text = typeof frame === 'string'
    const max = this.limits.maxFrameBytes
    if (frame.length * (text ? 3 : 1) <= max || (text ? new TextEncoder().encode(frame) : frame).length <= max) return false
    this.emit('error', { code: 'too-big', message: 'That is more than this server takes in one message' })
    return true
  }

  /**
   * An op for the log. While the connection is coming back it waits, and goes when it is, in order: an op is a
   * change that has to be kept, and every game would otherwise keep its own list of them. False when the room is
   * closed, when the op is too big, or when too many are waiting.
   */
  private submit(op: unknown): boolean {
    let frame: string
    try {
      frame = JSON.stringify({ t: 'op', op: op === undefined ? null : op })
    } catch {
      return false
    }
    if (this.status === 'closed') return false
    if (this.connected() && !this.opsWaiting.length) return this.raw(frame)
    if (this.tooBig(frame) || this.opsWaiting.length >= OPS_WAITING) return false
    this.opsWaiting.push(frame)
    return true
  }

  /** The ops that waited for the connection. One that cannot go now waits again, with those after it. */
  private sendWaiting(): void {
    while (this.opsWaiting.length && this.raw(this.opsWaiting[0]!)) this.opsWaiting.shift()
  }

  // ---- the log ----

  /** Hands the reader what it has not been given: the state to start from when that is new, then the ops. */
  private feed(): void {
    const reader = this.reader
    // While a state is still being taken in, the ops that follow it wait.
    if (!reader || this.loading) return
    if (this.logFresh) {
      const base = this.logBase
      this.logFresh = false
      this.logBase = undefined
      let taking: unknown
      this.guard(() => (taking = reader.load(base)))
      if (thenable(taking)) {
        const done = () => {
          if (this.loading !== waiting) return
          this.loading = null
          this.feed()
        }
        const waiting: Promise<void> = (taking as Promise<unknown>).then(done, (err) => {
          console.error('[p3p2] a handler threw', err)
          done()
        })
        this.loading = waiting
        return
      }
    }
    const ops = this.logWaiting
    this.logWaiting = []
    for (const e of ops) {
      this.logGiven = e.seq
      this.guard(() => reader.apply(e.op, e))
    }
  }

  /** The log as `welcome` brings it: whole, or the ops that were missed. */
  private takeLog(log: WelcomeLog | undefined): void {
    if (!log) return
    if (log.snap !== undefined) {
      this.logBase = log.snap?.data
      this.logSeq = this.logGiven = log.snap?.upTo ?? 0
      this.logWaiting = []
      this.logFresh = true
    }
    for (const e of log.ops) {
      if (e.seq <= this.logSeq) continue
      this.logSeq = e.seq
      this.logWaiting.push({ seq: e.seq, op: e.op, pid: String(e.pid), from: null, ts: e.ts, replayed: true })
    }
  }

  private snapshot(state?: unknown): boolean {
    if (!this.isHost) {
      this.snapWanted = false
      return false
    }
    let data = state
    if (data === undefined) this.guard(() => (data = this.reader?.save?.()))
    if (data === undefined) return false
    // The state holds the ops the reader has been given so far, and no others.
    const upTo = this.logGiven
    if (thenable(data)) {
      // Still being packed. It is the state as of `upTo`, whatever arrives meanwhile.
      this.snapWanted = false
      ;data.then(
        (packed) => {
          if (packed !== undefined && this.isHost) this.write({ t: 'snap', data: packed, upTo })
        },
        (err) => console.error('[p3p2] a handler threw', err),
      )
      return true
    }
    if (!this.write({ t: 'snap', data, upTo })) return false
    this.snapWanted = false
    return true
  }

  // ---- in front, or in the background ----

  private readonly seen = (): void => {
    clearTimeout(this.awayTimer)
    if (document.hidden) this.awayTimer = setTimeout(() => this.tellAway(), AWAY_MS)
    else this.tellAway()
  }

  private tellAway(): void {
    const away = document.hidden
    if (away !== this.away && this.raw(`{"t":"away","away":${away}}`)) this.away = away
  }

  /** Every HERE_MS: a page in front that has said nothing lately says that it is still here. */
  private readonly stillHere = (): void => {
    if (!this.away && !document.hidden && Date.now() - this.saidAt >= HERE_MS / 2) this.raw('{"t":"away","away":false}')
  }

  /**
   * The page is going: closed, reloaded, or left for another. Whatever a host kept in it goes
   * with it, so the host role should not wait for it. The server is told now, not in a second,
   * and passes the role on if somebody else can take it. A reload then comes back as the same
   * member, without the role.
   */
  private readonly going = (): void => {
    clearTimeout(this.awayTimer)
    if (!this.away && this.raw('{"t":"away","away":true}')) this.away = true
  }

  /** Sends this member's presence if it changed, and then not again for a moment: the latest value wins. */
  private sendPresence(): void {
    if (this.presenceTimer !== undefined) return
    let json: string | undefined
    try {
      json = JSON.stringify(this.mine)
    } catch {
      // Not serializable: the server keeps the last value that was.
    }
    // While the connection is down nothing is sent; `welcome` calls this again.
    // With when the game set it: the others draw it as of then, whatever its way to the server was like.
    if (json === undefined || json === this.mineSent || !this.raw(`{"t":"pres","data":${json},"at":${Math.round(this.mineAt)}}`)) return
    this.mineSent = json
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = undefined
      this.sendPresence()
    }, PRESENCE_MS)
  }

  private dropped(): void {
    this.ws = null
    clearInterval(this.pinger)
    clearInterval(this.herer)
    if (this.status === 'closed') return

    const opening = this.opening
    if (opening && !this.welcomed) {
      // The very first attempt failed: report it instead of retrying behind the player's back.
      this.opening = null
      this.status = 'closed'
      return opening.reject(new Failure(this.refusal ?? 'unreachable', this.server))
    }
    if (this.bye === 'kicked' || this.bye === 'ended' || this.bye === 'replaced') return this.finish(this.bye)
    if (this.refusal && FINAL.has(this.refusal)) return this.finish('lost')

    const now = Date.now()
    if (this.status === 'open') this.downSince = now
    if (now - this.downSince > GIVE_UP_MS) return this.finish('lost')
    this.setStatus('reconnecting')
    // Jitter from the crypto source: this library never touches Math.random, which games may have seeded.
    const jitter = crypto.getRandomValues(new Uint8Array(1))[0]! / 255
    const delay = Math.min(8000, 400 * 2 ** this.attempts++) * (0.75 + jitter / 2)
    this.retry = setTimeout(() => this.connect(), delay)
  }

  private finish(reason: CloseReason): void {
    if (this.status === 'closed') return
    this.status = 'closed'
    this.opsWaiting.length = 0
    clearTimeout(this.retry)
    clearTimeout(this.presenceTimer)
    clearTimeout(this.awayTimer)
    clearInterval(this.pinger)
    clearInterval(this.herer)
    document.removeEventListener('visibilitychange', this.seen)
    removeEventListener('pagehide', this.going)
    const ws = this.ws
    this.ws = null
    ws?.close()
    this.emit('status', 'closed')
    this.emit('close', reason)
    this.p.onClose(reason)
  }

  private setStatus(status: RoomStatus): void {
    if (this.status === status) return
    this.status = status
    this.emit('status', status)
  }

  // ---- frames ----

  /** A binary message: the payload goes to the channel's handlers as a Uint8Array. */
  private binary(data: unknown): void {
    const parts = data instanceof ArrayBuffer ? decodeBinary(new Uint8Array(data)) : null
    const f = parts && parseBinaryOutHeader(parts.header)
    if (!parts || !f || EVENTS.has(f.ch) || f.ch.startsWith('$')) return
    this.emit(f.ch, parts.payload, this.byId.get(f.from) ?? null, { ts: f.ts, retained: false })
  }

  private handle(f: ServerFrame): void {
    switch (f.t) {
      case 'msg': {
        const from = this.byId.get(f.from) ?? null
        if (f.retain === 'room') this.keep(this.values, f.ch, f.data)
        else if (f.retain === 'player' && from) {
          let mine = this.playerValues.get(from.pid)
          if (!mine) {
            mine = new Map()
            this.playerValues.set(from.pid, mine)
          }
          this.keep(mine, f.ch, f.data)
        }
        if (f.ch === CHAT_CHANNEL) {
          const m = from && chatMessage(from.id, from.pid, from.name, f.data, f.ts, this.self.pid)
          if (m) this.pushChat(m)
        }
        // A channel named like an event would call the event's handlers with a message.
        if (EVENTS.has(f.ch) || f.ch === SYNC) return
        return this.emit(f.ch, f.data, from, { ts: f.ts, retained: f.retain !== undefined })
      }
      case 'welcome':
        return this.welcome(f)
      case 'member+': {
        if (this.byId.has(f.id)) return
        const m = this.member(f)
        this.sort()
        return this.emit('member-join', m)
      }
      case 'pres':
        for (const [id, data, at] of f.list) {
          const m = this.byId.get(id)
          if (!m || m === this.self) continue
          const when = this.local(at)
          if (data !== null) {
            this.presences.set(id, data)
            this.presenceAt.set(id, when)
          } else if (!this.presences.delete(id)) continue
          this.emitPresence(m, data, when)
        }
        return
      case 'op': {
        if (f.seq <= this.logSeq) return
        this.logSeq = f.seq
        const from = this.byId.get(f.from) ?? null
        this.logWaiting.push({ seq: f.seq, op: f.op, pid: from?.pid ?? '', from, ts: f.ts, replayed: false })
        return this.feed()
      }
      case 'snap':
        this.snapWanted = true
        this.snapshot()
        return
      case 'forget':
        this.playerValues.delete(f.pid)
        return
      case 'member-': {
        const m = this.byId.get(f.id)
        if (!m || m === this.self) return
        this.byId.delete(f.id)
        this.presences.delete(f.id)
        this.presenceAt.delete(f.id)
        this.sort()
        return this.emit('member-leave', m, (f.reason as LeaveReason) ?? 'left')
      }
      case 'host':
        return this.setHost(f.id)
      case 'state': {
        const m = this.byId.get(f.id)
        if (!m || m === this.self || m.state === f.state) return
        m.state = f.state
        return this.emit('member-state', m, f.state)
      }
      case 'members':
        for (const [id, ms] of f.rtt) {
          const m = this.byId.get(id)
          if (m) m.rtt = Math.max(0, Math.round(ms))
        }
        return this.emit('latency')
      case 'pong': {
        // The reading with the shortest round trip is the best estimate of the server's clock.
        const rtt = performance.now() - f.c
        if (rtt >= 0 && rtt <= this.bestRtt) {
          this.bestRtt = rtt
          this.offset = f.now + rtt / 2 - Date.now()
        }
        return
      }
      case 'error':
        if (!this.welcomed || this.status !== 'open') this.refusal = f.code
        else this.emit('error', { code: f.code, message: cleanText(f.message, 200) })
        return
      case 'bye':
        this.bye = f.reason
        return
    }
  }

  private welcome(f: WelcomeFrame): void {
    // The server's clock, roughly, until the pings below find a better reading. First: the times in the frame need it.
    this.offset = f.now - Date.now()
    this.bestRtt = Number.POSITIVE_INFINITY
    const first = !this.welcomed
    const before = new Map(this.byId)
    const oldSelf = this.self
    const oldHost = this.host

    this.byId.clear()
    for (const info of f.members) {
      // Keep the same object for a member that was already here: games hold on to them.
      const known = before.get(info.id)
      if (known && known.pid === info.pid) {
        known.name = cleanName(info.name) || known.name
        known.order = info.order
        this.byId.set(info.id, known)
      } else this.member(info)
    }
    this.self = this.byId.get(f.self.id) ?? this.member(f.self)
    this.self.state = 'here'
    // Who is not here, and who is again: told now for a member that was already known.
    const states = new Map(f.states ?? [])
    const restated: Member[] = []
    for (const m of this.byId.values()) {
      if (m === this.self) continue
      const state: MemberState = states.get(m.id) ?? 'here'
      if (state === m.state) continue
      m.state = state
      if (before.get(m.id) === m) restated.push(m)
    }
    this.isMod = f.self.mod === true
    this.name = cleanText(f.room.name, 60) || 'Room'
    this.host = this.byId.get(f.host) ?? null
    this.sort()

    this.values.clear()
    for (const [ch, data] of Object.entries(f.retained.room)) this.values.set(ch, data)
    this.playerValues.clear()
    for (const [pid, saved] of Object.entries(f.retained.player)) this.playerValues.set(pid, new Map(Object.entries(saved)))

    const presencesBefore = new Map(this.presences)
    this.presences.clear()
    this.presenceAt.clear()
    for (const [id, data, at] of f.presence) {
      if (data === null || id === this.self.id || !this.byId.has(id)) continue
      this.presences.set(id, data)
      this.presenceAt.set(id, this.local(at))
    }

    // Lines this page already has, so that after a gap only the ones it missed are handed out.
    const chatKey = (m: ChatMessage) => `${m.ts}|${m.from}|${m.text}`
    const chatBefore = new Set(this.chatLog.map(chatKey))
    this.chatLog.length = 0
    const tail = f.retained.tail[CHAT_CHANNEL] ?? []
    for (const e of tail.slice(-CHAT_KEPT)) {
      if (typeof e !== 'object' || e === null) continue
      const m = chatMessage(Number(e.from), String(e.pid), String(e.name), e.data, Number(e.ts), this.self.pid)
      if (m) this.chatLog.push(m)
    }

    this.takeLog(f.log)
    this.limits = {
      maxFrameBytes: f.limits?.maxFrameBytes ?? Number.POSITIVE_INFINITY,
      maxLogBytes: f.limits?.maxLogBytes ?? Number.POSITIVE_INFINITY,
    }
    // The server takes a new connection for a page that is in front.
    this.away = false
    if (first) {
      document.addEventListener('visibilitychange', this.seen)
      addEventListener('pagehide', this.going)
    }
    this.seen()

    this.resume = { member: this.self.id, token: f.token }
    this.welcomed = true
    this.attempts = 0
    this.p.onWelcome(this.resume)

    clearInterval(this.pinger)
    const ping = () => this.write({ t: 'ping', c: performance.now() })
    this.pinger = setInterval(ping, PING_MS)
    clearInterval(this.herer)
    this.herer = setInterval(this.stillHere, HERE_MS)

    // The server may have an older value than the game set while the connection was down, or none.
    this.mineSent = ''
    if (first) {
      this.status = 'open'
      ping()
      this.opening?.resolve()
      this.opening = null
      return
    }
    // Back after a gap: tell the game what changed while the connection was down.
    this.setStatus('open')
    ping()
    this.sendPresence()
    this.sendWaiting()
    for (const [id, m] of before) if (!this.byId.has(id) && m !== oldSelf) this.emit('member-leave', m, 'left')
    for (const [id, m] of this.byId) if (!before.has(id) && m !== this.self) this.emit('member-join', m)
    if (this.host !== oldHost) this.emit('host-change', this.host)
    for (const m of restated) if (this.byId.get(m.id) === m) this.emit('member-state', m, m.state)
    // Chat lines that came while the connection was down: the room kept them.
    for (const m of this.chatLog) {
      if (chatBefore.has(chatKey(m))) continue
      for (const h of [...this.chatHandlers]) this.guard(() => h(m))
    }
    for (const m of this.members) {
      const now = this.presences.get(m.id)
      if (now !== undefined) this.emitPresence(m, now, this.presenceAt.get(m.id) ?? performance.now())
      else if (presencesBefore.has(m.id) && before.get(m.id) === m) this.emitPresence(m, null, performance.now())
    }
    this.feed()
    this.emit(SYNC)
  }

  private keep(values: Map<string, unknown>, channel: string, data: unknown): void {
    if (data === null) values.delete(channel)
    else values.set(channel, data)
  }

  private emitPresence(member: Member, value: unknown, at: number): void {
    for (const h of [...this.presenceHandlers]) this.guard(() => h(member, value, at))
  }

  /**
   * A time on the server's clock as a time on this page's `performance.now()` clock: when a presence value reached
   * the server. Never later than now, which a reading of the clock that is off by a little could make it. Without
   * a time (a server from before it sent one), now.
   */
  private local(at: number | undefined): number {
    const now = performance.now()
    return at === undefined ? now : Math.min(now, now - (this.now() - at))
  }

  private member(info: MemberInfo): Member {
    const m: Member = {
      id: info.id,
      pid: String(info.pid),
      name: cleanName(info.name) || 'Player',
      order: info.order,
      rtt: null,
      state: 'here',
    }
    this.byId.set(m.id, m)
    return m
  }

  private sort(): void {
    this.members = [...this.byId.values()].sort((a, b) => a.order - b.order)
  }

  private setHost(id: number): void {
    const host = this.byId.get(id) ?? null
    if (host === this.host) return
    this.host = host
    this.emit('host-change', host)
  }

  private pushChat(m: ChatMessage): void {
    this.chatLog.push(m)
    if (this.chatLog.length > CHAT_KEPT) this.chatLog.shift()
    for (const h of [...this.chatHandlers]) this.guard(() => h(m))
  }

  private emit(name: keyof RoomEvents | string, ...args: unknown[]): void {
    const set = this.handlers.get(name)
    if (!set) return
    for (const h of [...set]) this.guard(() => (h as (...a: unknown[]) => void)(...args))
  }

  /** A handler that throws must not take the connection, or the other handlers, down with it. */
  private guard(run: () => void): void {
    try {
      run()
    } catch (err) {
      console.error('[p3p2] a handler threw', err)
    }
  }
}
