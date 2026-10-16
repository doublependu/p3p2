import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'
import type { Config } from '../config.ts'
import type { Hub } from '../core/hub.ts'
import { KeyedLimiter, type Limits } from '../core/limits.ts'
import type { Log } from '../log.ts'
import type { Store } from '../store/sqlite.ts'

/** The largest request body the portal or the API reads. Every form and call it takes is far smaller. */
export const MAX_BODY_BYTES = 64 * 1024

/** Every origin some room accepts. Cached, because preflights and upgrades ask on every request. */
export class Origins {
  private known = new Set<string>()
  private readonly store: Store

  constructor(store: Store) {
    this.store = store
    this.refresh()
  }

  refresh(): void {
    this.known = this.store.allOrigins()
  }

  has(origin: string | null | undefined): origin is string {
    return typeof origin === 'string' && this.known.has(origin)
  }
}

export interface App {
  config: Config
  store: Store
  hub: Hub
  origins: Origins
  log: Log
  now: () => number
  /** The one-time token for /setup while there is no owner yet. */
  setupToken: string | null
  limiters: {
    /** REST calls by games, per address. */
    api: KeyedLimiter
    /** WebSocket connects, per address. */
    connect: KeyedLimiter
    /** Wrong portal passwords, per address. */
    login: KeyedLimiter
  }
}

export function createLimiters(limits: Limits): App['limiters'] {
  return {
    api: new KeyedLimiter(limits.apiRate, limits.apiBurst),
    connect: new KeyedLimiter(limits.connectRate, limits.connectBurst),
    login: new KeyedLimiter(1 / 12, 5),
  }
}

/** The client's address. Behind a trusted proxy, the last hop the proxy recorded. */
export function forwardedIp(direct: string | undefined, forwardedFor: string | undefined, trustProxy: boolean): string {
  if (trustProxy && forwardedFor) {
    const last = forwardedFor.split(',').at(-1)?.trim()
    if (last) return last
  }
  return direct ?? 'unknown'
}

export function clientIp(c: Context, app: App): string {
  let direct: string | undefined
  try {
    direct = getConnInfo(c).remote.address
  } catch {
    // Not served from a socket (app.request in a test).
  }
  return forwardedIp(direct, c.req.header('x-forwarded-for'), app.config.trustProxy)
}
