// The room hub: members, host election, routing, presence, retained messages, the log, limits.
// No I/O happens here. Sockets arrive as `Conn`, storage as `HubStore`, time as `now()`,
// and timers as calls to `tick()`, `flushPresence()` and `flushLog()`. That keeps every rule
// in this file unit-testable.

import {
  type ByeReason,
  cleanName,
  decodeBinary,
  type ErrorCode,
  encodeBinary,
  type HelloFrame,
  INVITE_CODE_RE,
  type Json,
  type LeaveReason,
  type MemberInfo,
  type MemberState,
  type MsgFrame,
  PROTO,
  parseBinaryHeader,
  parseClientFrame,
  ROOM_KEY_RE,
  type ServerFrame,
  TAIL_MAX,
  type TailEntry,
  type Target,
  type WelcomeFrame,
} from '@p3p2/protocol'
import { newToken, safeEqual, sha256 } from './ids.ts'
import { Bucket, type Limits } from './limits.ts'
import type { Conn, HubStore, OpBatch, OpRecord, RetainScope, RoomRecord, VersionPolicy } from './types.ts'

/** How much earlier than its arrival a presence value may say it was set, ms. */
const PRESENCE_SAID_MS = 1000

interface Member {
  id: number
  pid: string
  name: string
  /** Election rank: the member with the lowest order is the host. */
  order: number
  /** Joined with the room key: may kick, end the session, renew the invite. */
  mod: boolean
  token: string
  game: { id: string; version: string }
  session: Session | null
  /** When the connection dropped; 0 while connected. */
  goneAt: number
  /** Its page is in the background, where a browser slows it down: not a place for the host. */
  away: boolean
  /** When a frame last came from it. A page in front says something at least once a second. */
  heardAt: number
  /** What the others were last told of it: see `stateOf`. */
  state: MemberState
  /** The latest presence, also as the JSON text that is passed on, and when it arrived. */
  presence: { data: Json; json: string; at: number } | null
  /** Was behind when presence went out, so it is owed everyone's latest value. */
  presenceOwed: boolean
}

interface Saved {
  data: Json
  bytes: number
  /** When it was saved, or when its player last came in. The oldest make room first. */
  ts: number
}

/** A piece of the log as the JSON text `welcome` carries, so that a long log is never parsed or built twice. */
interface Logged {
  /** For an op its number; for a snapshot the number of the last op it replaces. */
  seq: number
  json: string
  bytes: number
}

interface RoomLog {
  /** The state the ops start from, or null when they start from nothing. */
  snap: Logged | null
  /** The ops after the snapshot, oldest first. */
  ops: Logged[]
  /** Of the snapshot and the ops together: what the room's cap counts. */
  bytes: number
  /** The number of the last op. */
  seq: number
  /** Ops that storage does not have yet. */
  unsaved: OpRecord[]
  /** The member that was asked for a snapshot and has not sent one; 0 when nobody was. */
  asked: number
}

function loggedOp(o: OpRecord): Logged {
  // A player id holds only letters, digits, _ and -, so it needs no escaping.
  const json = `{"seq":${o.seq},"pid":"${o.pid}","op":${o.op},"ts":${o.ts}}`
  return { seq: o.seq, json, bytes: Buffer.byteLength(json) }
}

function loggedSnap(upTo: number, data: string): Logged {
  const json = `{"upTo":${upTo},"data":${data}}`
  return { seq: upTo, json, bytes: Buffer.byteLength(json) }
}

interface Tailed {
  entry: TailEntry
  bytes: number
  seq: number
}

interface LiveRoom {
  id: number
  name: string
  members: Map<number, Member>
  nextId: number
  nextOrder: number
  host: number
  /** Saved values: the room's by channel, each player's by player id and channel. */
  values: Map<string, Saved>
  playerValues: Map<string, Map<string, Saved>>
  /** Of both kinds together: they share the room's cap. */
  valueBytes: number
  tails: Map<string, Tailed[]>
  tailBytes: number
  tailSeq: number
  /** Members whose presence changed since it last went out. */
  presenceChanged: Set<Member>
  log: RoomLog
}

export class Session {
  readonly conn: Conn
  readonly origin: string
  readonly ip: string
  /** Round trip measured by the socket layer, in ms; -1 until known. */
  rtt: number = -1
  open: boolean = true
  member: Member | null = null
  room: LiveRoom | null = null
  readonly frames: Bucket
  readonly bytes: Bucket
  lastRateError: number = 0
  /** What is left to send of `welcome`, at most. A long saved log does not make a receiver slow. */
  welcomeLeft: number = 0

  constructor(conn: Conn, origin: string, ip: string, limits: Limits, now: number) {
    this.conn = conn
    this.origin = origin
    this.ip = ip
    this.frames = new Bucket(limits.msgRate, limits.msgBurst, now)
    this.bytes = new Bucket(limits.bytesRate, limits.bytesBurst, now)
  }

  get joined(): boolean {
    return this.member !== null
  }
}

export interface LiveMember extends MemberInfo {
  mod: boolean
  connected: boolean
  away: boolean
  state: MemberState
  rtt: number
}

export interface LiveInfo {
  host: number
  members: LiveMember[]
}

