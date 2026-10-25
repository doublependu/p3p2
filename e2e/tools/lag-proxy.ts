// Makes a server on this machine feel far away: adds latency and jitter, and cuts connections.
// It forwards raw TCP, so REST calls and WebSockets both pass, and the server sees the requests
// (their Origin included) exactly as it would see them directly.
//
//   node e2e/tools/lag-proxy.ts [--listen 8081] [--to 127.0.0.1:8080]
//                               [--latency 100] [--jitter 30] [--drop-every 0]
//
//   --latency     ms added in each direction, so a round trip takes twice as long
//   --jitter      up to this many more ms, at random, per chunk of data
//   --drop-every  cut every connection each time this many seconds have passed (0: never)
//
// To play through it, open the invite link with the proxy's port in place of the server's
// (?room=http://192.168.1.118:8081/…). The link the panel then shows is built from that address,
// so everyone who opens it goes through the proxy too.

import { connect, createServer, type Socket } from 'node:net'

export interface LagOptions {
  /** Port to listen on; 0 picks a free one. */
  listen: number
  /** Address to listen on. Default: every interface, so phones on the Wi-Fi can use it. */
  host?: string
  to: { host: string; port: number }
  latency: number
  jitter: number
}

export interface LagProxy {
  port: number
  /** Cuts every connection, the way a network change does. Returns how many there were. */
  drop(): number
  close(): Promise<void>
}

/** Forwards what `from` sends to `to`, late, and in the order it came. */
function forward(from: Socket, to: Socket, delay: () => number): void {
  const queue: { at: number; chunk: Buffer | null }[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = 0

  const pump = () => {
    timer = undefined
    while (queue.length && queue[0]!.at <= performance.now()) {
      const { chunk } = queue.shift()!
      if (to.destroyed) return
      if (chunk) to.write(chunk)
      else to.end()
    }
    if (queue.length) timer = setTimeout(pump, Math.max(0, queue[0]!.at - performance.now()))
  }
  const push = (chunk: Buffer | null) => {
    // Never before the chunk in front of it: TCP delivers in order, whatever the jitter.
    last = Math.max(last, performance.now() + delay())
    queue.push({ at: last, chunk })
    timer ??= setTimeout(pump, Math.max(0, last - performance.now()))
  }

  from.on('data', push)
  from.on('end', () => push(null))
  from.on('close', () => {
    // An abrupt close is abrupt on the other side too; a clean one has already queued its end.
    if (from.errored || !from.readableEnded) {
      clearTimeout(timer)
      to.destroy()
    }
  })
  from.on('error', () => {})
}

export function startLagProxy(options: LagOptions): Promise<LagProxy> {
  const pairs = new Set<[Socket, Socket]>()
  const delay = () => options.latency + Math.random() * options.jitter

  const server = createServer((client) => {
    const upstream = connect(options.to.port, options.to.host)
    const pair: [Socket, Socket] = [client, upstream]
    pairs.add(pair)
    for (const s of pair) s.setNoDelay(true)
    forward(client, upstream, delay)
    forward(upstream, client, delay)
    const gone = () => {
      if (client.destroyed && upstream.destroyed) pairs.delete(pair)
    }
    client.on('close', gone)
    upstream.on('close', gone)
  })

  const drop = () => {
    const n = pairs.size
    for (const pair of pairs) for (const s of pair) s.destroy()
    pairs.clear()
    return n
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.listen, options.host ?? '0.0.0.0', () => {
      const address = server.address()
      resolve({
        port: typeof address === 'object' && address ? address.port : options.listen,
        drop,
        close: () =>
          new Promise((done) => {
            drop()
            server.close(() => done())
          }),
      })
    })
  })
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const flag = (name: string, fallback: string): string => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? (args[i + 1] ?? '') : fallback
  }
  const number = (name: string, fallback: number): number => {
    const n = Number(flag(name, String(fallback)))
    if (!Number.isFinite(n) || n < 0) {
      console.error(`lag-proxy: --${name} must be a number, 0 or more`)
      process.exit(1)
    }
    return n
  }
  const target = /^(.+):(\d+)$/.exec(flag('to', '127.0.0.1:8080'))
  if (!target) {
    console.error('lag-proxy: --to must look like 127.0.0.1:8080')
    process.exit(1)
  }
  const options: LagOptions = {
    listen: number('listen', 8081),
    to: { host: target[1]!, port: Number(target[2]) },
    latency: number('latency', 100),
    jitter: number('jitter', 30),
  }
  const dropEvery = number('drop-every', 0)

  const proxy = await startLagProxy(options)
  console.log(`lag-proxy: port ${proxy.port} → ${options.to.host}:${options.to.port}`)
  const cuts = dropEvery ? `, connections cut every ${dropEvery} s` : ''
  console.log(`  ${options.latency} ms each way, up to ${options.jitter} ms of jitter${cuts}`)
  console.log(`  In the game, use the room URL with port ${proxy.port} in place of ${options.to.port}.`)
  if (dropEvery) {
    setInterval(() => {
      const n = proxy.drop()
      if (n) console.log(`${new Date().toISOString().slice(11, 19)} cut ${n} connection${n === 1 ? '' : 's'}`)
    }, dropEvery * 1000)
  }
}
