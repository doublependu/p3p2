// The owner's portal: setup, login, rooms. Only the owner ever logs in here.

import { cleanText, inviteUrl, roomUrl } from '@p3p2/protocol'
import { type Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { generate } from 'lean-qr'
import { toSvgSource } from 'lean-qr/extras/svg'
import { newRoomKey, newToken, safeEqual, sha256 } from '../core/ids.ts'
import { type InviteRecord, type RoomRecord, VERSION_POLICIES, type VersionPolicy } from '../core/types.ts'
import { ensureInvite } from './api.ts'
import { PORTAL_CSS, PORTAL_JS } from './assets.ts'
import { type App, clientIp } from './context.ts'
import {
  dashboardPage,
  loginPage,
  messagePage,
  type NewRoomForm,
  publicRoomPage,
  roomPage,
  type Server,
  setupNeededPage,
  setupPage,
} from './pages.ts'
import { hashPassword, PASSWORD_MIN, verifyPassword } from './password.ts'

const COOKIE = 'p1_session'
const SESSION_MS = 30 * 24 * 3600_000
const ROOM_NAME_MAX = 60
const EXTRA_ORIGINS_MAX = 10

type Env = { Variables: { owner: boolean } }
type C = Context<Env>

/**
 * A game URL as the owner types it: `game.example.com`, or a full address for a local dev server.
 * Without a scheme the host has to look like one (a dot, or localhost), so a stray word is not
 * taken for a site.
 */
export function parseGameUrl(text: string): { url: string; origin: string } | null {
  const v = text.trim()
  if (!v || v.length > 400 || /\s/.test(v)) return null
  const explicit = /^[a-z][a-z0-9+.-]*:\/\//i.test(v)
  try {
    const u = new URL(explicit ? v : `https://${v}`)
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || !u.hostname) return null
    if (!explicit && !u.hostname.includes('.') && u.hostname !== 'localhost') return null
    return { url: u.origin + u.pathname + u.search, origin: u.origin }
  } catch {
    return null
  }
}

/** One origin per line (commas work too). Returns the line that is wrong as `bad`. */
export function parseOrigins(text: string): { origins: string[]; bad: string | null } {
  const origins: string[] = []
  for (const line of text.split(/[\s,]+/)) {
    if (!line) continue
    const parsed = parseGameUrl(line)
    if (!parsed) return { origins, bad: line }
    if (!origins.includes(parsed.origin)) origins.push(parsed.origin)
  }
  return { origins, bad: null }
}

function roomName(text: string, fallback: string): string {
  return cleanText(text, ROOM_NAME_MAX) || fallback
}

function field(form: Record<string, unknown>, name: string): string {
  const v = form[name]
  return typeof v === 'string' ? v : ''
}

export function expiryText(invite: InviteRecord, now: number): string {
  if (invite.expiresAt === null) return 'It stays open while players are in the room.'
  const minutes = Math.max(1, Math.round((invite.expiresAt - now) / 60_000))
  const text = minutes >= 120 ? `${Math.round(minutes / 60)} hours` : `${minutes} minute${minutes === 1 ? '' : 's'}`
  return `It expires in ${text} unless someone joins.`
}