/** Totals since the process started, for the stats endpoint. No rule in this file reads them. */
export interface HubCounters {
  framesIn: number
  framesOut: number
  /** Presence batches sent, and the times a receiver was passed over at a tick for being behind. */
  presenceOut: number
  presenceSkipped: number
  /** Volatile messages not sent because the receiver was behind. */
  volatileDropped: number
  /** Frames refused for coming faster than the rate limit allows. */
  rateDropped: number
  /** What was received, taken apart by kind of frame: how many, and how many bytes. */
  kinds: Record<FrameKind, { frames: number; bytes: number }>
}

/** `bin` is a message with a binary payload; `other` is everything a game does not send itself. */
export type FrameKind = 'msg' | 'bin' | 'pres' | 'op' | 'snap' | 'other'

export interface HubOptions {
  store: HubStore
  limits: Limits
  now?: () => number
  /** Called for joins, leaves and refusals. Never receives message contents or whole secrets. */
  log?: (event: string, detail: Record<string, unknown>) => void
}

function info(m: Member): MemberInfo {
  return { id: m.id, pid: m.pid, name: m.name, order: m.order }
}

function sameVersion(policy: VersionPolicy, a: string, b: string): boolean {
  if (policy === 'off') return true
  if (policy === 'exact') return a === b
  const major = (v: string) => v.split('.', 1)[0]
  return major(a) === major(b)
}

export class Hub {
  private readonly store: HubStore
  private readonly limits: Limits
  private readonly now: () => number
  private readonly log: (event: string, detail: Record<string, unknown>) => void
  private readonly rooms = new Map<number, LiveRoom>()
  /** Rooms with presence to send. Most rooms are quiet at most ticks; only these are visited. */
  private readonly presenceDue = new Set<LiveRoom>()
  /** Rooms with ops that storage does not have yet. */
  private readonly logDue = new Set<LiveRoom>()
  readonly counters: HubCounters = {
    framesIn: 0,
    framesOut: 0,
    presenceOut: 0,
    presenceSkipped: 0,
    volatileDropped: 0,
    rateDropped: 0,
    kinds: {
      msg: { frames: 0, bytes: 0 },
      bin: { frames: 0, bytes: 0 },
      pres: { frames: 0, bytes: 0 },
      op: { frames: 0, bytes: 0 },
      snap: { frames: 0, bytes: 0 },
      other: { frames: 0, bytes: 0 },
    },
  }

  constructor(options: HubOptions) {
    this.store = options.store
    this.limits = options.limits
    this.now = options.now ?? Date.now
    this.log = options.log ?? (() => {})
  }

  // ---- connections ----

  open(conn: Conn, origin: string, ip: string): Session {
    return new Session(conn, origin, ip, this.limits, this.now())
  }

  receive(s: Session, text: string, bytes: number = text.length): void {
    if (!s.open) return
    this.counters.framesIn++
    const now = this.now()
    this.heard(s, now)
    if (!this.admit(s, now, bytes)) return
    const parsed = parseClientFrame(text)
    if (!parsed.ok) return this.fail(s, 'bad-frame', `Malformed frame (${parsed.why})`)
    const f = parsed.frame
    this.tally(f.t === 'msg' || f.t === 'pres' || f.t === 'op' || f.t === 'snap' ? f.t : 'other', bytes)
    try {
      if (f.t === 'hello') {
        if (s.joined) return this.fail(s, 'bad-frame', 'Already joined')
        return this.hello(s, f, now)
      }
      const m = s.member
      const room = s.room
      if (!m || !room) return this.fail(s, 'bad-frame', 'Say hello first')
      switch (f.t) {
        case 'msg':
          return this.msg(s, m, room, f, now)
        case 'pres':
          return this.pres(s, m, room, f.data, f.at, now)
        case 'op':
          return this.op(s, m, room, f.op, now)
        case 'snap':
          return this.snap(s, m, room, f.data, f.upTo, now)
        case 'away':
          // Also what a page in front says when it has nothing else to say: it has been heard.
          if (m.away === f.away) return
          m.away = f.away
          return this.restate(room, m, now)
        case 'ping':
          return this.send(s, { t: 'pong', c: f.c, now })
        case 'leave':
          this.remove(room, m, 'left')
          return this.drop(s)
        case 'kick': {
          if (!m.mod) return this.warn(s, 'forbidden', 'Only the room key holder can do that')
          const target = room.members.get(f.id)
          if (target) this.kickMember(room, target)
          return
        }
        case 'end':
          if (!m.mod) return this.warn(s, 'forbidden', 'Only the room key holder can do that')
          return this.endRoom(room, 'ended', true)
      }
    } catch (err) {
      // For example a value nested too deeply to serialize. Never let one frame take the hub down.
      this.log('frame-error', { error: String(err) })
      this.fail(s, 'bad-frame', 'Could not process frame')
    }
  }

