// Wire format of protocol 1. docs/protocol.md is the reference; this file is its executable form.
// The server reads only these envelopes. `data` is opaque: any JSON value, never interpreted.

export const PROTO: number = 1

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** Channel used by the client library's built-in chat. Names starting with `$` are reserved for it. */
export const CHAT_CHANNEL: string = '$chat'

export const NAME_MAX: number = 24
export const CHANNEL_MAX: number = 32
export const TARGETS_MAX: number = 64
export const TAIL_MAX: number = 50
/** Longest JSON header of a binary frame, in bytes. Room for 64 member ids in `to`. */
export const BINARY_HEADER_MAX: number = 2048

export type Target = 'others' | 'all' | 'host' | number | number[]
export type Retain = 'room' | 'player' | 'tail'

export type ErrorCode =
  | 'bad-frame'
  | 'proto'
  | 'auth'
  | 'origin'
  | 'player'
  | 'full'
  | 'rate'
  | 'forbidden'
  | 'too-big'
  | 'timeout'
  | 'version'
  | 'seq'
  | 'game'
  | 'name'

export type ByeReason = 'kicked' | 'ended' | 'replaced' | 'slow' | 'shutdown'
export type LeaveReason = 'left' | 'timeout' | 'kicked'
/**
 * Whether a member can be counted on right now. `here`: connected, its page in front, and heard
 * from lately. `away`: its page is in the background, where a browser slows it down or stops it.
 * `lost`: its connection is down, or nothing has come from it for a while (a page that froze, a
 * laptop whose lid was shut). Its place is kept for the grace period all the same.
 */
export type MemberState = 'here' | 'away' | 'lost'

// ---- client → server ----

export type Auth = { key: string } | { invite: string }

export interface HelloFrame {
  t: 'hello'
  proto: number
  auth: Auth
  player: { pid: string; secret: string }
  game: { id: string; version: string }
  name: string
  /** `lastSeq`: the number of the last op of the room's log this client has, if it has any of it. */
  resume?: { member: number; token: string; lastSeq?: number }
}

export interface MsgFrame {
  t: 'msg'
  ch: string
  data: Json
  to?: Target
  retain?: Retain
  /**
   * With `retain: 'room'` or `'player'`: save only if there is no value on this channel yet.
   * If there is one, nothing changes, and the sender alone is sent the value that is there.
   */
  first?: boolean
  volatile?: boolean
}

/** The member's presence: the latest value wins, and the server batches what it passes on. */
export interface PresFrame {
  t: 'pres'
  data: Json
  /**
   * When the game set the value, on the server's clock as the client reads it (epoch ms). The server passes it on
   * in place of the time it got the value, within limits. A server from before it ignores it.
   */
  at?: number
}

/** One change for the room's log. The server numbers it, saves it, and sends it to everyone. */
export interface OpFrame {
  t: 'op'
  op: Json
}

/** From the host: the state that the ops up to and including `upTo` led to. It replaces them. */
export interface SnapFrame {
  t: 'snap'
  data: Json
  upTo: number
}

/**
 * Whether this member's page is in the background, where a browser slows it down or stops it.
 * A page in front that has nothing else to send sends `away: false` again, at least once a
 * second: a member the server has not heard from for a while counts as `lost`.
 */
export interface AwayFrame {
  t: 'away'
  away: boolean
}

export interface PingFrame {
  t: 'ping'
  /** Client time, echoed back in `pong`. */
  c: number
}

export interface KickFrame {
  t: 'kick'
  id: number
}

export interface EndFrame {
  t: 'end'
}

/** Leave now, without the grace period a dropped connection gets. */
export interface LeaveFrame {
  t: 'leave'
}

export type ClientFrame =
  | HelloFrame
  | MsgFrame
  | PresFrame
  | OpFrame
  | SnapFrame
  | AwayFrame
  | PingFrame
  | KickFrame
  | EndFrame
  | LeaveFrame

