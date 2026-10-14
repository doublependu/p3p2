// The public types of @p3p2/client. Nothing here pulls in code.

export type Corner = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'

export interface UiOptions {
  /** Where the panel sits. Default: top-right. */
  corner?: Corner
  /** The key that opens chat while a room is open. Default: Enter. `false` turns it off. */
  chatKey?: string | false
  /**
   * `false` for a game that has a button of its own for this, and no corner to spare: the
   * panel then shows no 👥 button, and opens when the game calls `p3p2.open()`.
   */
  button?: boolean
}

export interface P3P2Options {
  /** `version` is sent to the server, which can keep players on different versions apart. */
  game: { id: string; version: string }
  /** The built-in panel. `false` if the game brings its own menu and uses the API alone. */
  ui?: UiOptions | false
  /** The query parameter that carries the invite. Default: `room`. */
  urlParam?: string
}

/** An invite link, taken apart: which server, and which invite code on it. */
export interface Invite {
  server: string
  code: string
}

/**
 * Whether a member can be counted on right now. `here`: connected, its page in front, heard from
 * lately. `away`: its page is in the background, where a browser slows it down or stops it.
 * `lost`: its connection is down, or nothing has come from it for a few seconds (a page that froze,
 * a laptop whose lid was shut). Either way it keeps its place for a while, and may be back.
 */
export type MemberState = 'here' | 'away' | 'lost'

export interface Member {
  /** Unique in the room for as long as the member stays, reloads included. */
  readonly id: number
  /** The player's id on this server: the same on every visit from the same browser. */
  readonly pid: string
  name: string
  /** The order of joining. When the host goes, the earliest member who can take the role gets it. */
  order: number
  /** Round trip to the server in ms, or null until measured. */
  rtt: number | null
  /** As the server last said. Your own is always `here`. */
  state: MemberState
}

export type Target = 'others' | 'all' | 'host' | number | number[]

export interface SendOptions {
  /** Default: everyone else. `'all'` includes the sender. */
  to?: Target
  /**
   * `'room'`: the server keeps the last value of this channel for the room and gives it to
   * everyone who joins later.
   * `'player'`: the same, but one value per player: this player's value on this channel. It is
   * still there when the player comes back another day.
   * Both go to all members, the sender included, and `null` clears the value.
   * `'tail'`: the server keeps the last 50 messages of this channel while the room is open.
   */
  retain?: 'room' | 'player' | 'tail'
  /**
   * With `retain: 'room'` or `'player'`: save only if there is no value on this channel yet.
   * Otherwise nothing changes, and this player's handler for the channel is called with the
   * value that is there. `room.offer()` is this, with the answer as a promise.
   */
  first?: boolean
  /** May be dropped for a receiver whose connection is behind. For positions and the like. */
  volatile?: boolean
}

export interface ChatMessage {
  from: number
  pid: string
  name: string
  text: string
  /** Server time, epoch ms. */
  ts: number
  self: boolean
}

export type RoomStatus = 'open' | 'reconnecting' | 'closed'

/** Why a room closed. `lost`: the connection could not be restored. */
export type CloseReason = 'left' | 'kicked' | 'ended' | 'replaced' | 'lost'

export type LeaveReason = 'left' | 'timeout' | 'kicked'

export interface MessageMeta {
  /** Server time when the message was relayed, epoch ms. */
  ts: number
  /** True when the message set (or cleared) a saved value of the room or of the sending player. */
  retained: boolean
}

export interface RoomEvents {
  'member-join': (member: Member) => void
  'member-leave': (member: Member, reason: LeaveReason) => void
  'host-change': (host: Member | null) => void
  /**
   * A member went to the background, was lost, or is here again (`member.state`). For a game with
   * bodies in it: whose body nothing should wait for, or shoot at, while it is so.
   */
  'member-state': (member: Member, state: MemberState) => void
  /** Round-trip times (`member.rtt`) were updated. */
  latency: () => void
  status: (status: RoomStatus) => void
  /** The server refused something; the room stays open. */
  error: (problem: { code: string; message: string }) => void
  close: (reason: CloseReason) => void
}