  /** A binary frame: a JSON header the hub reads, and a payload it passes on untouched. */
  receiveBinary(s: Session, bytes: Uint8Array): void {
    if (!s.open) return
    this.counters.framesIn++
    const now = this.now()
    this.heard(s, now)
    if (!this.admit(s, now, bytes.length)) return
    const m = s.member
    const room = s.room
    if (!m || !room) return this.fail(s, 'bad-frame', 'Say hello first')
    const parts = decodeBinary(bytes)
    if (!parts) return this.fail(s, 'bad-frame', 'Malformed binary frame')
    const parsed = parseBinaryHeader(parts.header)
    if (!parsed.ok) return this.fail(s, 'bad-frame', `Malformed binary frame (${parsed.why})`)
    const f = parsed.frame
    this.tally('bin', bytes.length)
    const header = `{"t":"msg","from":${m.id},"ch":${JSON.stringify(f.ch)},"ts":${now}}`
    if (f.parts) return this.split(s, room, f.parts, header, parts.payload, f.volatile === true)
    this.route(room, m, f.to ?? 'others', encodeBinary(header, parts.payload), f.volatile === true)
  }

  /**
   * A binary message with a part for each receiver: each member named gets its own part, as a binary message of its
   * own. The parts must add up to the payload. A member who is not in the room is skipped, as with `to`.
   */
  private split(s: Session, room: LiveRoom, list: [number, number][], header: string, payload: Uint8Array, droppable: boolean): void {
    let total = 0
    for (const [, length] of list) total += length
    if (total !== payload.length) return this.fail(s, 'bad-frame', `Malformed binary frame (the parts add up to ${total} bytes, the payload is ${payload.length})`)
    let at = 0
    for (const [id, length] of list) {
      this.deliver(room.members.get(id), encodeBinary(header, payload.subarray(at, at + length)), droppable)
      at += length
    }
  }

  /** Something came from this member: it is not lost, whatever else the frame is. */
  private heard(s: Session, now: number): void {
    const m = s.member
    if (!m) return
    m.heardAt = now
    if (m.state === 'lost' && s.room) this.restate(s.room, m, now)
  }

  private tally(kind: FrameKind, bytes: number): void {
    const k = this.counters.kinds[kind]
    k.frames++
    k.bytes += bytes
  }

  /** The rate limits. Checked before parsing, so a flood costs the server as little as possible. */
  private admit(s: Session, now: number, bytes: number): boolean {
    if (s.frames.take(now) && s.bytes.take(now, bytes)) return true
    this.counters.rateDropped++
    if (now - s.lastRateError >= 1000) {
      s.lastRateError = now
      this.send(s, { t: 'error', code: 'rate', message: 'Too many messages; some were dropped' })
    }
    return false
  }

  /** The socket closed. The member keeps its slot for the grace period. */
  closed(s: Session): void {
    s.open = false
    const m = s.member
    const room = s.room
    s.member = null
    s.room = null
    if (m && room && m.session === s) {
      m.session = null
      m.goneAt = this.now()
      this.restate(room, m, m.goneAt)
      this.elect(room, m.goneAt)
    }
  }

  /** Runs time-based rules. The socket layer calls it about once a second. */
  tick(): void {
    const now = this.now()
    for (const room of [...this.rooms.values()]) {
      for (const m of [...room.members.values()]) {
        if (m.goneAt && now - m.goneAt >= this.limits.graceMs) this.remove(room, m, 'timeout')
        else this.restate(room, m, now)
      }
      // A host that has not been heard from for a while gives way before its slot does.
      if (room.members.size) this.elect(room, now)
    }
  }

  /** Writes the ops that arrived since the last call to storage, together. The socket layer calls it a few times a second. */
  flushLog(): void {
    if (this.logDue.size) this.saveOps([...this.logDue])
    this.logDue.clear()
  }

  /**
   * Passes on the presence that changed since the last call: one frame per receiver, without
   * the receiver's own value. The socket layer calls it at the presence rate.
   */
  flushPresence(): void {
    for (const room of this.presenceDue) {
      const changed = room.presenceChanged
      // With the time the value arrived: a receiver that draws from it should date it by that, not by when the
      // batch reached it, which is up to a tick later and by a different amount each time.
      const entry = (m: Member) => (m.presence ? `[${m.id},${m.presence.json},${m.presence.at}]` : `[${m.id},null]`)
      const list = (members: Iterable<Member>, except: Member) => {
        let out = ''
        for (const m of members) if (m !== except) out += out ? `,${entry(m)}` : entry(m)
        return out
      }
      const everything = [...changed].map(entry).join(',')
      let owing = false
      for (const to of room.members.values()) {
        const s = to.session
        // A member that is away gets everyone's presence in `welcome` when it comes back.
        if (!s) continue
        if (s.conn.buffered() > this.limits.volatileBufferedBytes) {
          // Behind: skip it now, and send it everyone's latest value once it has caught up.
          to.presenceOwed = true
          owing = true
          this.counters.presenceSkipped++
          continue
        }
        let entries = everything
        if (to.presenceOwed) entries = list(room.members.values(), to)
        else if (changed.has(to)) entries = list(changed, to)
        to.presenceOwed = false
        if (!entries) continue
        this.counters.presenceOut++
        this.deliver(to, `{"t":"pres","list":[${entries}]}`, false)
      }
      changed.clear()
      if (!owing) this.presenceDue.delete(room)
    }
  }

  /** Tells every room its members' round-trip times. The socket layer calls it every few seconds. */
  broadcastRtt(): void {
    for (const room of this.rooms.values()) {
      const rtt: [number, number][] = []
      for (const m of room.members.values()) if (m.session && m.session.rtt >= 0) rtt.push([m.id, m.session.rtt])
      if (rtt.length) this.broadcast(room, { t: 'members', rtt })
    }
  }

