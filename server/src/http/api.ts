// The REST API games call. Secrets arrive in the Authorization header, never in the URL.
// Nothing here uses cookies, so a game page can never act with the owner's portal session.

import {
  type ApiError,
  INVITE_CODE_RE,
  type InviteGrant,
  type InviteInfo,
  PROTO,
  ROOM_KEY_RE,
  type RoomInfo,
  type ServerInfo,
  URL_PARAM_RE,
} from '@p3p2/protocol'
import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { newInviteCode } from '../core/ids.ts'
import type { InviteRecord, RoomRecord } from '../core/types.ts'
import { VERSION } from '../version.ts'
import { type App, clientIp, MAX_BODY_BYTES } from './context.ts'

function problem(c: Context, status: 400 | 401 | 403 | 404 | 429, error: string, message: string): Response {
  return c.json({ error, message } satisfies ApiError, status)
}

function bearer(c: Context): string {
  const m = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '')
  return m ? m[1]! : ''
}

function grant(invite: InviteRecord): InviteGrant {
  return { code: invite.code, expiresAt: invite.expiresAt }
}

/** The room's current invite, or a new one. */
export function ensureInvite(app: App, room: RoomRecord, renew: boolean): InviteRecord {
  const now = app.now()
  if (renew) app.store.revokeInvites(room.id, now)
  const current = app.store.currentInvite(room.id, now)
  if (current) return current
  // While the room has members the invite does not expire; otherwise the countdown starts now.
  const expiresAt = app.hub.memberCount(room.id) > 0 ? null : now + app.config.limits.inviteTtlMs
  return app.store.createInvite(room.id, newInviteCode(), now, expiresAt)
}

export function apiRoutes(app: App): Hono {
  const api = new Hono()

  api.get('/info', (c) => {
    c.header('Access-Control-Allow-Origin', '*')
    const { limits } = app.config
    return c.json({
      name: app.config.name,
      version: VERSION,
      protocols: [PROTO],
      limits: { maxFrameBytes: limits.maxFrameBytes, msgRate: limits.msgRate, maxMembers: limits.maxMembersCap },
      source: app.config.sourceUrl,
    } satisfies ServerInfo)
  })

  // CORS. A preflight carries no credentials, so it cannot name a room: it is answered from
  // the set of origins that some room accepts. The request itself is then checked against its room.
  api.use('*', async (c, next) => {
    const origin = c.req.header('origin')
    if (!app.origins.has(origin)) return problem(c, 403, 'origin', 'No room on this server accepts this site')
    c.header('Access-Control-Allow-Origin', origin)
    c.header('Vary', 'Origin')
    if (c.req.method === 'OPTIONS') {
      c.header('Access-Control-Allow-Methods', 'GET, POST')
      c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      c.header('Access-Control-Max-Age', '600')
      return c.body(null, 204)
    }
    if (!app.limiters.api.take(clientIp(c, app), app.now())) return problem(c, 429, 'rate', 'Too many requests')
    c.header('Cache-Control', 'no-store')
    await next()
  })

  /** The room the key names, when the request comes from one of its origins. */
  function roomFor(c: Context): RoomRecord | Response {
    const key = bearer(c)
    const room = ROOM_KEY_RE.test(key) ? app.store.roomByKey(key) : null
    if (!room) return problem(c, 401, 'auth', 'Unknown room')
    if (!room.origins.includes(c.req.header('origin') ?? '')) {
      return problem(c, 403, 'origin', 'This room does not accept this site')
    }
    return room
  }

  api.get('/room', (c) => {
    const room = roomFor(c)
    if (room instanceof Response) return room
    const invite = app.store.currentInvite(room.id, app.now())
    const body: RoomInfo = {
      name: room.name,
      game: { url: room.gameUrl },
      maxMembers: room.maxMembers,
      members: app.hub.memberCount(room.id),
    }
    if (invite) body.invite = grant(invite)
    return c.json(body)
  })

  function answerInvite(c: Context, body: Record<string, unknown>): Response {
    const room = roomFor(c)
    if (room instanceof Response) return room
    const invite = ensureInvite(app, room, body.renew === true)
    // Where the host's game page lives, so the portal can show the same link and QR code.
    const param = body.param === undefined ? 'room' : body.param
    if (typeof body.page === 'string' && body.page.length <= 400 && typeof param === 'string' && URL_PARAM_RE.test(param)) {
      try {
        const page = new URL(body.page)
        if (room.origins.includes(page.origin)) {
          page.hash = ''
          page.searchParams.delete(param)
          app.store.setInvitePage(invite.code, page.href, param)
        }
      } catch {
        // Not a URL: the portal falls back to the room's game URL.
      }
    }
    return c.json(grant(invite))
  }

  api.post(
    '/room/invite',
    // A body this large is not read, and counts as an empty one: a page address that long would not be kept anyway,
    // and the host still gets its invite.
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => answerInvite(c, {}) }),
    async (c) => {
      let body: Record<string, unknown> = {}
      try {
        const parsed: unknown = await c.req.json()
        if (typeof parsed === 'object' && parsed !== null) body = parsed as Record<string, unknown>
      } catch {
        // An empty body means "the current invite, or a new one".
      }
      return answerInvite(c, body)
    },
  )

  api.get('/invite', (c) => {
    const code = bearer(c).toLowerCase()
    const invite = INVITE_CODE_RE.test(code) ? app.store.inviteByCode(code, app.now()) : null
    const room = invite ? app.store.roomById(invite.roomId) : null
    if (!room) return problem(c, 401, 'auth', 'This invite is not valid any more')
    if (!room.origins.includes(c.req.header('origin') ?? '')) {
      return problem(c, 403, 'origin', 'This room does not accept this site')
    }
    return c.json({
      room: { name: room.name },
      hostName: app.hub.hostName(room.id),
      members: app.hub.memberCount(room.id),
      maxMembers: room.maxMembers,
    } satisfies InviteInfo)
  })

  api.all('*', (c) => problem(c, 404, 'not-found', 'No such endpoint'))
  return api
}