/** `data` is what was sent: any JSON value, or a `Uint8Array` when the sender sent binary data. */
export type MessageHandler = (data: unknown, from: Member | null, meta: MessageMeta) => void

/**
 * Another member's presence changed. `value` is null when the member cleared it. `at` is when the server got the value, on this page's `performance.now()`
 * clock: for `Smooth.set`, which then draws the member where they were at that moment, and not where they were
 * when the batch happened to arrive, which is up to a twentieth of a second later, a different amount each time.
 */
export type PresenceHandler = (member: Member, value: unknown, at: number) => void

/**
 * Where each member is right now: one small value per member, of which only the latest counts.
 * The server passes changes on in batches (20 times a second by default), and drops them for a
 * player whose connection is behind. For positions, cursors, "is typing".
 */
export interface Presence {
  /** Sets this member's value. Call it as often as you like: at most 20 a second are sent, and never the same value twice. */
  set(value: unknown): void
  /** A member's latest value, or undefined if it has none. Takes a member or a member id. */
  get(member: Member | number): unknown
  /**
   * When the server got another member's latest value, on the `performance.now()` clock, as `on` gives it with a
   * change: for a value read with `get`, to go to `Smooth.set`. Undefined for this member, or one with no value.
   */
  at(member: Member | number): number | undefined
  /** Calls back when another member's value changes. Returns a function that stops it. */
  on(handler: PresenceHandler): () => void
}

/** One op of the room's log, as `apply` gets it. */
export interface LogEntry {
  /** Its number in the room's log: 1, 2, 3, … in the order the server took the ops. */
  readonly seq: number
  readonly op: unknown
  /** The player who sent it. */
  readonly pid: string
  /** The member who sent it, or null for an op from before this page was in the room. */
  readonly from: Member | null
  /** Server time when it was taken, epoch ms. */
  readonly ts: number
  /** True for an op that was saved before this page got it; false for one that arrives as it happens. */
  readonly replayed: boolean
}

export interface LogReader {
  /**
   * The state to start from: what the last snapshot held, or undefined when the log starts from
   * nothing. Called once inside `open()`, and again if the log has to be read from the start
   * after the connection was lost for long.
   *
   * It may return a promise, for a state that takes time to take in (one that has to be
   * unpacked, say). No op is given to `apply` until that promise has settled. Anything else
   * it returns is ignored.
   */
  load(state: unknown): unknown
  /** Every op after that state, in order: first the saved ones, then each new one as it arrives. */
  apply(op: unknown, entry: LogEntry): void
  /**
   * The state as it is now, as JSON-able data, for a snapshot. Called on the host when the
   * server asks for one, which it does as the log grows long.
   *
   * It may return a promise. What that resolves to has to be the state as it was when `save`
   * was called: ops that arrive while it is being packed are not part of it.
   */
  save?(): unknown
}

/**
 * State that is built up from many small changes and has to outlive the players: a world of
 * placed blocks, a board, a score sheet. Each change is an op. The server numbers the ops, saves
 * them, and gives them to everyone in the same order, the sender included, so a game that
 * changes its state only in `apply` has the same state on every screen.
 */
export interface Log {
  /** The number of the last op given to `apply`: inside `apply`, the number of that op. */
  readonly seq: number
  /**
   * Sends an op. It takes effect when it comes back through `apply`. While the connection is coming back the op
   * waits, and is sent when it is, in order. False if it never will be: the room is closed, the op is too big, or
   * 256 are waiting already.
   */
  submit(op: unknown): boolean
  /**
   * Starts reading. Once per room. `load` is called, and the saved ops are handed over, before
   * this returns, unless `load` returns a promise: then they follow when it settles. The
   * promise this returns resolves when all that was saved has been handed over, either way.
   */
  open(reader: LogReader): Promise<void>
  /**
   * For the host: saves `state` (or what `save()` returns) in place of the ops so far, so that
   * whoever joins later starts from it. False if this player is not the host, or it could not
   * be sent. With a `save()` that returns a promise, true means it will be sent when that resolves.
   */
  snapshot(state?: unknown): boolean
}