/** The JSON header of a binary frame from a client. The payload follows it and is never read. */
export interface BinaryHeader {
  t: 'msg'
  ch: string
  to?: Target
  volatile?: boolean
  /**
   * A part of the payload for each receiver, in order: `[member id, bytes]`. Each member gets only its own part, as
   * a binary message of its own; the frame counts once against the sender's rate. Not together with `to`.
   */
  parts?: [number, number][]
}

// ---- server → client ----

export interface MemberInfo {
  id: number
  pid: string
  name: string
  order: number
}

export interface TailEntry {
  from: number
  pid: string
  name: string
  data: Json
  ts: number
}

export interface Retained {
  room: Record<string, Json>
  player: Record<string, Record<string, Json>>
  tail: Record<string, TailEntry[]>
}

/** One saved op. `pid` is the player who sent it: member ids do not outlive a visit. */
export interface LogEntry {
  seq: number
  pid: string
  op: Json
  ts: number
}

export interface WelcomeLog {
  /**
   * Present when the log is handed over whole: the snapshot its ops follow, or null when they
   * start from nothing. Absent when the ops continue from `hello.resume.lastSeq`.
   */
  snap?: { upTo: number; data: Json } | null
  ops: LogEntry[]
}

export interface WelcomeFrame {
  t: 'welcome'
  self: MemberInfo & { mod: boolean }
  room: { name: string }
  host: number
  members: MemberInfo[]
  /** The members that are not `here`, with their state. A server from before states existed sends none. */
  states?: [number, MemberState][]
  retained: Retained
  presence: PresenceEntry[]
  /** The room's saved log. A server from before the log existed sends none. */
  log?: WelcomeLog
  /**
   * `maxFrameBytes`: the largest frame this server accepts; a larger one closes the connection. `maxLogBytes`: how
   * large the room's log may grow, snapshot and ops together (a server from before it sends none).
   */
  limits?: { maxFrameBytes: number; maxLogBytes?: number }
  token: string
  now: number
}

export interface MsgOutFrame {
  t: 'msg'
  /** The member who sent it. 0: nobody who is here: a value the room already had (see `first`). */
  from: number
  ch: string
  data: Json
  ts: number
  /** Present when the message also replaced (or, with null data, cleared) a saved value. */
  retain?: 'room' | 'player'
}

/**
 * A member's presence as the server passes it on: member id, value, and the time the server got that value, on
 * its clock (epoch ms). A server from before the time existed sends only the first two; so does every server for
 * a cleared value.
 */
export type PresenceEntry = [id: number, data: Json, at?: number]

/** One batch per receiver per server tick. `null` data means the member cleared its presence. */
export interface PresOutFrame {
  t: 'pres'
  list: PresenceEntry[]
}

export interface OpOutFrame {
  t: 'op'
  seq: number
  from: number
  op: Json
  ts: number
}

/** To the host: the log has grown long, send a snapshot. */
export interface SnapAskFrame {
  t: 'snap'
}

/** The saved values of a player who is not in the room were dropped, to make room for new ones. */
export interface ForgetFrame {
  t: 'forget'
  pid: string
}

/** The JSON header of a binary frame from the server. */
export interface BinaryOutHeader {
  t: 'msg'
  from: number
  ch: string
  ts: number
}

export interface MemberJoinFrame extends MemberInfo {
  t: 'member+'
}

export interface MemberLeaveFrame {
  t: 'member-'
  id: number
  reason: LeaveReason
}

export interface MembersFrame {
  t: 'members'
  rtt: [number, number][]
}

export interface HostFrame {
  t: 'host'
  id: number
}

/** A member's state changed. Sent to the other members, never to the member itself. */
export interface StateFrame {
  t: 'state'
  id: number
  state: MemberState
}

export interface PongFrame {
  t: 'pong'
  c: number
  now: number
}

export interface ErrorFrame {
  t: 'error'
  code: ErrorCode
  message: string
}

export interface ByeFrame {
  t: 'bye'
  reason: ByeReason
}

export type ServerFrame =
  | WelcomeFrame
  | MsgOutFrame
  | PresOutFrame
  | OpOutFrame
  | SnapAskFrame
  | ForgetFrame
  | MemberJoinFrame
  | MemberLeaveFrame
  | MembersFrame
  | HostFrame
  | StateFrame
  | PongFrame
  | ErrorFrame
  | ByeFrame

