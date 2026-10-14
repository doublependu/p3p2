// The two links people share: the room URL (owner → host) and the invite link (host → friends).
// This module is imported by the client's entry chunk, so it stays tiny and dependency-free.

export interface InviteRef {
  /** Server base URL without a trailing slash, e.g. `https://p3p2.example.com`. */
  server: string
  code: string
}

export interface RoomRef {
  server: string
  key: string
}

// Crockford base32, lower case: no i, l, o, u. Literals, so bundlers can drop what a chunk does not use.
export const INVITE_CODE_RE: RegExp = /^[0-9a-hjkmnp-tv-z]{10}$/
export const ROOM_KEY_RE: RegExp = /^[0-9a-hjkmnp-tv-z]{26}$/
export const URL_PARAM_RE: RegExp = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/

const MAX_LINK = 400

// `host:port/…` has no scheme; `ftp://…` has one, and prefixing it would turn `ftp` into the host.
function withScheme(text: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`
}

/** Normalizes a server base URL, or returns null when it is not a plain http(s) URL. */
export function normalizeServer(text: string): string | null {
  try {
    const u = new URL(withScheme(text.trim()))
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (u.username || u.password || u.search || u.hash || u.pathname.includes('//')) return null
    return u.origin + u.pathname.replace(/\/+$/, '')
  } catch {
    return null
  }
}

/** Parses the value of the invite parameter: `<server>/<code>`, with `https://` implied. */
export function parseInvite(value: string | null | undefined): InviteRef | null {
  if (!value) return null
  const v = value.trim()
  if (v.length > MAX_LINK) return null
  const cut = v.lastIndexOf('/')
  if (cut < 1) return null
  const code = v.slice(cut + 1).toLowerCase()
  if (!INVITE_CODE_RE.test(code)) return null
  const server = normalizeServer(v.slice(0, cut))
  return server ? { server, code } : null
}

/** The invite parameter's value. `https://` is left out; any other scheme is written out. */
export function formatInvite(ref: InviteRef): string {
  // & # + would end or alter the parameter; everything else in a normalized URL is query-safe.
  const server = ref.server.replace(/^https:\/\//, '').replace(/[&#+]/g, encodeURIComponent)
  return `${server}/${ref.code}`
}

export function inviteFromUrl(href: string, param: string = 'room'): InviteRef | null {
  try {
    return parseInvite(new URL(href).searchParams.get(param))
  } catch {
    return null
  }
}

/** Builds the invite link from the game page's own address. */
export function inviteUrl(pageHref: string, ref: InviteRef, param: string = 'room'): string {
  const u = new URL(pageHref)
  u.searchParams.delete(param)
  const query = u.search ? `${u.search}&` : '?'
  return `${u.origin}${u.pathname}${query}${param}=${formatInvite(ref)}`
}

/** Parses a room URL pasted by the host: `<server>/room/<key>`. */
export function parseRoomUrl(text: string | null | undefined): RoomRef | null {
  if (!text) return null
  const v = text.trim()
  if (v.length > MAX_LINK) return null
  try {
    const u = new URL(withScheme(v))
    const m = /^(.*)\/room\/([^/]+)\/?$/.exec(u.pathname)
    if (!m) return null
    const key = m[2]!.toLowerCase()
    if (!ROOM_KEY_RE.test(key)) return null
    const server = normalizeServer(u.origin + m[1]!)
    return server ? { server, key } : null
  } catch {
    return null
  }
}

export function roomUrl(ref: RoomRef): string {
  return `${ref.server}/room/${ref.key}`
}
