// The lazy part of the library: REST calls, identity, and the room's lifecycle.

import { type Auth, cleanName, cleanText, type InviteRef, inviteUrl } from '@p3p2/protocol'
import { Failure } from './errors.ts'
import type { Bridge } from './index.ts'
import { type Resume, RoomClient } from './room.ts'
import type { CloseReason, Invite, InviteDetails, JoinOptions, Room } from './types.ts'
import type { PanelElement } from './ui/panel.ts'

interface SavedSession {
  v: 1
  server: string
  auth: Auth
  resume: Resume
  /** The invite behind the link this player can share. */
  invite: InviteRef | null
}

const memory = new Map<string, string>()

/** localStorage and sessionStorage can be missing or blocked; fall back to memory for this page. */
function storage(area: 'local' | 'session') {
  const real = (): Storage | null => {
    try {
      return area === 'local' ? localStorage : sessionStorage
    } catch {
      return null
    }
  }
  return {
    get(key: string): string | null {
      try {
        return real()?.getItem(key) ?? memory.get(`${area}:${key}`) ?? null
      } catch {
        return memory.get(`${area}:${key}`) ?? null
      }
    },
    set(key: string, value: string | null): void {
      if (value === null) memory.delete(`${area}:${key}`)
      else memory.set(`${area}:${key}`, value)
      try {
        if (value === null) real()?.removeItem(key)
        else real()?.setItem(key, value)
      } catch {
        // Kept in memory only.
      }
    },
  }
}

const local = storage('local')
const session = storage('session')

function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The invite's code, whole. A link from a server's front page may leave its last characters out, a dash in place of
 * each: the game puts them in first.
 */
function wholeCode(invite: Invite): string {
  if (invite.code.includes('-')) throw new Failure('hidden', invite.server)
  return invite.code
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

export class Controller {
  room: RoomClient | null = null
  private readonly bridge: Bridge
  private panel: Promise<PanelElement> | null = null

  constructor(bridge: Bridge) {
    this.bridge = bridge
  }

  get gameId(): string {
    return this.bridge.options.game.id
  }

  // ---- what the browser remembers ----

  get name(): string {
    return cleanName(local.get('p3p2:name'))
  }

  set name(value: string) {
    local.set('p3p2:name', cleanName(value) || null)
  }

  /** This browser's player id on one server. Random, and kept apart per server. */
  private identity(server: string): { pid: string; secret: string } {
    const key = `p3p2:pid:${server}`
    const [pid, secret] = (local.get(key) ?? '').split('.')
    if (pid && secret) return { pid, secret }
    const fresh = { pid: randomId(), secret: randomId() }
    local.set(key, `${fresh.pid}.${fresh.secret}`)
    return fresh
  }

  // ---- REST ----

  private async call(server: string, path: string, token: string): Promise<Record<string, unknown>> {
    if (location.protocol === 'https:' && server.startsWith('http:') && !/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(`${server}/`)) {
      throw new Failure('mixed', server)
    }
    let res: Response
    try {
      res = await fetch(`${server}/api/v1${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      })
    } catch {
      // A blocked CORS request and a dead server look the same from here. The info endpoint
      // answers every site, so it tells them apart.
      let alive = false
      try {
        alive = (await fetch(`${server}/api/v1/info`, { credentials: 'omit', cache: 'no-store' })).ok
      } catch {
        // Not reachable at all.
      }
      throw new Failure(alive ? 'origin' : 'unreachable', server)
    }
    let json: unknown = null
    try {
      json = await res.json()
    } catch {
      // Not JSON: treated as a failure below.
    }
    const data = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {}
    if (!res.ok) throw new Failure(typeof data.error === 'string' ? data.error : `http-${res.status}`, server)
    return data
  }

  async peek(invite: Invite): Promise<InviteDetails> {
    const data = await this.call(invite.server, '/invite', wholeCode(invite))
    const room = typeof data.room === 'object' && data.room !== null ? (data.room as Record<string, unknown>) : {}
    return {
      roomName: cleanText(room.name, 60) || 'a room',
      hostName: cleanName(data.hostName) || null,
      members: count(data.members),
      maxMembers: count(data.maxMembers),
    }
  }

  // ---- rooms ----

  async join(invite: Invite, options: JoinOptions = {}): Promise<Room | null> {
    if (options.name !== undefined) this.name = options.name
    const ask = options.ask ?? this.bridge.options.ui !== false
    if (ask) {
      const panel = await this.loadPanel()
      // The panel looks the invite up, asks, and joins through `enterInvite`.
      return panel.offer(invite)
    }
    return this.enterInvite(invite)
  }

  async enterInvite(invite: Invite): Promise<Room> {
    return this.enter(invite.server, { invite: wholeCode(invite) }, invite, null)
  }

  /** Comes back to the room this tab was in before a reload. Null if that is no longer possible. */
  async resume(saved: string): Promise<Room | null> {
    let s: SavedSession
    try {
      s = JSON.parse(saved) as SavedSession
      if (s.v !== 1 || typeof s.server !== 'string' || typeof s.auth !== 'object' || typeof s.resume !== 'object') {
        throw new Error('not a session')
      }
    } catch {
      this.forget()
      return null
    }
    try {
      return await this.enter(s.server, s.auth, s.invite, s.resume)
    } catch {
      this.forget()
      return null
    }
  }

  private async enter(server: string, auth: Auth, invite: InviteRef | null, resume: Resume | null): Promise<Room> {
    this.room?.leave()
    const room = new RoomClient({
      server,
      auth,
      game: this.bridge.options.game,
      name: this.name,
      identity: this.identity(server),
      inviteUrl: invite ? inviteUrl(location.href, invite, this.bridge.param) : null,
      resume,
      onWelcome: (next) => {
        const saved: SavedSession = { v: 1, server, auth, resume: next, invite }
        session.set(`p3p2:session:${this.gameId}`, JSON.stringify(saved))
      },
      onClose: (reason) => this.closed(room, reason),
    })
    await room.open()
    this.room = room
    this.bridge.started(room)
    if (this.bridge.options.ui !== false) void this.loadPanel().then((panel) => panel.show(room))
    return room
  }

  private closed(room: RoomClient, reason: CloseReason): void {
    if (this.room !== room) return
    this.room = null
    this.forget()
    this.bridge.ended(reason)
  }

  private forget(): void {
    session.set(`p3p2:session:${this.gameId}`, null)
  }

  /** The player said no to an invite: take it out of the address, so a reload does not ask again. */
  declineInvite(): void {
    try {
      const url = new URL(location.href)
      url.searchParams.delete(this.bridge.param)
      history.replaceState(history.state, '', url)
    } catch {
      // The address stays as it is.
    }
  }

  // ---- panel ----

  async open(): Promise<void> {
    ;(await this.loadPanel()).expand()
  }

  private loadPanel(): Promise<PanelElement> {
    this.panel ??= import('./ui/panel.ts').then((m) => m.mountPanel(this, this.bridge))
    return this.panel
  }
}
