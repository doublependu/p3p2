// The server in numbers, for whoever holds P3P2_STATS_TOKEN: the load generator in bench/,
// or an owner who wonders how busy the machine is. Without a token none of this runs.

import { monitorEventLoopDelay } from 'node:perf_hooks'
import type { ApiError, ServerStats } from '@p3p2/protocol'
import type { Context } from 'hono'
import type { Traffic } from './adapters/ws.ts'
import type { Hub } from './core/hub.ts'
import { safeEqual } from './core/ids.ts'
import type { Store } from './store/sqlite.ts'
import { VERSION } from './version.ts'

const LOOP_RESOLUTION_MS = 10

export interface Meter {
  /** `reset` starts a new period for the event-loop delay; the totals never reset. */
  read(reset: boolean): ServerStats
  close(): void
}

export function createMeter(hub: Hub, store: Store, traffic: () => Traffic, now: () => number): Meter {
  const loop = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS })
  loop.enable()
  // The monitor records how far apart its timer fired. The delay is what exceeds the interval.
  const late = (ns: number) => Math.max(0, Math.round(ns / 1000 - LOOP_RESOLUTION_MS * 1000) / 1000)
  const ms = (us: number) => Math.round(us / 1000)

  return {
    read(reset) {
      const cpu = process.cpuUsage()
      const memory = process.memoryUsage()
      const stats: ServerStats = {
        now: now(),
        uptime: Math.round(process.uptime() * 1000) / 1000,
        version: VERSION,
        node: process.version,
        cpu: { user: ms(cpu.user), system: ms(cpu.system) },
        memory: { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, external: memory.external },
        loop: { p50: late(loop.percentile(50)), p99: late(loop.percentile(99)), max: late(loop.max) },
        rooms: hub.roomCount,
        members: hub.memberTotal,
        ...traffic(),
        ...hub.counters,
        writes: store.writes,
      }
      if (reset) loop.reset()
      return stats
    },
    close() {
      loop.disable()
    },
  }
}

/** `GET /api/v1/stats`. Not for game pages: it answers the token, and sends no CORS headers. */
export function statsRoute(meter: Meter, token: string): (c: Context) => Response {
  return (c) => {
    c.header('Cache-Control', 'no-store')
    const given = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '')?.[1] ?? ''
    if (!safeEqual(given, token)) {
      return c.json({ error: 'auth', message: 'Wrong stats token' } satisfies ApiError, 401)
    }
    return c.json(meter.read(c.req.query('reset') === '1'))
  }
}
