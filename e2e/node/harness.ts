// The client's room code, run in Node against a real server over real sockets, without a
// browser. Quick enough to run on every change, and able to do what a browser test cannot do
// cheaply: cut one player's connection at a chosen moment.
//
// The room client needs three things of a browser, and gets stand-ins here: a WebSocket that
// says which site it comes from, `document.hidden`, and the page's visibility events. (And a
// window to listen on for the page going away, which never happens here.)

import { after } from 'node:test'
import type { Auth } from '@p3p2/protocol'
import { type Resume, RoomClient } from '../../client/src/room.ts'
import type { CloseReason } from '../../client/src/types.ts'
import { SOURCE_URL } from '../../server/src/config.ts'
import { newInviteCode, newRoomKey } from '../../server/src/core/ids.ts'
import { DEFAULT_LIMITS, type Limits } from '../../server/src/core/limits.ts'
import { type Running, startServer } from '../../server/src/server.ts'
import { type LagProxy, startLagProxy } from '../tools/lag-proxy.ts'

export const GAME = 'https://game.example.com'

// A browser sends Origin by itself, and the server lets no socket in without one it knows.
const Native = globalThis.WebSocket
class SiteSocket extends Native {
  constructor(url: string | URL) {
    super(url, { headers: { origin: GAME } } as unknown as string[])
  }
}
globalThis.WebSocket = SiteSocket as typeof WebSocket

/** The page every player in this process is on. `hide()` and `show()` are what switching tabs does. */
const listeners = new Set<() => void>()
const page = {
  hidden: false,
  addEventListener: (_type: string, f: () => void) => void listeners.add(f),
  removeEventListener: (_type: string, f: () => void) => void listeners.delete(f),
}
;(globalThis as unknown as { document: typeof page }).document = page
// A page that is closed or reloaded says so (`pagehide`), and the client listens for it on the
// window. Nothing here closes a page: a player who goes, goes by their connection.
Object.assign(globalThis, { addEventListener: () => {}, removeEventListener: () => {} })

export function setHidden(hidden: boolean): void {
  page.hidden = hidden
  for (const f of [...listeners]) f()
}

export interface World {
  /** The server's address, and the same server through a proxy whose connections can be cut. */
  server: string
  far: string
  proxy: LagProxy
  running: Running
  /** Creates a room for the test's game, and an invite to it. */
  room(): { key: string; invite: string }
  /** A player who has joined: resolves at the welcome. */
  join(auth: Auth, name: string, over?: Partial<{ server: string; pid: string; version: string }>): Promise<Player>
}

export interface Player {
  room: RoomClient
  pid: string
  /** Why the room closed for this player, once it has. */
  closed: CloseReason | null
  resume: Resume | null
}

let players = 0
const open: (() => Promise<void>)[] = []
after(async () => {
  for (const close of open.reverse()) await close()
})

/** A server of its own for one test file, with the limits the test wants. */
export async function world(limits: Partial<Limits> = {}): Promise<World> {
  const running = await startServer({
    publicUrl: 'https://p3p2.example.com',
    name: 'test server',
    sourceUrl: SOURCE_URL,
    port: 0,
    host: '127.0.0.1',
    dataDir: ':memory:',
    logLevel: 'silent',
    trustProxy: false,
    ownerPassword: 'correct horse battery',
    statsToken: null,
    limits: { ...DEFAULT_LIMITS, ...limits },
  })
  const proxy = await startLagProxy({ listen: 0, host: '127.0.0.1', to: { host: '127.0.0.1', port: running.port }, latency: 0, jitter: 0 })
  const rooms: RoomClient[] = []
  open.push(async () => {
    for (const room of rooms) room.leave()
    await proxy.close()
    await running.close()
  })
  const { store } = running.app
  const server = `http://127.0.0.1:${running.port}`

  return {
    server,
    far: `http://127.0.0.1:${proxy.port}`,
    proxy,
    running,
    room() {
      const now = Date.now()
      const record = store.createRoom({ key: newRoomKey(), name: 'Test room', gameUrl: `${GAME}/`, origins: [GAME], maxMembers: 16 }, now)
      const invite = newInviteCode()
      store.createInvite(record.id, invite, now, now + DEFAULT_LIMITS.inviteTtlMs)
      // What the portal does after it creates a room: the server learns the room's site.
      running.app.origins.refresh()
      return { key: record.key, invite }
    },
    async join(auth, name, over = {}) {
      const pid = over.pid ?? `player-${String(++players).padStart(10, '0')}`
      const player: Player = { pid, closed: null, resume: null } as Player
      player.room = new RoomClient({
        server: over.server ?? server,
        auth,
        game: { id: 'node-test', version: over.version ?? '1.0.0' },
        name,
        identity: { pid, secret: `secret-of-${pid}` },
        inviteUrl: null,
        resume: null,
        onWelcome: (resume) => {
          player.resume = resume
        },
        onClose: (reason) => {
          player.closed = reason
        },
      })
      rooms.push(player.room)
      await player.room.open()
      return player
    },
  }
}

/** Waits until `check` returns something truthy, and returns it. */
export async function until<T>(check: () => T, what: string, ms: number = 5000): Promise<NonNullable<T>> {
  const end = Date.now() + ms
  for (;;) {
    const value = check()
    if (value) return value as NonNullable<T>
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