// ---- REST (docs/protocol.md, "REST API") ----

export interface ServerInfo {
  name: string
  version: string
  protocols: number[]
  limits: { maxFrameBytes: number; msgRate: number; maxMembers: number }
  /** Where the server's source code is. Added within protocol 1: an older server leaves it out. */
  source?: string
}

export interface InviteGrant {
  code: string
  /** Epoch ms, or null while the room has members (the countdown starts when it empties). */
  expiresAt: number | null
}

export interface RoomInfo {
  name: string
  game: { url: string }
  maxMembers: number
  members: number
  invite?: InviteGrant
}

export interface InviteInfo {
  room: { name: string }
  hostName: string | null
  members: number
  maxMembers: number
}

export interface ApiError {
  error: string
  message: string
}

/** `GET /stats`, for whoever holds the server's stats token. Totals run from the server's start. */
export interface ServerStats {
  /** Server clock, epoch ms. */
  now: number
  /** Seconds since the server started. */
  uptime: number
  /** The server's own version, and that of the Node.js it runs on. */
  version: string
  node: string
  /** CPU time the process has used so far, in ms. Two readings give the share of a CPU in between. */
  cpu: { user: number; system: number }
  /** Bytes. */
  memory: { rss: number; heapUsed: number; heapTotal: number; external: number }
  /** How late the event loop ran, in ms, since the last reading that asked for a reset. */
  loop: { p50: number; p99: number; max: number }
  rooms: number
  /** Members of all rooms, those in their grace period included. */
  members: number
  /** Open WebSockets. */
  connections: number
  /** Totals: frames and WebSocket bytes, received and sent. */
  framesIn: number
  framesOut: number
  bytesIn: number
  bytesOut: number
  /** Totals: presence batches sent, and the times a receiver was passed over at a tick for being behind. */
  presenceOut: number
  presenceSkipped: number
  /** Total: volatile messages not sent because the receiver was behind. */
  volatileDropped: number
  /** Total: frames refused for coming faster than the rate limit allows. */
  rateDropped: number
  /**
   * Totals: what was received, by kind of frame. `bin` is a message with a binary payload;
   * `other` is everything a game does not send itself (hello, ping, away, …).
   */
  kinds: Record<'msg' | 'bin' | 'pres' | 'op' | 'snap' | 'other', { frames: number; bytes: number }>
  /** Total: write statements run on the database. */
  writes: number
}

// ---- validation ----

const ID_RE = /^[A-Za-z0-9_-]{16,64}$/
const GAME_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/
const VERSION_RE = /^[\x21-\x7e]{1,32}$/
const CHANNEL_RE = /^[A-Za-z0-9_.:$-]{1,32}$/

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isMemberId(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0
}

function isTime(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** A place in a room's log: 0 is "before the first op". */
function isSeq(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
}

export function isChannel(v: unknown): v is string {
  return typeof v === 'string' && CHANNEL_RE.test(v) && v !== '__proto__'
}

export function isPlayerId(v: unknown): v is string {
  return typeof v === 'string' && ID_RE.test(v)
}

/**
 * Makes text from a stranger safe to show: no control or formatting characters (bidi overrides,
 * zero-width), single spaces, at most `max` characters. Returns '' when nothing is left.
 */
export function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return ''
  const s = raw
    .slice(0, max * 8)
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  return Array.from(s).slice(0, max).join('').trim()
}