  // ---- for the portal and the REST API ----

  live(roomId: number): LiveInfo | null {
    const room = this.rooms.get(roomId)
    if (!room) return null
    const members = [...room.members.values()].map((m) => ({
      ...info(m),
      mod: m.mod,
      connected: m.session !== null,
      away: m.away,
      state: m.state,
      rtt: m.session?.rtt ?? -1,
    }))
    return { host: room.host, members }
  }

  memberCount(roomId: number): number {
    return this.rooms.get(roomId)?.members.size ?? 0
  }

  hostName(roomId: number): string | null {
    const room = this.rooms.get(roomId)
    return room?.members.get(room.host)?.name ?? null
  }

  kick(roomId: number, memberId: number): boolean {
    const room = this.rooms.get(roomId)
    const target = room?.members.get(memberId)
    if (!room || !target) return false
    this.kickMember(room, target)
    return true
  }

  /** Disconnects everyone and, unless told otherwise, revokes the invite. */
  end(roomId: number, reason: ByeReason = 'ended', revoke: boolean = true): void {
    const room = this.rooms.get(roomId)
    if (room) this.endRoom(room, reason, revoke)
    else if (revoke) this.store.revokeInvites(roomId, this.now())
  }

  /** Server shutdown: say goodbye, and start the invites' expiry countdown. */
  shutdown(): void {
    for (const room of [...this.rooms.values()]) {
      for (const m of room.members.values()) if (m.session) this.bye(m.session, 'shutdown')
      room.members.clear()
      this.closeRoom(room)
    }
  }

  get roomCount(): number {
    return this.rooms.size
  }

  /** Members of all live rooms together, those in their grace period included. */
  get memberTotal(): number {
    let n = 0
    for (const room of this.rooms.values()) n += room.members.size
    return n
  }

  // ---- joining ----

  private hello(s: Session, f: HelloFrame, now: number): void {
    if (f.proto !== PROTO) return this.fail(s, 'proto', `This server speaks protocol ${PROTO}`)

    let rec: RoomRecord | null = null
    const mod = 'key' in f.auth
    if ('key' in f.auth) {
      if (ROOM_KEY_RE.test(f.auth.key)) rec = this.store.roomByKey(f.auth.key)
    } else if (INVITE_CODE_RE.test(f.auth.invite)) {
      const invite = this.store.inviteByCode(f.auth.invite, now)
      if (invite) rec = this.store.roomById(invite.roomId)
      // Renewing an invite must not cut off the members who joined with the old one: a member
      // coming back with its resume token is let in on the strength of the token.
      else if (f.resume) rec = this.resumable(f)
    }
    if (!rec) {
      this.log('refused', { code: 'auth', ip: s.ip })
      return this.fail(s, 'auth', mod ? 'Unknown room' : 'This invite is not valid any more')
    }
    if (!rec.origins.includes(s.origin)) {
      this.log('refused', { code: 'origin', room: rec.id, origin: s.origin })
      return this.fail(s, 'origin', `This room does not accept players from ${s.origin}`)
    }
    // A room is held to the game it was first played with: another game on the same site would read a log and
    // values that are not its own. A game whose parts are several pages gives them all one game id.
    if (rec.gameId !== null && rec.gameId !== f.game.id) {
      this.log('refused', { code: 'game', room: rec.id, has: rec.gameId, got: f.game.id })
      return this.fail(s, 'game', `This room is for another game (${rec.gameId})`)
    }
    if (!this.store.checkPlayer(f.player.pid, sha256(f.player.secret), now)) {
      return this.fail(s, 'player', 'This player id belongs to someone else')
    }

    let room = this.rooms.get(rec.id)
    let member: Member | undefined
    if (f.resume && room) {
      const m = room.members.get(f.resume.member)
      if (m && m.pid === f.player.pid && safeEqual(m.token, f.resume.token)) member = m
    }

    // Players whose copies of the game differ would not understand each other's messages.
    if (room) {
      let first: Member | null = null
      for (const other of room.members.values()) {
        if (other !== member && (!first || other.order < first.order)) first = other
      }
      if (first && !sameVersion(rec.versionPolicy, first.game.version, f.game.version)) {
        this.log('refused', { code: 'version', room: rec.id, has: first.game.version, got: f.game.version })
        return this.fail(s, 'version', `This room is playing version ${first.game.version} of the game; yours is ${f.game.version}`)
      }
    }

    // Where the client's copy of the log ends, when it is the same member coming back with one.
    const lastSeq = member ? f.resume?.lastSeq : undefined
    if (member) {
      // Same member, new connection: a reload, a network blip, or the tab was duplicated.
      const old = member.session
      if (old) {
        old.member = null
        old.room = null
        this.bye(old, 'replaced')
      }
      member.game = f.game
    } else {
      const cap = Math.min(rec.maxMembers, this.limits.maxMembersCap)
      if (room && room.members.size >= cap) return this.fail(s, 'full', 'The room is full')
      if (!room) room = this.openRoom(rec)
      const id = room.nextId++
      member = {
        id,
        pid: f.player.pid,
        name: cleanName(f.name) || `Player ${id}`,
        order: room.nextOrder++,
        mod,
        token: newToken(),
        game: f.game,
        session: null,
        goneAt: 0,
        away: false,
        heardAt: now,
        state: 'here',
        presence: null,
        presenceOwed: false,
      }
      this.broadcast(room, { t: 'member+', ...info(member) })
      room.members.set(id, member)
      if (!room.host) room.host = id
      // What this player saved here is in use again: it is the last to make room for others.
      const mine = room.playerValues.get(member.pid)
      if (mine) {
        for (const v of mine.values()) v.ts = now
        this.store.touchPlayer(room.id, member.pid, now)
      }
      this.log('join', { room: room.id, member: id, members: room.members.size })
    }

    room = room!
    room.name = rec.name
    // The first game in is the game the room is held to.
    if (rec.gameId === null) this.store.holdGame(rec.id, f.game.id)
    member.session = s
    member.goneAt = 0
    // A page that has just connected counts as in front until it says otherwise.
    member.away = false
    member.heardAt = now
    member.presenceOwed = false
    s.member = member
    s.room = room

    const values = (saved: Map<string, Saved>) => Object.fromEntries([...saved].map(([ch, v]) => [ch, v.data]))
    const presence: WelcomeFrame['presence'] = []
    for (const other of room.members.values()) {
      if (other !== member && other.presence) presence.push([other.id, other.presence.data, other.presence.at])
    }
    const welcome: WelcomeFrame = {
      t: 'welcome',
      self: { ...info(member), mod: member.mod },
      room: { name: room.name },
      host: room.host,
      members: [...room.members.values()].map(info),
      states: [...room.members.values()].filter((m) => m !== member && m.state !== 'here').map((m) => [m.id, m.state]),
      retained: {
        room: values(room.values),
        player: Object.fromEntries([...room.playerValues].map(([pid, saved]) => [pid, values(saved)])),
        tail: Object.fromEntries([...room.tails].map(([ch, list]) => [ch, list.map((t) => t.entry)])),
      },
      presence,
      limits: { maxFrameBytes: this.limits.maxFrameBytes, maxLogBytes: this.limits.maxLogBytes },
      token: member.token,
      now,
    }
    // The log is spliced in as the text it is kept as.
    const out = `${JSON.stringify(welcome).slice(0, -1)},"log":${this.logJson(room.log, lastSeq)}}`
    s.welcomeLeft = Buffer.byteLength(out)
    this.counters.framesOut++
    s.conn.send(out)

    // A host that was asked for a snapshot before its connection dropped may never have heard.
    if (room.log.asked === member.id) room.log.asked = 0
    // The others are told that a member who was lost is here again.
    this.restate(room, member, now)
    // Whoever just came in may be better placed to be the host than a host that is away.
    this.elect(room, now)
    this.wantSnapshot(room)
  }

