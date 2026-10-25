// The two links people share: the room URL (owner → host) and the invite link (host → friends).
// This module is imported by the client's entry chunk, so it stays tiny and dependency-free: it
// holds only what reading the invite in a page's address needs. room-links.ts has the rest.

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
// The code as a link carries it: a server's front page may leave its last characters out, a dash in place of each,
// for the player to type. Ten characters in all, at least two of them the code's.
const LINK_CODE_RE: RegExp = /^(?=.{10}$)[0-9a-hjkmnp-tv-z]{2,}-*$/
export const ROOM_KEY_RE: RegExp = /^[0-9a-hjkmnp-tv-z]{26}$/
export const URL_PARAM_RE: RegExp = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/

export const MAX_LINK = 400

// `host:port/…` has no scheme; `ftp://…` has one, and prefixing it would turn `ftp` into the host.
export function withScheme(text: string): string {
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

/**
 * Parses the value of the invite parameter: `<server>/<code>`, with `https://` implied. The code may end in dashes,
 * one for each character the link leaves out.
 */
export function parseInvite(value: string | null | undefined): InviteRef | null {
  if (!value) return null
  const v = value.trim()
  if (v.length > MAX_LINK) return null
  const cut = v.lastIndexOf('/')
  if (cut < 1) return null
  const code = v.slice(cut + 1).toLowerCase()
  if (!LINK_CODE_RE.test(code)) return null
  const server = normalizeServer(v.slice(0, cut))
  return server ? { server, code } : null
}

export function inviteFromUrl(href: string, param: string = 'room'): InviteRef | null {
  try {
    return parseInvite(new URL(href).searchParams.get(param))
  } catch {
    return null
  }
}
