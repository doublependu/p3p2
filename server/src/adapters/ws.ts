// The socket layer: upgrades, heartbeats and timers around the hub. All room rules live in core/.

import type { IncomingMessage, Server } from 'node:http'
import type { Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { type WebSocket, WebSocketServer } from 'ws'
import type { Hub, Session } from '../core/hub.ts'
import type { App } from '../http/context.ts'
import { forwardedIp } from '../http/context.ts'

export const WS_PATH: string = '/api/v1/ws'

const HEARTBEAT_MS = 5000
const TICK_MS = 1000
/** How often new ops of the rooms' logs are written to storage, together. */
const LOG_FLUSH_MS = 250
/** Connections that have not said hello yet. They cost memory and prove nothing. */
const MAX_PENDING = 256

interface Peer {
  session: Session
  socket: Socket
  pingAt: number
  missed: number
}

export interface Traffic {
  /** Open WebSockets. */
  connections: number
  /** Bytes on the wire of all WebSockets since the process started, the closed ones included. */
  bytesIn: number
  bytesOut: number
}

function refuse(socket: Duplex, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

export interface WsAdapter {
  traffic(): Traffic
  close(): void
}

export function attachWs(server: Server, hub: Hub, app: App): WsAdapter {
  const { limits } = app.config
  const wss = new WebSocketServer({ noServer: true, maxPayload: limits.maxFrameBytes, perMessageDeflate: false })
  const peers = new Map<WebSocket, Peer>()
  const closed = { bytesIn: 0, bytesOut: 0 }
  let pending = 0

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? '').split('?')[0]
    if (path !== WS_PATH) return refuse(socket, 404, 'Not Found')
    // Browsers do not apply CORS to WebSockets, so the Origin check is ours to do. Here it is
    // against every room's origins; hello then checks the one room.
    const origin = req.headers.origin
    if (!app.origins.has(origin)) return refuse(socket, 403, 'Forbidden')
    const forwarded = req.headers['x-forwarded-for']
    const ip = forwardedIp(req.socket.remoteAddress, Array.isArray(forwarded) ? forwarded.at(-1) : forwarded, app.config.trustProxy)
    if (pending >= MAX_PENDING || !app.limiters.connect.take(ip, app.now())) {
      return refuse(socket, 429, 'Too Many Requests')
    }
    wss.handleUpgrade(req, socket, head, (ws) => accept(ws, req.socket, origin, ip))
  })

  function accept(ws: WebSocket, socket: Socket, origin: string, ip: string): void {
    const session = hub.open(
      {
        send: (data) => ws.send(data),
        close: () => ws.close(1000),
        buffered: () => ws.bufferedAmount,
      },
      origin,
      ip,
    )
    const peer: Peer = { session, socket, pingAt: 0, missed: 0 }
    peers.set(ws, peer)

    pending++
    let counted = true
    const settle = () => {
      if (counted) pending--
      counted = false
      clearTimeout(timer)
    }
    const timer = setTimeout(() => {
      if (!session.joined) hub.fail(session, 'timeout', 'No hello arrived in time')
    }, limits.helloTimeoutMs)

    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) hub.receiveBinary(session, data)
      else hub.receive(session, data.toString('utf8'), data.length)
      if (session.joined) settle()
    })
    ws.on('pong', () => {
      peer.missed = 0
      if (peer.pingAt) session.rtt = performance.now() - peer.pingAt
    })
    ws.on('close', () => {
      settle()
      peers.delete(ws)
      closed.bytesIn += socket.bytesRead
      closed.bytesOut += socket.bytesWritten
      hub.closed(session)
    })
    // An error is always followed by 'close'; without a listener it would crash the process.
    ws.on('error', () => {})
  }

  const heartbeat = setInterval(() => {
    for (const [ws, peer] of peers) {
      // Two heartbeats without an answer: the connection is dead, whatever TCP still believes.
      if (peer.missed >= 2) {
        ws.terminate()
        continue
      }
      peer.missed++
      peer.pingAt = performance.now()
      ws.ping()
    }
    hub.broadcastRtt()
    const now = app.now()
    for (const limiter of Object.values(app.limiters)) limiter.sweep(now)
  }, HEARTBEAT_MS)

  const tick = setInterval(() => hub.tick(), TICK_MS)
  const presence = setInterval(() => hub.flushPresence(), 1000 / limits.presenceHz)
  const log = setInterval(() => hub.flushLog(), LOG_FLUSH_MS)

  return {
    traffic() {
      // The sockets count their own bytes, so the hot path pays nothing for these numbers.
      const total = { connections: peers.size, ...closed }
      for (const { socket } of peers.values()) {
        total.bytesIn += socket.bytesRead
        total.bytesOut += socket.bytesWritten
      }
      return total
    },
    close() {
      clearInterval(heartbeat)
      clearInterval(tick)
      clearInterval(presence)
      clearInterval(log)
      for (const ws of peers.keys()) ws.close(1001)
      wss.close()
    },
  }
}