export function portalRoutes(app: App): Hono<Env> {
  const portal = new Hono<Env>()
  const { store, hub, config } = app
  const server: Server = { name: config.name, source: config.sourceUrl }
  const secure = config.publicUrl.startsWith('https:')

  portal.get('/assets/portal.css', (c) => c.body(PORTAL_CSS, 200, { 'Content-Type': 'text/css; charset=utf-8' }))
  portal.get('/assets/portal.js', (c) =>
    c.body(PORTAL_JS, 200, { 'Content-Type': 'text/javascript; charset=utf-8' }),
  )

  portal.use('*', async (c, next) => {
    c.header(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    )
    // Nothing about this site leaves it (room URLs carry the key). Not 'no-referrer': with that
    // policy browsers send "Origin: null" on form posts, and the check below would refuse them.
    c.header('Referrer-Policy', 'same-origin')
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('X-Robots-Tag', 'noindex')
    c.header('Cache-Control', 'no-store')

    // Forms only count when they come from this site. SameSite=Strict already keeps the cookie
    // away from other sites; this also covers the forms that need no cookie (login, setup).
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const origin = c.req.header('origin')
      let same = false
      try {
        same = origin !== undefined && new URL(origin).host === c.req.header('host')
      } catch {
        // Not a URL.
      }
      if (!same) return c.html(messagePage(server, false, 'Not allowed', 'This form was sent from another site.'), 403)
    }

    const token = getCookie(c, COOKIE)
    c.set('owner', token !== undefined && store.hasSession(sha256(token), app.now()))
    await next()
  })

  function startSession(c: C): void {
    const token = newToken()
    const now = app.now()
    store.createSession(sha256(token), now, now + SESSION_MS)
    setCookie(c, COOKIE, token, { httpOnly: true, sameSite: 'Strict', secure, path: '/', maxAge: SESSION_MS / 1000 })
  }

  /** The room in the URL, for the owner only. Anything else gets a response to return as is. */
  function ownedRoom(c: C): RoomRecord | Response | Promise<Response> {
    if (!c.get('owner')) return c.redirect('/login')
    const room = store.roomByKey(c.req.param('key') ?? '')
    return room ?? c.html(messagePage(server, true, 'No such room', 'This room does not exist any more.'), 404)
  }

  // ---- setup and login ----

  portal.get('/setup', (c) => {
    if (store.ownerHash()) return c.redirect('/login')
    const token = c.req.query('token') ?? ''
    if (!app.setupToken || !safeEqual(token, app.setupToken)) return c.html(setupNeededPage(server), 403)
    return c.html(setupPage(server, token))
  })

  portal.post('/setup', async (c) => {
    if (store.ownerHash()) return c.redirect('/login')
    const form = await c.req.parseBody()
    const token = field(form, 'token')
    if (!app.setupToken || !safeEqual(token, app.setupToken)) return c.html(setupNeededPage(server), 403)
    const password = field(form, 'password')
    if (password.length < PASSWORD_MIN) {
      return c.html(setupPage(server, token, `Use at least ${PASSWORD_MIN} characters.`), 400)
    }
    if (password !== field(form, 'confirm')) return c.html(setupPage(server, token, 'The two passwords differ.'), 400)
    store.setOwnerHash(await hashPassword(password), app.now())
    app.setupToken = null
    app.log('info', 'owner-set')
    startSession(c)
    return c.redirect('/')
  })

  portal.get('/login', (c) => {
    if (c.get('owner')) return c.redirect('/')
    if (!store.ownerHash()) return c.html(setupNeededPage(server))
    return c.html(loginPage(server))
  })

  portal.post('/login', async (c) => {
    const hash = store.ownerHash()
    if (!hash) return c.html(setupNeededPage(server))
    // Only wrong passwords use up attempts, so the owner is never locked out by logging in often.
    const ip = clientIp(c, app)
    if (!app.limiters.login.allows(ip, app.now())) {
      return c.html(loginPage(server, 'Too many attempts. Wait a minute and try again.'), 429)
    }
    const form = await c.req.parseBody()
    if (!(await verifyPassword(field(form, 'password'), hash))) {
      app.limiters.login.take(ip, app.now())
      app.log('warn', 'login-failed', { ip })
      return c.html(loginPage(server, 'Wrong password.'), 401)
    }
    startSession(c)
    return c.redirect('/')
  })

  portal.post('/logout', (c) => {
    const token = getCookie(c, COOKIE)
    if (token) store.deleteSession(sha256(token))
    deleteCookie(c, COOKIE, { path: '/' })
    return c.redirect('/login')
  })

  // ---- rooms ----

  const blank: NewRoomForm = { game: '', name: '', maxMembers: '', origins: '', error: '' }

  function dashboard(c: C, form: NewRoomForm = blank, status: 200 | 400 = 200): Response | Promise<Response> {
    const now = app.now()
    const rooms = store.listRooms().map((room) => ({
      room,
      online: hub.memberCount(room.id),
      invited: store.currentInvite(room.id, now) !== null,
    }))
    return c.html(dashboardPage(server, rooms, form, config.limits.maxMembers, config.limits.maxMembersCap), status)
  }

  portal.get('/', (c) => {
    if (!store.ownerHash()) return c.html(setupNeededPage(server))
    if (!c.get('owner')) return c.redirect('/login')
    return dashboard(c)
  })

  function memberLimit(text: string): number | null {
    const n = text === '' ? config.limits.maxMembers : Number(text)
    return Number.isInteger(n) && n >= 1 && n <= config.limits.maxMembersCap ? n : null
  }

  portal.post('/rooms', async (c) => {
    if (!c.get('owner')) return c.redirect('/login')
    const raw = await c.req.parseBody()
    const form: NewRoomForm = {
      game: field(raw, 'game'),
      name: field(raw, 'name'),
      maxMembers: field(raw, 'max'),
      origins: field(raw, 'origins'),
      error: '',
    }
    const refuse = (error: string) => dashboard(c, { ...form, error }, 400)

    const game = parseGameUrl(form.game)
    if (!game) return refuse('That game URL does not look right. Try something like game.example.com.')
    const extra = parseOrigins(form.origins)
    if (extra.bad) return refuse(`"${extra.bad}" is not a site address.`)
    if (extra.origins.length > EXTRA_ORIGINS_MAX) return refuse(`At most ${EXTRA_ORIGINS_MAX} other sites.`)
    const maxMembers = memberLimit(form.maxMembers)
    if (maxMembers === null) return refuse(`Players must be a number from 1 to ${config.limits.maxMembersCap}.`)
    if (store.countRooms() >= config.limits.maxRooms) {
      return refuse(`This server holds at most ${config.limits.maxRooms} rooms. Delete one first.`)
    }

    const room = store.createRoom(
      {
        key: newRoomKey(),
        name: roomName(form.name, new URL(game.url).host),
        gameUrl: game.url,
        origins: [game.origin, ...extra.origins.filter((o) => o !== game.origin)],
        maxMembers,
      },
      app.now(),
    )
    app.origins.refresh()
    app.log('info', 'room-created', { room: room.id, game: game.origin })
    return c.redirect(`/room/${room.key}`)
  })

  function showRoom(c: C, room: RoomRecord, error: string = '', status: 200 | 400 = 200): Response | Promise<Response> {
    const now = app.now()
    const invite = store.currentInvite(room.id, now)
    return c.html(
      roomPage(server, {
        room,
        roomUrl: roomUrl({ server: config.publicUrl, key: room.key }),
        invite,
        inviteLink: invite ? inviteLinkFor(room, invite) : '',
        expiry: invite ? expiryText(invite, now) : '',
        live: hub.live(room.id),
        error,
        cap: config.limits.maxMembersCap,
      }),
      status,
    )
  }

  /** The link friends open: on the game's own site, naming this server and the invite code. */
  function inviteLinkFor(room: RoomRecord, invite: InviteRecord): string {
    return inviteUrl(invite.page ?? room.gameUrl, { server: config.publicUrl, code: invite.code }, invite.param ?? 'room')
  }

  portal.get('/room/:key', (c) => {
    const room = store.roomByKey(c.req.param('key'))
    if (c.get('owner')) {
      return room ? showRoom(c, room) : c.html(messagePage(server, true, 'No such room', 'This room does not exist any more.'), 404)
    }
    // The key is the secret, so lookups by people who are not the owner are rate-limited.
    if (!app.limiters.api.take(clientIp(c, app), app.now())) {
      return c.html(messagePage(server, false, 'Slow down', 'Too many requests. Try again in a moment.'), 429)
    }
    if (!room) return c.html(messagePage(server, false, 'No such room', 'This room URL is not valid any more.'), 404)
    return c.html(publicRoomPage(server, room))
  })

  portal.get('/room/:key/qr.svg', (c) => {
    const room = c.get('owner') ? store.roomByKey(c.req.param('key')) : null
    const invite = room ? store.currentInvite(room.id, app.now()) : null
    if (!room || !invite) return c.body(null, 404)
    const svg = toSvgSource(generate(inviteLinkFor(room, invite)), { on: '#000', off: '#fff', pad: 3 })
    return c.body(svg, 200, { 'Content-Type': 'image/svg+xml' })
  })

  portal.post('/room/:key/invite', async (c) => {
    const room = await ownedRoom(c)
    if (room instanceof Response) return room
    ensureInvite(app, room, true)
    return c.redirect(`/room/${room.key}`)
  })

  portal.post('/room/:key/kick', async (c) => {
    const room = await ownedRoom(c)
    if (room instanceof Response) return room
    hub.kick(room.id, Number(field(await c.req.parseBody(), 'member')))
    return c.redirect(`/room/${room.key}`)
  })

  portal.post('/room/:key/end', async (c) => {
    const room = await ownedRoom(c)
    if (room instanceof Response) return room
    hub.end(room.id)
    return c.redirect(`/room/${room.key}`)
  })

  portal.post('/room/:key/settings', async (c) => {
    const room = await ownedRoom(c)
    if (room instanceof Response) return room
    const form = await c.req.parseBody()
    const parsed = parseOrigins(field(form, 'origins'))
    if (parsed.bad) return showRoom(c, room, `"${parsed.bad}" is not a site address.`, 400)
    const own = new URL(room.gameUrl).origin
    const origins = [own, ...parsed.origins.filter((o) => o !== own)]
    if (origins.length > EXTRA_ORIGINS_MAX + 1) return showRoom(c, room, `At most ${EXTRA_ORIGINS_MAX} other sites.`, 400)
    const maxMembers = memberLimit(field(form, 'max'))
    if (maxMembers === null) {
      return showRoom(c, room, `Players must be a number from 1 to ${config.limits.maxMembersCap}.`, 400)
    }
    // A form without the field (an older page still open) keeps the room's policy.
    const versions = field(form, 'versions') as VersionPolicy
    const versionPolicy = VERSION_POLICIES.includes(versions) ? versions : room.versionPolicy
    store.updateRoom(room.id, { name: roomName(field(form, 'name'), room.name), origins, maxMembers, versionPolicy })
    app.origins.refresh()
    return c.redirect(`/room/${room.key}`)
  })

  portal.post('/room/:key/game', async (c) => {
    const room = await ownedRoom(c)
    if (room instanceof Response) return room
    store.holdGame(room.id, null)
    app.log('info', 'room-game-released', { room: room.id, was: room.gameId })
    return c.redirect(`/room/${room.key}`)
  })

  portal.post('/room/:key/clear', async (c) => {
    const room = await ownedRoom(c)
    if (room instanceof Response) return room
    // Members hold copies of the saved values and of the log, so the session ends with them.
    // The invite stays.
    hub.end(room.id, 'ended', false)
    store.clearSaved(room.id)
    app.log('info', 'room-cleared', { room: room.id })
    return c.redirect(`/room/${room.key}`)
  })

  portal.post('/room/:key/rotate', async (c) => {
    const room = await ownedRoom(c)
    if (room instanceof Response) return room
    hub.end(room.id)
    const key = newRoomKey()
    store.rotateKey(room.id, key)
    app.log('info', 'room-key-rotated', { room: room.id })
    return c.redirect(`/room/${key}`)
  })

  portal.post('/room/:key/delete', async (c) => {
    const room = await ownedRoom(c)
    if (room instanceof Response) return room
    hub.end(room.id)
    store.deleteRoom(room.id)
    app.origins.refresh()
    app.log('info', 'room-deleted', { room: room.id })
    return c.redirect('/')
  })

  portal.notFound((c) => c.html(messagePage(server, c.get('owner') ?? false, 'Not found', 'There is nothing at this address.'), 404))
  return portal
}