  private resumable(f: HelloFrame): RoomRecord | null {
    if (!('invite' in f.auth) || !f.resume) return null
    const roomId = this.store.roomIdOfInvite(f.auth.invite)
    const m = roomId === null ? undefined : this.rooms.get(roomId)?.members.get(f.resume.member)
    if (!m || m.pid !== f.player.pid || !safeEqual(m.token, f.resume.token)) return null
    return this.store.roomById(roomId!)
  }

  private openRoom(rec: RoomRecord): LiveRoom {
    const room: LiveRoom = {
      id: rec.id,
      name: rec.name,
      members: new Map(),
      nextId: 1,
      nextOrder: 1,
      host: 0,
      values: new Map(),
      playerValues: new Map(),
      valueBytes: 0,
      tails: new Map(),
      tailBytes: 0,
      tailSeq: 0,
      presenceChanged: new Set(),
      log: { snap: null, ops: [], bytes: 0, seq: 0, unsaved: [], asked: 0 },
    }
    for (const r of this.store.loadRetained(rec.id)) {
      const bytes = Buffer.byteLength(r.data) + r.ch.length + r.pid.length
      this.keep(room, r.pid, r.ch, { data: JSON.parse(r.data) as Json, bytes, ts: r.ts })
    }
    const saved = this.store.loadLog(rec.id)
    const log = room.log
    if (saved.snap) log.snap = loggedSnap(saved.snap.upTo, saved.snap.data)
    log.seq = log.snap?.seq ?? 0
    log.bytes = log.snap?.bytes ?? 0
    for (const record of saved.ops) {
      if (record.seq <= log.seq) continue
      const op = loggedOp(record)
      log.ops.push(op)
      log.seq = op.seq
      log.bytes += op.bytes
    }
    this.rooms.set(rec.id, room)
    // While the room has members its invite does not expire.
    this.store.setInviteExpiry(rec.id, null)
    return room
  }

  // ---- messages ----

