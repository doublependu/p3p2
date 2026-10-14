import { mkdirSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { attachWs, type WsAdapter } from './adapters/ws.ts'
import type { Config } from './config.ts'
import { Hub } from './core/hub.ts'
import { newToken } from './core/ids.ts'
import { apiRoutes } from './http/api.ts'
import { type App, createLimiters, Origins } from './http/context.ts'
import { hashPassword, verifyPassword } from './http/password.ts'
import { portalRoutes } from './http/portal.ts'
import { createLog } from './log.ts'
import { createMeter, type Meter, statsRoute } from './stats.ts'
import { Store } from './store/sqlite.ts'

export interface Running {
  app: App
  /** The port actually bound, which differs from the configured one when that is 0. */
  port: number
  /** Set while the server waits for the owner to choose a password. */
  setupUrl: string | null
  close(): Promise<void>
}

export async function startServer(config: Config, now: () => number = Date.now): Promise<Running> {
  const log = createLog(config.logLevel)
  let dbPath = ':memory:'
  if (config.dataDir !== ':memory:') {
    mkdirSync(config.dataDir, { recursive: true })
    dbPath = join(config.dataDir, 'p3p2.sqlite')
  }
  const store = new Store(dbPath)
  store.recoverInvites(now(), config.limits.inviteTtlMs)

  const hub = new Hub({
    store,
    limits: config.limits,
    now,
    log: (event, detail) => log(event === 'log-error' ? 'error' : event === 'frame-error' ? 'warn' : 'info', event, detail),
  })
  const app: App = {
    config,
    store,
    hub,
    origins: new Origins(store),
    log,
    now,
    setupToken: null,
    limiters: createLimiters(config.limits),
  }

  // The owner's password: from the environment when given, otherwise through the one-time setup link.
  const hash = store.ownerHash()
  if (config.ownerPassword) {
    if (!hash || !(await verifyPassword(config.ownerPassword, hash))) {
      store.setOwnerHash(await hashPassword(config.ownerPassword), now())
      store.deleteAllSessions()
      log('info', 'owner-set', { from: 'P3P2_OWNER_PASSWORD' })
    }
  } else if (!hash) {
    app.setupToken = newToken()
  }

  // The sockets attach once the server listens, after the routes are in place.
  let ws: WsAdapter | null = null
  let meter: Meter | null = null

  const root = new Hono()
  root.get('/healthz', (c) => c.text('ok'))
  if (config.statsToken) {
    meter = createMeter(hub, store, () => ws?.traffic() ?? { connections: 0, bytesIn: 0, bytesOut: 0 }, now)
    root.get('/api/v1/stats', statsRoute(meter, config.statsToken))
  }
  root.route('/api/v1', apiRoutes(app))
  root.route('/', portalRoutes(app))
  root.onError((err, c) => {
    log('error', 'request-failed', { path: c.req.path, error: String(err) })
    return c.text('Something went wrong', 500)
  })

  const server = await new Promise<Server>((resolve) => {
    const s = serve({ fetch: root.fetch, port: config.port, hostname: config.host }, () => resolve(s as Server))
  })
  ws = attachWs(server, hub, app)
  const port = (server.address() as AddressInfo).port

  return {
    app,
    port,
    setupUrl: app.setupToken ? `${config.publicUrl}/setup?token=${app.setupToken}` : null,
    async close() {
      hub.shutdown()
      ws?.close()
      meter?.close()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
      store.close()
    },
  }
}
