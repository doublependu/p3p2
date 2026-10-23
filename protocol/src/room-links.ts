// The rest of the links: writing the invite link, and reading the room URL the host pastes. Only
// the client's room code, which loads when a room opens, and the server need these, so they are
// kept out of links.ts, which the client's entry chunk imports.

import { type InviteRef, MAX_LINK, normalizeServer, ROOM_KEY_RE, type RoomRef, withScheme } from './links.ts'

/** The invite parameter's value. `https://` is left out; any other scheme is written out. */
export function formatInvite(ref: InviteRef): string {
  // & # + would end or alter the parameter; everything else in a normalized URL is query-safe.
  const server = ref.server.replace(/^https:\/\//, '').replace(/[&#+]/g, encodeURIComponent)
  return `${server}/${ref.code}`
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