/** What a name keeps: letters, with their marks, and digits, of any language; spaces; and `. - _ '`. */
const NAME_DROP = /[^\p{L}\p{M}\p{Nd} ._'-]/gu

/**
 * A display name: cleaned, only the characters a name keeps, and at most NAME_MAX of them. Empty unless it has a
 * letter or a digit: a name of dots, or of emoji alone, is no name.
 */
export function cleanName(raw: unknown): string {
  const kept = cleanText(raw, NAME_MAX * 4).replace(NAME_DROP, '').replace(/ {2,}/g, ' ').trim()
  const name = Array.from(kept).slice(0, NAME_MAX).join('').trim()
  return /[\p{L}\p{Nd}]/u.test(name) ? name : ''
}

/** What two names are compared by: "Ada", "ADA" and "ａｄａ" are one name in a room. */
export function nameKey(name: string): string {
  return name.normalize('NFKC').toLowerCase()
}

export type Parsed<T> = { ok: true; frame: T } | { ok: false; why: string }

function bad(why: string): { ok: false; why: string } {
  return { ok: false, why }
}

function parseTarget(v: unknown): Target | undefined | null {
  if (v === undefined) return undefined
  if (v === 'others' || v === 'all' || v === 'host') return v
  if (isMemberId(v)) return v
  if (Array.isArray(v) && v.length <= TARGETS_MAX && v.every(isMemberId)) return v as number[]
  return null
}

/** Validates a frame sent by a client. Unknown fields are ignored; `data` is not inspected. */
export function parseClientFrame(text: string): Parsed<ClientFrame> {
  let f: unknown
  try {
    f = JSON.parse(text)
  } catch {
    return bad('not JSON')
  }
  if (!isObj(f)) return bad('not an object')
  switch (f.t) {
    case 'msg': {
      if (!isChannel(f.ch)) return bad('ch')
      if (f.data === undefined) return bad('data')
      const to = parseTarget(f.to)
      if (to === null) return bad('to')
      const retain = f.retain
      if (retain !== undefined && retain !== 'room' && retain !== 'player' && retain !== 'tail') return bad('retain')
      // A saved value is one value for everyone, so it cannot be sent to only some members.
      if ((retain === 'room' || retain === 'player') && to !== undefined && to !== 'all') return bad('to')
      if (f.volatile !== undefined && typeof f.volatile !== 'boolean') return bad('volatile')
      if (f.first !== undefined && typeof f.first !== 'boolean') return bad('first')
      // "Only if there is none yet" is about a saved value, and about setting one, not clearing it.
      if (f.first && ((retain !== 'room' && retain !== 'player') || f.data === null)) return bad('first')
      const frame: MsgFrame = { t: 'msg', ch: f.ch, data: f.data as Json }
      if (to !== undefined) frame.to = to
      if (retain !== undefined) frame.retain = retain
      if (f.first) frame.first = true
      if (f.volatile) frame.volatile = true
      return { ok: true, frame }
    }
    case 'pres':
      if (f.data === undefined) return bad('data')
      // A time that is not one is left out, not refused: it only makes the value's time less exact.
      return { ok: true, frame: isTime(f.at) ? { t: 'pres', data: f.data as Json, at: f.at } : { t: 'pres', data: f.data as Json } }
    case 'op':
      if (f.op === undefined) return bad('op')
      return { ok: true, frame: { t: 'op', op: f.op as Json } }
    case 'snap':
      if (f.data === undefined) return bad('data')
      if (!isSeq(f.upTo)) return bad('upTo')
      return { ok: true, frame: { t: 'snap', data: f.data as Json, upTo: f.upTo } }
    case 'away':
      if (typeof f.away !== 'boolean') return bad('away')
      return { ok: true, frame: { t: 'away', away: f.away } }
    case 'ping':
      if (!isTime(f.c)) return bad('c')
      return { ok: true, frame: { t: 'ping', c: f.c } }
    case 'hello': {
      if (typeof f.proto !== 'number') return bad('proto')
      const a = f.auth
      if (!isObj(a)) return bad('auth')
      let auth: Auth
      if (typeof a.key === 'string' && a.key.length <= 64) auth = { key: a.key }
      else if (typeof a.invite === 'string' && a.invite.length <= 64) auth = { invite: a.invite }
      else return bad('auth')
      const p = f.player
      if (!isObj(p) || !isPlayerId(p.pid) || !isPlayerId(p.secret)) return bad('player')
      const g = f.game
      if (!isObj(g) || typeof g.id !== 'string' || !GAME_ID_RE.test(g.id)) return bad('game.id')
      if (typeof g.version !== 'string' || !VERSION_RE.test(g.version)) return bad('game.version')
      if (typeof f.name !== 'string') return bad('name')
      const frame: HelloFrame = {
        t: 'hello',
        proto: f.proto,
        auth,
        player: { pid: p.pid, secret: p.secret },
        game: { id: g.id, version: g.version },
        name: f.name,
      }
      const r = f.resume
      if (r !== undefined) {
        if (!isObj(r) || !isMemberId(r.member) || typeof r.token !== 'string' || r.token.length > 64) {
          return bad('resume')
        }
        if (r.lastSeq !== undefined && !isSeq(r.lastSeq)) return bad('resume.lastSeq')
        frame.resume = { member: r.member, token: r.token }
        if (r.lastSeq !== undefined) frame.resume.lastSeq = r.lastSeq
      }
      return { ok: true, frame }
    }
    case 'kick':
      if (!isMemberId(f.id)) return bad('id')
      return { ok: true, frame: { t: 'kick', id: f.id } }
    case 'end':
      return { ok: true, frame: { t: 'end' } }
    case 'leave':
      return { ok: true, frame: { t: 'leave' } }
    default:
      return bad('t')
  }
}

/** Validates the header of a binary frame sent by a client. Binary messages cannot be retained. */
export function parseBinaryHeader(text: string): Parsed<BinaryHeader> {
  let f: unknown
  try {
    f = JSON.parse(text)
  } catch {
    return bad('not JSON')
  }
  if (!isObj(f) || f.t !== 'msg') return bad('t')
  if (!isChannel(f.ch)) return bad('ch')
  const to = parseTarget(f.to)
  if (to === null) return bad('to')
  if (f.retain !== undefined) return bad('retain')
  if (f.volatile !== undefined && typeof f.volatile !== 'boolean') return bad('volatile')
  const frame: BinaryHeader = { t: 'msg', ch: f.ch }
  if (f.parts !== undefined) {
    const parts = parseParts(f.parts)
    if (!parts || to !== undefined) return bad('parts')
    frame.parts = parts
  }
  if (to !== undefined) frame.to = to
  if (f.volatile) frame.volatile = true
  return { ok: true, frame }
}

/** `[member id, bytes]` pairs: at most one for each of 64 members, each id once. Null when malformed. */
function parseParts(v: unknown): [number, number][] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > TARGETS_MAX) return null
  const seen = new Set<number>()
  for (const part of v) {
    if (!Array.isArray(part) || part.length !== 2 || !isMemberId(part[0]) || seen.has(part[0])) return null
    if (!Number.isSafeInteger(part[1]) || part[1] < 0) return null
    seen.add(part[0])
  }
  return v as [number, number][]
}

