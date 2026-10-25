// Writing the invite link. Only the client's room code, which loads when a room opens, and the server need it, so it
// is kept out of links.ts, which the client's entry chunk imports.

import type { InviteRef } from './links.ts'

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
