/** How alike the game versions of a room's members must be. */
export type VersionPolicy = 'exact' | 'major' | 'off'

export const VERSION_POLICIES: readonly VersionPolicy[] = ['exact', 'major', 'off']

/** How many of the invite code's last characters the front page may leave out of a room's link. */
export const FRONT_HIDDEN: readonly number[] = [0, 2, 3, 4, 8]

export interface RoomRecord {
  id: number
  key: string
  name: string
  gameUrl: string
  origins: string[]
  maxMembers: number
  versionPolicy: VersionPolicy
  /** The game id the room was first played with, which it is held to; null until then. */
  gameId: string | null
  /**
   * Null when the room is not on the server's front page. Otherwise how many of its invite code's last characters
   * the link there leaves out, for the player to type: one of `FRONT_HIDDEN`.
   */
  front: number | null
  createdAt: number
}

export interface InviteRecord {
  code: string
  roomId: number
  createdAt: number
  /** null while the room has members: the countdown starts when it empties. */
  expiresAt: number | null
  revokedAt: number | null
  /** The game page the host created the invite from, and the game's URL parameter. */
  page: string | null
  param: string | null
}

export type RetainScope = 'room' | 'player'

export interface RetainedRecord {
  scope: RetainScope
  pid: string
  ch: string
  /** JSON text. The server stores and returns it without looking inside. */
  data: string
  ts: number
}

/** One op of a room's log, as it is stored. */
export interface OpRecord {
  seq: number
  pid: string
  /** JSON text. */
  op: string
  ts: number
}

/** New ops of one room's log. */
export interface OpBatch {
  roomId: number
  ops: OpRecord[]
}

/** A room's saved log: the last snapshot, and the ops after it, oldest first. */
export interface LogRecord {
  /** `data` is JSON text. */
  snap: { upTo: number; data: string } | null
  ops: OpRecord[]
}

/** What the hub needs from storage. */
export interface HubStore {
  roomByKey(key: string): RoomRecord | null
  roomById(id: number): RoomRecord | null
  inviteByCode(code: string, now: number): InviteRecord | null
  /** The room an invite code was issued for, even if the code has since expired or been revoked. */
  roomIdOfInvite(code: string): number | null
  /**
   * The rooms a code is a try for: those on the front page whose link there leaves characters out, and whose valid
   * invite starts with the characters the link shows of it, as the code does.
   */
  roomsTried(code: string, now: number): number[]
  /** Trust on first use: registers an unknown pid, afterwards accepts it only with the same secret. */
  checkPlayer(pid: string, secretHash: string, now: number): boolean
  /** Holds a room to a game id, or (null) lets any game in. */
  holdGame(roomId: number, gameId: string | null): void
  loadRetained(roomId: number): RetainedRecord[]
  putRetained(roomId: number, scope: RetainScope, pid: string, ch: string, data: string, ts: number): void
  deleteRetained(roomId: number, scope: RetainScope, pid: string, ch: string): void
  /** Marks a player's saved values as used now, and forgets them. */
  touchPlayer(roomId: number, pid: string, ts: number): void
  forgetPlayer(roomId: number, pid: string): void
  loadLog(roomId: number): LogRecord
  /** Appends ops to the logs of one or more rooms in one write: all of them, or none. */
  appendOps(batches: OpBatch[]): void
  /** Saves a snapshot in place of the one before, and of the stored ops up to and including `upTo`. */
  putSnapshot(roomId: number, upTo: number, data: string, ts: number): void
  setInviteExpiry(roomId: number, expiresAt: number | null): void
  revokeInvites(roomId: number, now: number): void
}

/** One connection, as the hub sees it. */
export interface Conn {
  /** Text goes out as a text frame, bytes as a binary frame. */
  send(data: string | Uint8Array): void
  /** Closes after flushing what was sent. */
  close(): void
  /** Bytes queued and still to be written to the socket. */
  buffered(): number
}