/**
 * A binary frame: two bytes with the header's length (big-endian), the header as JSON text, then
 * the payload. Only the header is ever read by the server.
 */
export function encodeBinary(header: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const head = new TextEncoder().encode(header)
  if (head.length > BINARY_HEADER_MAX) throw new RangeError('binary frame header too long')
  const out = new Uint8Array(2 + head.length + payload.length)
  out[0] = head.length >> 8
  out[1] = head.length & 255
  out.set(head, 2)
  out.set(payload, 2 + head.length)
  return out
}

/** Splits a binary frame. The payload is a view into `bytes`, not a copy. Null when malformed. */
export function decodeBinary(bytes: Uint8Array): { header: string; payload: Uint8Array } | null {
  if (bytes.length < 2) return null
  const length = (bytes[0]! << 8) | bytes[1]!
  if (length > BINARY_HEADER_MAX || bytes.length < 2 + length) return null
  let header: string
  try {
    header = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(2, 2 + length))
  } catch {
    return null
  }
  return { header, payload: bytes.subarray(2 + length) }
}

/** Validates the header of a binary frame sent by a server. Null when malformed. */
export function parseBinaryOutHeader(text: string): BinaryOutHeader | null {
  let f: unknown
  try {
    f = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObj(f) || f.t !== 'msg') return null
  return isMemberId(f.from) && isChannel(f.ch) && isTime(f.ts) ? (f as never) : null
}