  private msg(s: Session, m: Member, room: LiveRoom, f: MsgFrame, now: number): void {
    const json = JSON.stringify(f.data)
    // A saved value goes to everyone, the sender included: all members then apply the values
    // in the one order the server saw them, and their copies cannot drift apart.
    const saved = f.retain === 'room' || f.retain === 'player' ? f.retain : null
    if (saved && f.first) {
      // Whoever was first keeps it. Nothing changes and nobody else hears of it; the sender is
      // told what the room has, in the place where its own value would have come back.
      const had = this.saved(room, saved === 'player' ? m.pid : '')?.get(f.ch)
      if (had) {
        const from = saved === 'player' ? m.id : 0
        return this.deliver(m, `{"t":"msg","from":${from},"ch":${JSON.stringify(f.ch)},"data":${JSON.stringify(had.data)},"ts":${had.ts},"retain":"${saved}"}`, false)
      }
    }
    if (saved) {
      if (!this.save(room, saved === 'player' ? m.pid : '', f.ch, f.data, json, now)) {
        return this.warn(s, 'too-big', 'The room is over its size cap for saved values')
      }
    } else if (f.retain === 'tail') {
      this.pushTail(room, f.ch, { from: m.id, pid: m.pid, name: m.name, data: f.data, ts: now }, json.length)
    }

    const out = `{"t":"msg","from":${m.id},"ch":${JSON.stringify(f.ch)},"data":${json},"ts":${now}${saved ? `,"retain":"${saved}"` : ''}}`
    this.route(room, m, saved ? 'all' : (f.to ?? 'others'), out, f.volatile === true && f.retain === undefined)
  }

  private route(room: LiveRoom, m: Member, to: Target, out: string | Uint8Array, droppable: boolean): void {
    if (to === 'others' || to === 'all') {
      for (const other of room.members.values()) {
        if (other !== m || to === 'all') this.deliver(other, out, droppable)
      }
    } else if (to === 'host') {
      this.deliver(room.members.get(room.host), out, droppable)
    } else if (typeof to === 'number') {
      this.deliver(room.members.get(to), out, droppable)
    } else {
      for (const id of new Set(to)) this.deliver(room.members.get(id), out, droppable)
    }
  }

  // In the three methods below, `pid` is the player whose value it is, or '' for a value of the room.

  private saved(room: LiveRoom, pid: string): Map<string, Saved> | undefined {
    return pid ? room.playerValues.get(pid) : room.values
  }

  private keep(room: LiveRoom, pid: string, ch: string, value: Saved): void {
    let values = this.saved(room, pid)
    if (!values) {
      values = new Map()
      room.playerValues.set(pid, values)
    }
    room.valueBytes += value.bytes - (values.get(ch)?.bytes ?? 0)
    values.set(ch, value)
  }

  /** Replaces a saved value or, with null, clears it. False when it would not fit under the room's cap. */
  private save(room: LiveRoom, pid: string, ch: string, data: Json, json: string, now: number): boolean {
    const scope: RetainScope = pid ? 'player' : 'room'
    const values = this.saved(room, pid)
    const old = values?.get(ch)?.bytes ?? 0
    if (data === null) {
      if (values?.delete(ch)) {
        room.valueBytes -= old
        if (pid && values.size === 0) room.playerValues.delete(pid)
        this.store.deleteRetained(room.id, scope, pid, ch)
      }
      return true
    }
    const bytes = Buffer.byteLength(json) + ch.length + pid.length
    const over = room.valueBytes - old + bytes - this.limits.maxRetainedBytes
    if (over > 0 && !this.makeRoom(room, over)) return false
    this.keep(room, pid, ch, { data, bytes, ts: now })
    this.store.putRetained(room.id, scope, pid, ch, json, now)
    return true
  }

  /**
   * Frees `need` bytes of saved values by forgetting players who are not in the room, whoever
   * was here longest ago first. False, with nothing forgotten, when that would not be enough.
   */
  private makeRoom(room: LiveRoom, need: number): boolean {
    const here = new Set<string>()
    for (const m of room.members.values()) here.add(m.pid)
    const gone: { pid: string; bytes: number; ts: number }[] = []
    for (const [pid, values] of room.playerValues) {
      if (here.has(pid)) continue
      let bytes = 0
      let ts = 0
      for (const v of values.values()) {
        bytes += v.bytes
        ts = Math.max(ts, v.ts)
      }
      gone.push({ pid, bytes, ts })
    }
    gone.sort((a, b) => a.ts - b.ts)
    let count = 0
    let freed = 0
    while (freed < need && count < gone.length) freed += gone[count++]!.bytes
    if (freed < need) return false
    for (const { pid, bytes } of gone.slice(0, count)) {
      room.playerValues.delete(pid)
      room.valueBytes -= bytes
      this.store.forgetPlayer(room.id, pid)
      // The members hold copies of every player's values.
      this.broadcast(room, { t: 'forget', pid })
    }
    this.log('forget', { room: room.id, players: count })
    return true
  }

  private pres(s: Session, m: Member, room: LiveRoom, data: Json, said: number | undefined, now: number): void {
    if (data === null) {
      if (!m.presence) return
      m.presence = null
    } else {
      const json = JSON.stringify(data)
      if (Buffer.byteLength(json) > this.limits.maxPresenceBytes) {
        return this.warn(s, 'too-big', `Presence is limited to ${this.limits.maxPresenceBytes} bytes`)
      }
      if (json === m.presence?.json) return
      // When the sender says it set the value, if it says, so that the time does not carry the jitter of its
      // connection: never later than now, nor earlier than a second ago or than its value before.
      let at = now
      if (said !== undefined) at = Math.max(Math.min(said, now), now - PRESENCE_SAID_MS, m.presence?.at ?? 0)
      m.presence = { data, json, at }
    }
    room.presenceChanged.add(m)
    this.presenceDue.add(room)
  }

  // ---- the log ----

