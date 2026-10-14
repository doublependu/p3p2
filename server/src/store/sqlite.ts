import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import type {
  HubStore,
  InviteRecord,
  LogRecord,
  OpBatch,
  OpRecord,
  RetainedRecord,
  RetainScope,
  RoomRecord,
  VersionPolicy,
} from '../core/types.ts'
import { MIGRATIONS } from './migrations.ts'

type Row = Record<string, unknown>

function room(r: Row): RoomRecord {
  return {
    id: r.id as number,
    key: r.key as string,
    name: r.name as string,
    gameUrl: r.game_url as string,
    origins: JSON.parse(r.origins as string) as string[],
    maxMembers: r.max_members as number,
    versionPolicy: r.version_policy as VersionPolicy,
    gameId: (r.game_id as string | null) ?? null,
    createdAt: r.created_at as number,
  }
}

function invite(r: Row): InviteRecord {
  return {
    code: r.code as string,
    roomId: r.room_id as number,
    createdAt: r.created_at as number,
    expiresAt: r.expires_at as number | null,
    revokedAt: r.revoked_at as number | null,
    page: r.page as string | null,
    param: r.param as string | null,
  }
}

export interface NewRoom {
  key: string
  name: string
  gameUrl: string
  origins: string[]
  maxMembers: number
  /** Default: exact. */
  versionPolicy?: VersionPolicy
}

