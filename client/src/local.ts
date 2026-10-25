// A room of one that runs in the page; nothing is sent anywhere. For a game that keeps one code
// path for playing alone and with friends: what it sends to 'all' or to the host, and what it
// saves, comes back to it the way a server would send it back.
//
// This module is a chunk of its own, so that a single-player visit does not load the room client.
// That is why it shares no code with room.ts.

import type {
  Chat,
  ChatMessage,
  Log,
  LogEntry,
  LogReader,
  Member,
  MessageHandler,
  Presence,
  Room,
  RoomEvents,
  RoomStatus,
  SendOptions,
} from './types.ts'

/** The same names room.ts refuses as channels, so code written against a local room works online. */
const EVENTS = new Set(['member-join', 'member-leave', 'host-change', 'member-state', 'latency', 'status', 'error', 'close'])

type Handler = (...args: never[]) => void

/** What arrives is a copy, as it would be after a trip through a server. Throws for what JSON cannot hold. */
const copyOf = (data: unknown): unknown => JSON.parse(JSON.stringify(data === undefined ? null : data))

class LocalRoom implements Room {
  readonly name = 'Local'
  readonly server = ''
  status: RoomStatus = 'open'
  readonly self: Member
  readonly members: Member[]
  readonly host: Member
  readonly isHost = true
  readonly inviteUrl = null
  readonly limits = { maxFrameBytes: Number.POSITIVE_INFINITY, maxLogBytes: Number.POSITIVE_INFINITY }
  readonly chat: Chat
  readonly presence: Presence
  readonly log: Log

  private readonly values = new Map<string, unknown>()
  private readonly playerValues = new Map<string, unknown>()
  private readonly handlers = new Map<string, Set<Handler>>()

  constructor(name: string) {
    this.self = { id: 1, pid: 'local', name, order: 1, rtt: 0, state: 'here' }
    this.host = this.self
    this.members = [this.self]

    const log: ChatMessage[] = []
    const listeners = new Set<(m: ChatMessage) => void>()
    this.chat = {
      messages: log,
      send: (text) => {
        const clean = String(text).trim()
        if (!clean || this.status !== 'open') return
        const m: ChatMessage = { from: 1, pid: this.self.pid, name: this.self.name, text: clean, ts: Date.now(), self: true }
        log.push(m)
        for (const h of [...listeners]) this.later(() => h(m))
      },
      on: (handler) => {
        listeners.add(handler)
        return () => listeners.delete(handler)
      },
    }

    let mine: unknown
    this.presence = {
      set: (value) => {
        mine = value === undefined ? null : value
      },
      get: (member) => ((typeof member === 'number' ? member : member.id) === 1 ? mine : undefined),
      at: () => undefined,
      // Presence goes to the others, and there are none.
      on: () => () => {},
    }

    // A log that is kept nowhere: every op comes back, numbered, the way a server would send it.
    let seq = 0
    let reader: LogReader | undefined
    const waiting: LogEntry[] = []
    let loading = false
    const feed = () => {
      while (reader && !loading && waiting.length) {
        const e = waiting.shift()!
        this.safely(() => reader?.apply(e.op, e))
      }
    }
    this.log = {
      get seq() {
        return seq - waiting.length
      },
      submit: (op) => {
        if (this.status !== 'open') return false
        let copy: unknown
        try {
          copy = copyOf(op)
        } catch {
          return false
        }
        waiting.push({ seq: ++seq, op: copy, pid: this.self.pid, from: this.self, ts: Date.now(), replayed: false })
        this.later(feed)
        return true
      },
      open: (r) => {
        if (reader) throw new Error('The log of this room is already open')
        reader = r
        let taking: unknown
        this.safely(() => (taking = r.load(undefined)))
        if (typeof (taking as { then?: unknown } | undefined)?.then !== 'function') {
          feed()
          return Promise.resolve()
        }
        // As in a real room: the ops wait until the state has been taken in.
        loading = true
        const done = () => {
          loading = false
          feed()
        }
        return (taking as Promise<void>).then(done, done)
      },
      snapshot: () => true,
    }
  }

  now(): number {
    return Date.now()
  }

  retained(channel: string, of?: { player: string }): unknown {
    if (!of) return this.values.get(channel)
    return of.player === this.self.pid ? this.playerValues.get(channel) : undefined
  }

  send(channel: string, data: unknown, options: SendOptions = {}): boolean {
    if (EVENTS.has(channel)) throw new TypeError(`"${channel}" is one of the room's own events; use another channel name`)
    if (this.status !== 'open') return false
    const binary = data instanceof ArrayBuffer || ArrayBuffer.isView(data)
    if (binary && options.retain) throw new TypeError('Binary data cannot be retained; send JSON on that channel instead')

    let copy: unknown
    try {
      if (data instanceof ArrayBuffer) copy = new Uint8Array(data.slice(0))
      else if (ArrayBuffer.isView(data)) copy = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
      else copy = copyOf(data)
    } catch {
      return false
    }

    const saved = options.retain === 'room' || options.retain === 'player'
    if (saved) {
      const values = options.retain === 'room' ? this.values : this.playerValues
      // `first`: the value that is there stays, and comes back in place of this one.
      if (options.first && values.has(channel)) copy = values.get(channel)
      else if (copy === null) values.delete(channel)
      else values.set(channel, copy)
    }
    const to = options.to
    const mine = saved || to === 'all' || to === 'host' || to === 1 || (Array.isArray(to) && to.includes(1))
    if (mine) this.later(() => this.emit(channel, copy, this.self, { ts: Date.now(), retained: saved }))
    return true
  }

  sendEach(channel: string, parts: Iterable<readonly [Member | number, ArrayBuffer | ArrayBufferView]>, options: { volatile?: boolean } = {}): boolean {
    // The only member is this one: its own part, if it named itself.
    for (const [to, data] of parts) {
      if ((typeof to === 'number' ? to : to.id) === this.self.id) return this.send(channel, data, { ...options, to: 'all' })
    }
    return this.status === 'open'
  }

  offer(channel: string, data: unknown): Promise<unknown> {
    this.send(channel, data, { retain: 'room', first: true })
    return Promise.resolve(this.values.get(channel))
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
    if (this.status === 'closed') return
    this.status = 'closed'
    this.emit('status', 'closed')
    this.emit('close', 'left')
  }

  /** Never inside the call that caused it: a message from a server would not arrive that way either. */
  private later(run: () => void): void {
    queueMicrotask(() => {
      if (this.status === 'open') run()
    })
  }

  private emit(name: string, ...args: unknown[]): void {
    for (const h of [...(this.handlers.get(name) ?? [])]) this.safely(() => (h as (...a: unknown[]) => void)(...args))
  }

  private safely(run: () => void): void {
    try {
      run()
    } catch (err) {
      console.error('[p3p2] a handler threw', err)
    }
  }
}

export function localRoom(name: string = 'Player'): Room {
  return new LocalRoom(name)
}