  /** Numbers an op, keeps it, and sends it to everyone, the sender included. */
  private op(s: Session, m: Member, room: LiveRoom, op: Json, now: number): void {
    const log = room.log
    const record: OpRecord = { seq: log.seq + 1, pid: m.pid, op: JSON.stringify(op), ts: now }
    const entry = loggedOp(record)
    if (log.bytes + entry.bytes > this.limits.maxLogBytes) {
      this.wantSnapshot(room)
      return this.warn(s, 'too-big', 'The log of this room is full until the host saves a snapshot')
    }
    log.seq = record.seq
    log.ops.push(entry)
    log.bytes += entry.bytes
    log.unsaved.push(record)
    this.logDue.add(room)
    this.route(room, m, 'all', `{"t":"op","seq":${record.seq},"from":${m.id},"op":${record.op},"ts":${now}}`, false)
    this.wantSnapshot(room)
  }

  /** The host's state after the ops up to and including `upTo`. It takes their place. */
  private snap(s: Session, m: Member, room: LiveRoom, data: Json, upTo: number, now: number): void {
    if (room.host !== m.id) return this.warn(s, 'forbidden', 'Only the host can save a snapshot')
    const log = room.log
    if (upTo > log.seq || upTo < (log.snap?.seq ?? 0)) {
      return this.warn(s, 'seq', `A snapshot must end between op ${log.snap?.seq ?? 0} and op ${log.seq}; this one ends at ${upTo}`)
    }
    const json = JSON.stringify(data)
    const snap = loggedSnap(upTo, json)
    const ops = log.ops.filter((o) => o.seq > upTo)
    const bytes = ops.reduce((sum, o) => sum + o.bytes, snap.bytes)
    if (bytes > this.limits.maxLogBytes) {
      return this.warn(s, 'too-big', 'This snapshot is larger than the log this room may keep')
    }
    // Storage first: the ops are let go of only once the snapshot that replaces them is down.
    this.store.putSnapshot(room.id, upTo, json, now)
    log.snap = snap
    log.ops = ops
    log.bytes = bytes
    log.unsaved = log.unsaved.filter((o) => o.seq > upTo)
    log.asked = 0
  }

  /**
   * Asks the host for a snapshot once the ops have used up half of what the snapshot leaves of
   * the room's cap. Each host is asked once; a snapshot, or a new host, starts that over.
   */
  private wantSnapshot(room: LiveRoom): void {
    const log = room.log
    const taken = log.snap?.bytes ?? 0
    if ((log.bytes - taken) * 2 < this.limits.maxLogBytes - taken || log.ops.length === 0) return
    const host = room.members.get(room.host)
    if (!host?.session || log.asked === host.id) return
    log.asked = host.id
    this.send(host.session, { t: 'snap' })
  }

  /** The log as `welcome` carries it: whole, or only what follows the op the client has last. */
  private logJson(log: RoomLog, lastSeq: number | undefined): string {
    // What the client has can be continued unless a snapshot has since replaced the ops after it.
    if (lastSeq === undefined || lastSeq < (log.snap?.seq ?? 0) || lastSeq > log.seq) {
      return `{"snap":${log.snap?.json ?? 'null'},"ops":[${log.ops.map((o) => o.json).join(',')}]}`
    }
    let missed = ''
    for (const o of log.ops) if (o.seq > lastSeq) missed += missed ? `,${o.json}` : o.json
    return `{"ops":[${missed}]}`
  }

  private saveOps(rooms: LiveRoom[]): void {
    const batches: OpBatch[] = []
    for (const room of rooms) if (room.log.unsaved.length) batches.push({ roomId: room.id, ops: room.log.unsaved })
    if (!batches.length) return
    try {
      this.store.appendOps(batches)
    } catch (err) {
      if (rooms.length === 1) {
        // These stay in memory, and are tried again with the room's next ones.
        return this.log('log-error', { room: rooms[0]!.id, error: String(err) })
      }
      // One room at a time, then, so that what is wrong with one does not hold up the others.
      for (const room of rooms) this.saveOps([room])
      return
    }
    for (const room of rooms) room.log.unsaved = []
  }

  private pushTail(room: LiveRoom, ch: string, entry: TailEntry, size: number): void {
    const bytes = size + entry.name.length + 64
    if (bytes > this.limits.maxTailBytes) return
    let list = room.tails.get(ch)
    if (!list) {
      list = []
      room.tails.set(ch, list)
    }
    list.push({ entry, bytes, seq: room.tailSeq++ })
    room.tailBytes += bytes
    if (list.length > TAIL_MAX) room.tailBytes -= list.shift()!.bytes
    // Over the room's budget: forget the oldest message of any channel.
    while (room.tailBytes > this.limits.maxTailBytes) {
      let oldest: Tailed[] | null = null
      for (const l of room.tails.values()) {
        if (l.length && (!oldest || l[0]!.seq < oldest[0]!.seq)) oldest = l
      }
      if (!oldest) break
      room.tailBytes -= oldest.shift()!.bytes
    }
    for (const [name, l] of room.tails) if (!l.length) room.tails.delete(name)
  }