/** All durable state. `node:sqlite` is synchronous; every call here is a few microseconds. */
export class Store implements HubStore {
  private readonly db: DatabaseSync
  private readonly statements = new Map<string, StatementSync>()
  /** Write statements run since the process started, for the stats endpoint. */
  writes: number = 0

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000')
    this.migrate()
  }

  close(): void {
    this.statements.clear()
    this.db.close()
  }

  private migrate(): void {
    const { user_version: version } = this.db.prepare('PRAGMA user_version').get() as { user_version: number }
    if (version > MIGRATIONS.length) {
      throw new Error(`The database is at schema ${version}; this server only knows up to ${MIGRATIONS.length}`)
    }
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.db.exec(`BEGIN; ${MIGRATIONS[v]}; PRAGMA user_version = ${v + 1}; COMMIT`)
    }
  }

  private q(sql: string): StatementSync {
    let st = this.statements.get(sql)
    if (!st) {
      st = this.db.prepare(sql)
      this.statements.set(sql, st)
    }
    return st
  }

  private get(sql: string, ...args: SQLInputValue[]): Row | undefined {
    return this.q(sql).get(...args) as Row | undefined
  }

  private all(sql: string, ...args: SQLInputValue[]): Row[] {
    return this.q(sql).all(...args) as Row[]
  }

  private run(sql: string, ...args: SQLInputValue[]): number {
    this.writes++
    return Number(this.q(sql).run(...args).changes)
  }

  /** Several writes that count as one: all of them happen, or none. */
  private together(fn: () => void): void {
    this.db.exec('BEGIN')
    try {
      fn()
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  // ---- owner and portal sessions ----

  ownerHash(): string | null {
    return (this.get('SELECT password_hash FROM owner WHERE id = 1')?.password_hash as string | undefined) ?? null
  }

  setOwnerHash(hash: string, now: number): void {
    this.run(
      `INSERT INTO owner (id, password_hash, updated_at) VALUES (1, ?, ?)
       ON CONFLICT (id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at`,
      hash,
      now,
    )
  }

  createSession(tokenHash: string, now: number, expiresAt: number): void {
    this.run('INSERT INTO portal_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)', tokenHash, now, expiresAt)
  }

  hasSession(tokenHash: string, now: number): boolean {
    return this.get('SELECT 1 FROM portal_sessions WHERE token_hash = ? AND expires_at > ?', tokenHash, now) !== undefined
  }

  deleteSession(tokenHash: string): void {
    this.run('DELETE FROM portal_sessions WHERE token_hash = ?', tokenHash)
  }

  deleteAllSessions(): void {
    this.run('DELETE FROM portal_sessions')
  }

  // ---- rooms ----

  createRoom(r: NewRoom, now: number): RoomRecord {
    this.run(
      'INSERT INTO rooms (key, name, game_url, origins, max_members, version_policy, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      r.key,
      r.name,
      r.gameUrl,
      JSON.stringify(r.origins),
      r.maxMembers,
      r.versionPolicy ?? 'exact',
      now,
    )
    return this.roomByKey(r.key)!
  }

  listRooms(): RoomRecord[] {
    return this.all('SELECT * FROM rooms ORDER BY created_at DESC, id DESC').map(room)
  }

  countRooms(): number {
    return this.get('SELECT count(*) AS n FROM rooms')!.n as number
  }

  roomByKey(key: string): RoomRecord | null {
    const r = this.get('SELECT * FROM rooms WHERE key = ?', key)
    return r ? room(r) : null
  }

  roomById(id: number): RoomRecord | null {
    const r = this.get('SELECT * FROM rooms WHERE id = ?', id)
    return r ? room(r) : null
  }

  updateRoom(id: number, r: { name: string; origins: string[]; maxMembers: number; versionPolicy: VersionPolicy }): void {
    this.run(
      'UPDATE rooms SET name = ?, origins = ?, max_members = ?, version_policy = ? WHERE id = ?',
      r.name,
      JSON.stringify(r.origins),
      r.maxMembers,
      r.versionPolicy,
      id,
    )
  }

  rotateKey(id: number, key: string): void {
    this.run('UPDATE rooms SET key = ? WHERE id = ?', key, id)
  }

  deleteRoom(id: number): void {
    this.run('DELETE FROM rooms WHERE id = ?', id)
  }

  /** Every origin some room accepts: what CORS preflights and WebSocket upgrades are checked against. */
  allOrigins(): Set<string> {
    const out = new Set<string>()
    for (const r of this.all('SELECT origins FROM rooms')) {
      for (const o of JSON.parse(r.origins as string) as string[]) out.add(o)
    }
    return out
  }

  // ---- invites ----

  inviteByCode(code: string, now: number): InviteRecord | null {
    const r = this.get(
      'SELECT * FROM invites WHERE code = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)',
      code,
      now,
    )
    return r ? invite(r) : null
  }

  roomIdOfInvite(code: string): number | null {
    return (this.get('SELECT room_id FROM invites WHERE code = ?', code)?.room_id as number | undefined) ?? null
  }

  /** The room's valid invite, if it has one. A room has at most one. */
  currentInvite(roomId: number, now: number): InviteRecord | null {
    const r = this.get(
      `SELECT * FROM invites WHERE room_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY created_at DESC LIMIT 1`,
      roomId,
      now,
    )
    return r ? invite(r) : null
  }

  createInvite(roomId: number, code: string, now: number, expiresAt: number | null): InviteRecord {
    this.run('INSERT INTO invites (code, room_id, created_at, expires_at) VALUES (?, ?, ?, ?)', code, roomId, now, expiresAt)
    return this.inviteByCode(code, now)!
  }

  setInvitePage(code: string, page: string, param: string): void {
    this.run('UPDATE invites SET page = ?, param = ? WHERE code = ?', page, param, code)
  }

  setInviteExpiry(roomId: number, expiresAt: number | null): void {
    this.run('UPDATE invites SET expires_at = ? WHERE room_id = ? AND revoked_at IS NULL', expiresAt, roomId)
  }

  revokeInvites(roomId: number, now: number): void {
    this.run('UPDATE invites SET revoked_at = ? WHERE room_id = ? AND revoked_at IS NULL', now, roomId)
  }

  /**
   * After a crash, invites of rooms that were live have no expiry. Start their countdown,
   * and forget invites that have been dead for a week.
   */
  recoverInvites(now: number, ttlMs: number): void {
    this.run('UPDATE invites SET expires_at = ? WHERE expires_at IS NULL AND revoked_at IS NULL', now + ttlMs)
    const cutoff = now - 7 * 24 * 3600_000
    this.run('DELETE FROM invites WHERE revoked_at < ? OR expires_at < ?', cutoff, cutoff)
  }

  // ---- players ----

  checkPlayer(pid: string, secretHash: string, now: number): boolean {
    const r = this.get('SELECT secret_hash FROM players WHERE pid = ?', pid)
    if (!r) {
      this.run('INSERT INTO players (pid, secret_hash, first_seen, last_seen) VALUES (?, ?, ?, ?)', pid, secretHash, now, now)
      return true
    }
    if (r.secret_hash !== secretHash) return false
    this.run('UPDATE players SET last_seen = ? WHERE pid = ?', now, pid)
    return true
  }

  // ---- retained messages ----

  loadRetained(roomId: number): RetainedRecord[] {
    return this.all('SELECT scope, pid, ch, data, ts FROM retained WHERE room_id = ?', roomId) as unknown as RetainedRecord[]
  }

  putRetained(roomId: number, scope: RetainScope, pid: string, ch: string, data: string, ts: number): void {
    this.run(
      `INSERT INTO retained (room_id, scope, pid, ch, data, ts) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (room_id, scope, pid, ch) DO UPDATE SET data = excluded.data, ts = excluded.ts`,
      roomId,
      scope,
      pid,
      ch,
      data,
      ts,
    )
  }

  deleteRetained(roomId: number, scope: RetainScope, pid: string, ch: string): void {
    this.run('DELETE FROM retained WHERE room_id = ? AND scope = ? AND pid = ? AND ch = ?', roomId, scope, pid, ch)
  }

  touchPlayer(roomId: number, pid: string, ts: number): void {
    this.run("UPDATE retained SET ts = ? WHERE room_id = ? AND scope = 'player' AND pid = ?", ts, roomId, pid)
  }

  forgetPlayer(roomId: number, pid: string): void {
    this.run("DELETE FROM retained WHERE room_id = ? AND scope = 'player' AND pid = ?", roomId, pid)
  }

  /** Everything the game saved in the room: its values, and its log. */
  clearSaved(roomId: number): void {
    this.together(() => {
      this.run('DELETE FROM retained WHERE room_id = ?', roomId)
      this.run('DELETE FROM ops WHERE room_id = ?', roomId)
      this.run('DELETE FROM snapshots WHERE room_id = ?', roomId)
      // A room with nothing saved is held to no game: what it held was the reason.
      this.run('UPDATE rooms SET game_id = NULL WHERE id = ?', roomId)
    })
  }

  /** Holds a room to a game, or (null) lets any game in until the next one plays in it. */
  holdGame(roomId: number, gameId: string | null): void {
    this.run('UPDATE rooms SET game_id = ? WHERE id = ?', gameId, roomId)
  }

  retainedBytes(roomId: number): number {
    return (this.get('SELECT coalesce(sum(length(data)), 0) AS n FROM retained WHERE room_id = ?', roomId)!.n as number) ?? 0
  }

  // ---- the log ----

  loadLog(roomId: number): LogRecord {
    const s = this.get('SELECT up_to, data FROM snapshots WHERE room_id = ?', roomId)
    const ops = this.all('SELECT seq, pid, op, ts FROM ops WHERE room_id = ? ORDER BY seq', roomId) as unknown as OpRecord[]
    return { snap: s ? { upTo: s.up_to as number, data: s.data as string } : null, ops }
  }

  appendOps(batches: OpBatch[]): void {
    // One transaction for all rooms: every commit costs pages in the write-ahead log, and a full
    // write-ahead log costs a sync to disk, during which the server does nothing else.
    this.together(() => {
      for (const { roomId, ops } of batches) {
        for (const o of ops) this.run('INSERT INTO ops (room_id, seq, pid, op, ts) VALUES (?, ?, ?, ?, ?)', roomId, o.seq, o.pid, o.op, o.ts)
      }
    })
  }

  putSnapshot(roomId: number, upTo: number, data: string, ts: number): void {
    this.together(() => {
      this.run(
        `INSERT INTO snapshots (room_id, up_to, data, ts) VALUES (?, ?, ?, ?)
         ON CONFLICT (room_id) DO UPDATE SET up_to = excluded.up_to, data = excluded.data, ts = excluded.ts`,
        roomId,
        upTo,
        data,
        ts,
      )
      this.run('DELETE FROM ops WHERE room_id = ? AND seq <= ?', roomId, upTo)
    })
  }
}