export interface Chat {
  /** Recent messages, oldest first. */
  readonly messages: readonly ChatMessage[]
  send(text: string): void
  /** Calls back for each new message. Returns a function that stops it. */
  on(handler: (message: ChatMessage) => void): () => void
}

export interface Room {
  /** The room's name, as the owner set it in the portal. */
  readonly name: string
  readonly server: string
  readonly status: RoomStatus
  readonly self: Member
  /** Everyone in the room, `self` included, in the order they joined. */
  readonly members: readonly Member[]
  readonly host: Member | null
  readonly isHost: boolean
  /** True for players who joined with the room URL: they can kick and end the session. */
  readonly isMod: boolean
  /** The link to share, or null when this player has none. */
  readonly inviteUrl: string | null
  /**
   * What this server takes, in bytes: the largest frame, and the largest the room's log may grow (snapshot and ops
   * together). A game whose state is "the newest so many things" sizes so many from it. Infinity where the server
   * does not say.
   */
  readonly limits: { readonly maxFrameBytes: number; readonly maxLogBytes: number }
  readonly chat: Chat
  readonly presence: Presence
  readonly log: Log

  /**
   * Sends `data` on a channel: anything JSON can hold, or binary data (an `ArrayBuffer` or a
   * typed array), which arrives as a `Uint8Array` and cannot be retained. Returns false if it
   * could not be sent, for example while reconnecting. A channel is any short name of letters,
   * digits and `_.:-`, except the names of the room's own events (`status`, `close`, …).
   */
  send(channel: string, data: unknown, options?: SendOptions): boolean
  /**
   * Sends each member something of its own, in one message: binary data for each, which arrives on the
   * channel as a `Uint8Array`, from this member, as if sent to that member alone. For a host that tells each
   * player what that player can see, or deals each a hand nobody else may read. It counts as one message
   * against this player's rate, however many members it is for. A member who is not in the room is skipped.
   * False if it could not be sent.
   */
  sendEach(channel: string, parts: Iterable<readonly [Member | number, ArrayBuffer | ArrayBufferView]>, options?: { volatile?: boolean }): boolean
  /** Listens to a channel, or to one of the room's own events. Returns a function that stops it. */
  on<E extends keyof RoomEvents>(event: E, handler: RoomEvents[E]): () => void
  on(channel: string, handler: MessageHandler): () => void
  /**
   * The value last saved on this channel, or undefined: the room's (`retain: 'room'`), or with
   * `{ player: pid }` that player's (`retain: 'player'`), whether or not the player is here now.
   */
  retained(channel: string, of?: { player: string }): unknown
  /**
   * Saves `data` as the room's value on a channel unless the room already has one, and
   * resolves to the value the room then has: this one, or the one that was there first. For
   * what whoever comes first decides for everybody, like the seed of the world:
   * `const world = await room.offer('world', { seed })`. Two players who offer at the same
   * moment get the same answer. Resolves to undefined if the room closes first.
   */
  offer(channel: string, data: unknown): Promise<unknown>
  /** The server's clock, epoch ms: the same for every member, give or take the network. */
  now(): number
  leave(): void
  /** For mods. */
  kick(memberId: number): void
  /** For mods: disconnects everyone and closes the invite. */
  end(): void
}

/** What an invite leads to, for a "Join?" prompt. */
export interface InviteDetails {
  roomName: string
  hostName: string | null
  members: number
  maxMembers: number
}

export interface JoinOptions {
  /** Ask the player in the panel first. Default: true when the panel is on. */
  ask?: boolean
  name?: string
}

/** Errors thrown by this library carry a stable `code` next to the message. */
export interface P3P2Error extends Error {
  code: string
}

export interface P3P2Events {
  /** A room started: the player joined, hosted, or came back after a reload. */
  room: (room: Room) => void
  /** The room is over for this player. */
  leave: (reason: CloseReason) => void
}