  private deliver(to: Member | undefined, out: string | Uint8Array, droppable: boolean): void {
    const s = to?.session
    if (!s) return
    if (droppable && s.conn.buffered() > this.limits.volatileBufferedBytes) {
      this.counters.volatileDropped++
      return
    }
    this.counters.framesOut++
    s.conn.send(out)
    const queued = s.conn.buffered()
    if (queued < s.welcomeLeft) s.welcomeLeft = queued
    if (queued - s.welcomeLeft > this.limits.maxBufferedBytes) {
      // Too far behind to catch up. It keeps its slot and can resume.
      this.log('slow', { room: s.room?.id, member: to?.id })
      this.bye(s, 'slow')
      this.closed(s)
    }
  }

  // ---- leaving ----

  private kickMember(room: LiveRoom, target: Member): void {
    const s = target.session
    this.remove(room, target, 'kicked')
    if (s) this.bye(s, 'kicked')
  }

  private remove(room: LiveRoom, m: Member, reason: LeaveReason): void {
    if (!room.members.delete(m.id)) return
    room.presenceChanged.delete(m)
    const s = m.session
    if (s) {
      s.member = null
      s.room = null
      m.session = null
    }
    this.log('leave', { room: room.id, member: m.id, reason, members: room.members.size })
    this.broadcast(room, { t: 'member-', id: m.id, reason })
    if (room.members.size === 0) return this.closeRoom(room)
    if (room.host === m.id) this.elect(room, this.now())
  }

  /**
   * `here`: connected, its page in front, and heard from lately. `away`: its page is in the
   * background, where it may not be heard from for long. `lost`: its connection is down, or it
   * has said nothing for `quietMs` with its page in front: frozen, or cut off.
   */
  private stateOf(m: Member, now: number): MemberState {
    if (!m.session) return 'lost'
    if (m.away) return 'away'
    return now - m.heardAt < this.limits.quietMs ? 'here' : 'lost'
  }

  /**
   * Can this host go on being the host? Not with its page in the background. Connected, as long
   * as something comes from it: a page in front says something every second, and one that has
   * stopped does not. Disconnected, for `hostGraceMs`: a connection that drops usually comes back
   * within a few seconds, and the role with it.
   */
  private leads(m: Member, now: number): boolean {
    if (m.away) return false
    return m.session ? now - m.heardAt < this.limits.quietMs : now - m.goneAt < this.limits.hostGraceMs
  }

  /** Tells the others when a member's state has changed, and finds the host again if it has. */
  private restate(room: LiveRoom, m: Member, now: number): void {
    const state = this.stateOf(m, now)
    if (state === m.state) return
    m.state = state
    const out = JSON.stringify({ t: 'state', id: m.id, state })
    for (const o of room.members.values()) if (o !== m && o.session) this.deliver(o, out, false)
    this.elect(room, now)
  }

  /**
   * Makes sure the room has a host that can act. The host keeps the role for as long as its page
   * is in front and it is heard from; a dropped connection gets a moment to come back. Then the
   * role passes to whoever is better placed, the earliest to have joined first, and does not pass
   * back.
   */
  private elect(room: LiveRoom, now: number): void {
    const host = room.members.get(room.host)
    if (host && this.leads(host, now)) return
    // Here, away, lost.
    const rank = (m: Member) => {
      const state = this.stateOf(m, now)
      return state === 'here' ? 0 : state === 'away' ? 1 : 2
    }
    let best: Member | undefined
    for (const m of room.members.values()) {
      if (m !== host && (!best || rank(m) < rank(best) || (rank(m) === rank(best) && m.order < best.order))) best = m
    }
    if (!best || (host && rank(best) >= rank(host))) return
    room.host = best.id
    this.broadcast(room, { t: 'host', id: best.id })
    this.wantSnapshot(room)
  }

  private endRoom(room: LiveRoom, reason: ByeReason, revoke: boolean): void {
    for (const m of room.members.values()) {
      const s = m.session
      if (!s) continue
      s.member = null
      s.room = null
      this.bye(s, reason)
    }
    room.members.clear()
    this.closeRoom(room)
    if (revoke) this.store.revokeInvites(room.id, this.now())
    this.log('end', { room: room.id, reason })
  }

  private closeRoom(room: LiveRoom): void {
    this.rooms.delete(room.id)
    this.presenceDue.delete(room)
    this.saveOps([room])
    this.logDue.delete(room)
    this.store.setInviteExpiry(room.id, this.now() + this.limits.inviteTtlMs)
  }

  // ---- sending ----

  private send(s: Session, frame: ServerFrame): void {
    if (!s.open) return
    this.counters.framesOut++
    s.conn.send(JSON.stringify(frame))
  }

  private broadcast(room: LiveRoom, frame: ServerFrame): void {
    const out = JSON.stringify(frame)
    for (const m of room.members.values()) if (m.session) this.deliver(m, out, false)
  }

  /** Reports a problem and keeps the connection. */
  private warn(s: Session, code: ErrorCode, message: string): void {
    this.send(s, { t: 'error', code, message })
  }

  /** Reports a problem and closes the connection. */
  fail(s: Session, code: ErrorCode, message: string): void {
    this.send(s, { t: 'error', code, message })
    this.drop(s)
  }

  private bye(s: Session, reason: ByeReason): void {
    this.send(s, { t: 'bye', reason })
    this.drop(s)
  }

  private drop(s: Session): void {
    if (!s.open) return
    s.open = false
    s.conn.close()
  }
}
