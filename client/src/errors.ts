import type { P3P2Error } from './types.ts'

function host(server: string): string {
  try {
    return new URL(server).host
  } catch {
    return 'the server'
  }
}

/** Plain-language text for each code. Games that speak in their own voice can switch on `code`. */
function describe(code: string, server: string): string {
  switch (code) {
    case 'unreachable':
      return `Can't reach ${host(server)}. Is the server running?`
    case 'mixed':
      return `This page is on https, so it can't use a server on plain http (${host(server)}).`
    case 'origin':
      return `This room isn't set up for ${globalThis.location?.origin ?? 'this site'}. The owner can add this site to the room in the portal.`
    case 'auth':
      return 'This invite has expired or was replaced. Ask for a new link.'
    case 'hidden':
      return 'This invite link leaves out the last characters of its code. Type them in, or ask whoever invited you for the whole link.'
    case 'full':
      return 'The room is full.'
    case 'name':
      return 'Somebody in this room already has that name. Choose another.'
    case 'rate':
      return 'Too many tries. Wait a moment and try again.'
    case 'proto':
      return `${host(server)} runs a p3p2 older than this game needs. Its owner can update it.`
    case 'player':
      return "The server didn't accept this browser's player id."
    case 'version':
      return 'The players in this room have a different version of the game. Reload the page; if that changes nothing, they need to reload.'
    case 'game':
      return 'This room is for another game. The owner can let this one in from the portal.'
    default:
      return `Something went wrong (${code}).`
  }
}

export class Failure extends Error implements P3P2Error {
  readonly code: string

  constructor(code: string, server: string) {
    super(describe(code, server))
    this.name = 'P3P2Error'
    this.code = code
  }
}

/** True for a promise, or anything that can be waited for like one. */
export function thenable(value: unknown): value is Promise<never> {
  return typeof (value as { then?: unknown } | null | undefined)?.then === 'function'
}