function isPresenceList(v: unknown): v is PresenceEntry[] {
  return Array.isArray(v) && v.every((p) => Array.isArray(p) && isMemberId(p[0]) && p[1] !== undefined && (p[2] === undefined || isTime(p[2])))
}

function isLogEntry(v: unknown): v is LogEntry {
  return isObj(v) && isSeq(v.seq) && v.seq > 0 && typeof v.pid === 'string' && v.op !== undefined && isTime(v.ts)
}

function isWelcomeLog(v: unknown): v is WelcomeLog {
  if (!isObj(v) || !Array.isArray(v.ops) || !v.ops.every(isLogEntry)) return false
  const s = v.snap
  return s === undefined || s === null || (isObj(s) && isSeq(s.upTo) && s.data !== undefined)
}

function isMemberState(v: unknown): v is MemberState {
  return v === 'here' || v === 'away' || v === 'lost'
}

function isMemberInfo(v: unknown): v is MemberInfo {
  return isObj(v) && isMemberId(v.id) && typeof v.pid === 'string' && typeof v.name === 'string' && isTime(v.order)
}

/**
 * Validates the envelope of a frame sent by a server. The client treats the server as untrusted:
 * a frame that fails here is dropped. Returns null for malformed or unknown frames.
 */
export function parseServerFrame(text: string): ServerFrame | null {
  let f: unknown
  try {
    f = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObj(f)) return null
  switch (f.t) {
    case 'msg':
      if (f.retain !== undefined && f.retain !== 'room' && f.retain !== 'player') return null
      return (isMemberId(f.from) || (f.from === 0 && f.retain === 'room')) && isChannel(f.ch) && f.data !== undefined && isTime(f.ts)
        ? (f as never)
        : null
    case 'pres':
      return isPresenceList(f.list) ? (f as never) : null
    case 'op':
      return isSeq(f.seq) && f.seq > 0 && isMemberId(f.from) && f.op !== undefined && isTime(f.ts) ? (f as never) : null
    case 'snap':
      return f as never
    case 'forget':
      return typeof f.pid === 'string' ? (f as never) : null
    case 'pong':
      return isTime(f.c) && isTime(f.now) ? (f as never) : null
    case 'member+':
      return isMemberInfo(f) ? (f as never) : null
    case 'member-':
      return isMemberId(f.id) ? (f as never) : null
    case 'members':
      return Array.isArray(f.rtt) && f.rtt.every((p) => Array.isArray(p) && isMemberId(p[0]) && isTime(p[1]))
        ? (f as never)
        : null
    case 'host':
      return isMemberId(f.id) ? (f as never) : null
    case 'state':
      return isMemberId(f.id) && isMemberState(f.state) ? (f as never) : null
    case 'error':
      return typeof f.code === 'string' && typeof f.message === 'string' ? (f as never) : null
    case 'bye':
      return typeof f.reason === 'string' ? (f as never) : null
    case 'welcome': {
      const r = f.retained
      if (!isMemberInfo(f.self) || !isObj(f.room) || typeof f.room.name !== 'string') return null
      if (!isMemberId(f.host) || !Array.isArray(f.members) || !f.members.every(isMemberInfo)) return null
      if (!isObj(r) || !isObj(r.room) || !isObj(r.player) || !isObj(r.tail)) return null
      if (!Object.values(r.tail).every(Array.isArray) || !Object.values(r.player).every(isObj)) return null
      if (!isPresenceList(f.presence)) return null
      if (f.states !== undefined && !(Array.isArray(f.states) && f.states.every((p) => Array.isArray(p) && isMemberId(p[0]) && isMemberState(p[1])))) return null
      if (f.log !== undefined && !isWelcomeLog(f.log)) return null
      if (f.limits !== undefined && (!isObj(f.limits) || !isTime(f.limits.maxFrameBytes))) return null
      if (f.limits?.maxLogBytes !== undefined && !isTime(f.limits.maxLogBytes)) return null
      if (typeof f.token !== 'string' || !isTime(f.now)) return null
      return f as never
    }
    default:
      return null
  }
}
