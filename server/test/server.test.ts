// The real server on a real port: REST, the portal and WebSockets together.

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as joinPath } from 'node:path'
import { after, test } from 'node:test'
import {
  type BinaryOutHeader,
  decodeBinary,
  encodeBinary,
  type InviteGrant,
  type InviteInfo,
  type RoomInfo,
  type ServerFrame,
  type ServerInfo,
  type ServerStats,
} from '@p3p2/protocol'
import { WebSocket } from 'ws'
import type { Config } from '../src/config.ts'
import { DEFAULT_LIMITS, type Limits } from '../src/core/limits.ts'
import { type Running, startServer } from '../src/server.ts'
import { VERSION } from '../src/version.ts'
import { untimed } from './helpers.ts'

const GAME = 'https://game.example.com'
const OTHER = 'https://other.example.com'
const PASSWORD = 'correct horse battery'

const open: Running[] = []
after(async () => {
  for (const r of open) await r.close()
})

async function start(over: Partial<Config> = {}, limits: Partial<Limits> = {}): Promise<{ r: Running; base: string }> {
  const r = await startServer({
    publicUrl: 'https://p3p2.example.com',
    name: 'test server',
    sourceUrl: 'https://source.example/a-changed-p3p2?v=1&x=<y>',
    port: 0,
    host: '127.0.0.1',
    dataDir: ':memory:',
    logLevel: 'silent',
    trustProxy: false,
    ownerPassword: PASSWORD,
    statsToken: null,
    limits: { ...DEFAULT_LIMITS, ...limits },
    ...over,
  })
  open.push(r)
  return { r, base: `http://127.0.0.1:${r.port}` }
}

/** A browser-ish portal session: keeps the cookie, sends Origin on forms, does not follow redirects. */
class Owner {
  cookie = ''
  private readonly base: string

  constructor(base: string) {
    this.base = base
  }

  async get(path: string): Promise<Response> {
    return fetch(this.base + path, { headers: { cookie: this.cookie }, redirect: 'manual' })
  }

  async post(path: string, form: Record<string, string> = {}, origin: string | null = this.base): Promise<Response> {
    const headers: Record<string, string> = { cookie: this.cookie, 'content-type': 'application/x-www-form-urlencoded' }
    if (origin) headers.origin = origin
    const res = await fetch(this.base + path, {
      method: 'POST',
      headers,
      body: new URLSearchParams(form),
      redirect: 'manual',
    })
    const set = res.headers.get('set-cookie')
    if (set) this.cookie = set.split(';')[0]!
    return res
  }

  async login(): Promise<void> {
    const res = await this.post('/login', { password: PASSWORD })
    assert.equal(res.status, 302)
  }

  /** Creates a room and returns its key. */
  async room(game: string = 'game.example.com', extra: Record<string, string> = {}): Promise<string> {
    const res = await this.post('/rooms', { game, ...extra })
    assert.equal(res.status, 302, await res.text())
    return res.headers.get('location')!.split('/').pop()!
  }
}

function api(base: string, path: string, token: string, origin: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${base}/api/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' },
  })
}

class Client {
  frames: ServerFrame[] = []
  /** Binary frames, taken apart. */
  binary: { header: BinaryOutHeader; payload: number[] }[] = []
  closed = false
  private waiting: (() => void)[] = []
  private readonly ws: WebSocket

  constructor(base: string, origin: string | null = GAME) {
    this.ws = new WebSocket(`${base.replace('http', 'ws')}/api/v1/ws`, origin ? { origin } : {})
    this.ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        const parts = decodeBinary(data)!
        this.binary.push({ header: JSON.parse(parts.header) as BinaryOutHeader, payload: [...parts.payload] })
      } else this.frames.push(JSON.parse(String(data)) as ServerFrame)
      this.wake()
    })
    this.ws.on('close', () => {
      this.closed = true
      this.wake()
    })
    this.ws.on('error', () => {})
  }

  private wake(): void {
    for (const w of this.waiting.splice(0)) w()
  }

  opened(): Promise<boolean> {
    return new Promise((resolve) => {
      this.ws.on('open', () => resolve(true))
      this.ws.on('unexpected-response', (_req, res) => resolve(res.statusCode === 101))
      this.ws.on('error', () => resolve(false))
    })
  }

  send(frame: unknown): void {
    this.ws.send(typeof frame === 'string' || frame instanceof Uint8Array ? frame : JSON.stringify(frame))
  }

  /** Resolves once the server has handled everything sent so far. */
  async settled(): Promise<void> {
    this.send({ t: 'ping', c: 1 })
    await this.next('pong')
  }

  hello(auth: { key: string } | { invite: string }, name: string, extra: Record<string, unknown> = {}): void {
    const pid = `${name.toLowerCase()}-player-id-0000`
    this.send({
      t: 'hello',
      proto: 1,
      auth,
      player: { pid, secret: `${pid}-secret` },
      game: { id: 'test', version: '1.0.0' },
      name,
      ...extra,
    })
  }

  /** The first frame of this type that has not been taken yet. */
  async next<T extends ServerFrame['t']>(t: T): Promise<Extract<ServerFrame, { t: T }>> {
    const deadline = Date.now() + 3000
    for (;;) {
      const i = this.frames.findIndex((f) => f.t === t)
      if (i >= 0) return this.frames.splice(i, 1)[0] as Extract<ServerFrame, { t: T }>
      if (this.closed) throw new Error(`closed while waiting for ${t}`)
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${t}`)
      await new Promise<void>((resolve) => {
        this.waiting.push(resolve)
        setTimeout(resolve, 100)
      })
    }
  }

  async untilClosed(): Promise<void> {
    const deadline = Date.now() + 3000
    while (!this.closed) {
      if (Date.now() > deadline) throw new Error('timed out waiting for close')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  close(): void {
    this.ws.close()
  }
}

async function join(base: string, auth: { key: string } | { invite: string }, name: string, origin: string = GAME) {
  const c = new Client(base, origin)
  assert.equal(await c.opened(), true)
  c.hello(auth, name)
  const welcome = await c.next('welcome')
  return { c, welcome }
}

test('health and server info', async () => {
  const { base } = await start()
  assert.equal(await (await fetch(`${base}/healthz`)).text(), 'ok')
  const res = await fetch(`${base}/api/v1/info`, { headers: { origin: 'https://anywhere.example' } })
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
  const info = (await res.json()) as ServerInfo
  assert.deepEqual(info.protocols, [1])
  assert.equal(info.name, 'test server')
  assert.equal(info.source, 'https://source.example/a-changed-p3p2?v=1&x=<y>')
  assert.equal(info.version, VERSION)
})

test('first run: the setup link sets the password once', async () => {
  const { r, base } = await start({ ownerPassword: null })
  assert.ok(r.setupUrl?.startsWith('https://p3p2.example.com/setup?token='))
  const token = new URL(r.setupUrl!).searchParams.get('token')!
  const owner = new Owner(base)

  assert.match(await (await owner.get('/')).text(), /not set up yet/)
  assert.equal((await owner.get('/setup?token=wrong')).status, 403)
  assert.match(await (await owner.get(`/setup?token=${token}`)).text(), /Choose the owner password/)

  assert.equal((await owner.post('/setup', { token, password: 'short', confirm: 'short' })).status, 400)
  assert.equal((await owner.post('/setup', { token, password: 'long enough', confirm: 'different!' })).status, 400)
  assert.equal((await owner.post('/setup', { token: 'wrong', password: 'long enough', confirm: 'long enough' })).status, 403)
  const done = await owner.post('/setup', { token, password: 'long enough', confirm: 'long enough' })
  assert.equal(done.status, 302)
  assert.match(await (await owner.get('/')).text(), /New room/)

  // The link is spent, and the password works.
  assert.equal((await new Owner(base).get(`/setup?token=${token}`)).status, 302)
  const again = new Owner(base)
  assert.equal((await again.post('/login', { password: 'long enough' })).status, 302)
})

test('portal: login, sessions, and forms from other sites', async () => {
  const { base } = await start()
  const owner = new Owner(base)
  assert.equal((await owner.get('/')).headers.get('location'), '/login')
  assert.equal((await owner.post('/login', { password: 'nope' })).status, 401)
  assert.equal((await owner.post('/login', { password: PASSWORD }, 'https://evil.example')).status, 403)
  assert.equal((await owner.post('/login', { password: PASSWORD }, null)).status, 403)
  assert.equal(owner.cookie, '')

  const res = await owner.post('/login', { password: PASSWORD })
  assert.match(res.headers.get('set-cookie')!, /HttpOnly/)
  assert.match(res.headers.get('set-cookie')!, /SameSite=Strict/)
  assert.match(res.headers.get('set-cookie')!, /Secure/) // PUBLIC_URL is https
  const page = await owner.get('/')
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-security-policy')!, /default-src 'none'/)
  assert.equal(page.headers.get('referrer-policy'), 'same-origin')
  // What a browser sends when a page's referrer policy hides the origin.
  assert.equal((await new Owner(base).post('/login', { password: PASSWORD }, 'null')).status, 403)

  await owner.post('/logout')
  assert.equal((await owner.get('/')).headers.get('location'), '/login')
})

test('portal: repeated wrong passwords are slowed down', async () => {
  const { base } = await start()
  const owner = new Owner(base)
  const statuses: number[] = []
  for (let i = 0; i < 7; i++) statuses.push((await owner.post('/login', { password: 'nope' })).status)
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429, 429])
  // Locked out means locked out, even with the right password.
  assert.equal((await owner.post('/login', { password: PASSWORD })).status, 429)
})

test('portal: logging in correctly, however often, is never slowed down', async () => {
  const { base } = await start()
  for (let i = 0; i < 12; i++) assert.equal((await new Owner(base).post('/login', { password: PASSWORD })).status, 302)
})

test('portal: creating rooms', async () => {
  const { base } = await start({}, { maxRooms: 3 })
  const owner = new Owner(base)
  assert.equal((await owner.post('/rooms', { game: 'game.example.com' })).headers.get('location'), '/login')
  await owner.login()

  const key = await owner.room('game.example.com', { name: 'Friday games', max: '8', origins: 'http://192.168.1.118:5173/some/path' })
  assert.match(key, /^[0-9a-hjkmnp-tv-z]{26}$/)
  const page = await (await owner.get(`/room/${key}`)).text()
  assert.match(page, /Friday games/)
  assert.ok(page.includes(`https://p3p2.example.com/room/${key}`))
  assert.ok(page.includes('http://192.168.1.118:5173'))
  assert.match(await (await owner.get('/')).text(), /Friday games/)

  const refused: Record<string, string>[] = [
    { game: 'not a url' },
    { game: 'word' },
    { game: 'ftp://game.example.com' },
    { game: 'game.example.com', max: '0' },
    { game: 'game.example.com', max: '65' },
    { game: 'game.example.com', origins: 'what is this' },
  ]
  for (const bad of refused) {
    assert.equal((await owner.post('/rooms', bad)).status, 400, JSON.stringify(bad))
  }
  // Several rooms for the same game, up to the server's limit.
  await owner.room('game.example.com')
  await owner.room('game.example.com')
  const full = await owner.post('/rooms', { game: 'game.example.com' })
  assert.equal(full.status, 400)
  assert.match(await full.text(), /at most 3 rooms/)
})

test('portal: someone who is not the owner sees only what to do with a room URL', async () => {
  const { base } = await start()
  const owner = new Owner(base)
  await owner.login()
  const key = await owner.room()
  const visitor = new Owner(base)
  const page = await (await visitor.get(`/room/${key}`)).text()
  assert.match(page, /paste it into the game/)
  assert.doesNotMatch(page, /Danger zone/)
  // Every page says where the source is (the AGPL's offer), escaped like any other value.
  const footer = `<footer>p3p2 ${VERSION} · <a href="https://source.example/a-changed-p3p2?v=1&amp;x=&lt;y&gt;">Source code</a></footer>`
  assert.ok(page.includes(footer), page)
  assert.ok((await (await visitor.get('/login')).text()).includes(footer))
  assert.equal((await visitor.get(`/room/${'0'.repeat(26)}`)).status, 404)
  assert.equal((await visitor.get(`/room/${key}/qr.svg`)).status, 404)
  assert.equal((await visitor.post(`/room/${key}/delete`)).headers.get('location'), '/login')
  assert.equal((await owner.get(`/room/${key}`)).status, 200)
})

test('api: CORS answers only origins that some room accepts', async () => {
  const { base } = await start()
  const owner = new Owner(base)
  await owner.login()
  const key = await owner.room('game.example.com')

  const preflight = (origin: string) =>
    fetch(`${base}/api/v1/room`, {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' },
    })
  const ok = await preflight(GAME)
  assert.equal(ok.status, 204)
  assert.equal(ok.headers.get('access-control-allow-origin'), GAME)
  assert.match(ok.headers.get('access-control-allow-headers')!, /Authorization/)
  const no = await preflight('https://evil.example')
  assert.equal(no.status, 403)
  assert.equal(no.headers.get('access-control-allow-origin'), null)

  const evil = await api(base, '/room', key, 'https://evil.example')
  assert.equal(evil.status, 403)
  assert.equal(evil.headers.get('access-control-allow-origin'), null)
  const none = await fetch(`${base}/api/v1/room`, { headers: { authorization: `Bearer ${key}` } })
  assert.equal(none.status, 403)
})

test('api: a room key works only from its own game', async () => {
  const { base } = await start()
  const owner = new Owner(base)
  await owner.login()
  const key = await owner.room('game.example.com', { name: 'Friday games' })
  const other = await owner.room('other.example.com')

  const res = await api(base, '/room', key, GAME)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('access-control-allow-origin'), GAME)
  assert.deepEqual((await res.json()) as RoomInfo, {
    name: 'Friday games',
    game: { url: 'https://game.example.com/' },
    maxMembers: 16,
    members: 0,
  })

  // other.example.com is known to the server, so it may read the answer, and the answer is no.
  const wrong = await api(base, '/room', key, OTHER)
  assert.equal(wrong.status, 403)
  assert.equal(((await wrong.json()) as { error: string }).error, 'origin')
  assert.equal((await api(base, '/room', other, OTHER)).status, 200)
  assert.equal((await api(base, '/room', '0'.repeat(26), GAME)).status, 401)
  assert.equal((await api(base, '/room', '', GAME)).status, 401)
  assert.equal((await api(base, '/nope', key, GAME)).status, 404)
})

test('api: invites are created once, renewed on request, and describe the room to a guest', async () => {
  const { base } = await start()
  const owner = new Owner(base)
  await owner.login()
  const key = await owner.room('game.example.com', { name: 'Friday games', origins: 'http://192.168.1.118:5173' })

  const post = async (body: unknown) => (await (await api(base, '/room/invite', key, GAME, { method: 'POST', body: JSON.stringify(body) })).json()) as InviteGrant
  const first = await post({ page: 'http://192.168.1.118:5173/my-game/?room=old.example/0000000000&x=1#top', param: 'room' })
  assert.match(first.code, /^[0-9a-hjkmnp-tv-z]{10}$/)
  assert.ok(first.expiresAt! > Date.now())
  assert.equal((await post({})).code, first.code)
  assert.equal(((await (await api(base, '/room', key, GAME)).json()) as RoomInfo).invite?.code, first.code)

  // The portal shows the link the host's game built, and its QR code.
  const page = await (await owner.get(`/room/${key}`)).text()
  assert.ok(page.includes(`http://192.168.1.118:5173/my-game/?x=1&amp;room=p3p2.example.com/${first.code}`), page)
  const qr = await owner.get(`/room/${key}/qr.svg`)
  assert.equal(qr.headers.get('content-type'), 'image/svg+xml')
  assert.match(await qr.text(), /^<svg/)

  const info = await api(base, '/invite', first.code, GAME)
  assert.deepEqual((await info.json()) as InviteInfo, { room: { name: 'Friday games' }, hostName: null, members: 0, maxMembers: 16 })
  assert.equal((await api(base, '/invite', first.code, OTHER)).status, 403)

  const second = await post({ renew: true })
  assert.notEqual(second.code, first.code)
  assert.equal((await api(base, '/invite', first.code, GAME)).status, 401)
  assert.equal((await api(base, '/invite', second.code, GAME)).status, 200)
  // A page on a site the room does not accept is ignored: the portal falls back to the game URL.
  await post({ renew: true, page: 'https://evil.example/', param: 'room' })
  assert.match(await (await owner.get(`/room/${key}`)).text(), /https:\/\/game\.example\.com\/\?room=p3p2\.example\.com\//)
})

test('ws: a host and two guests chat', async () => {
  const { base } = await start()
  const owner = new Owner(base)
  await owner.login()
  const key = await owner.room()
  const { code } = (await (await api(base, '/room/invite', key, GAME, { method: 'POST' })).json()) as InviteGrant

  const host = await join(base, { key }, 'Ada')
  assert.equal(host.welcome.self.mod, true)
  assert.equal(host.welcome.host, host.welcome.self.id)
  const g1 = await join(base, { invite: code }, 'Grace')
  const g2 = await join(base, { invite: code }, 'Edsger')
  assert.equal(g2.welcome.members.length, 3)
  assert.equal(g2.welcome.self.mod, false)
  assert.equal((await host.c.next('member+')).name, 'Grace')
  assert.equal((await host.c.next('member+')).name, 'Edsger')

  g1.c.send({ t: 'msg', ch: '$chat', data: 'hello all', to: 'all', retain: 'tail' })
  for (const p of [host, g1, g2]) {
    const m = await p.c.next('msg')
    assert.deepEqual([m.from, m.ch, m.data], [g1.welcome.self.id, '$chat', 'hello all'])
  }
  // Someone who joins later sees the recent chat.
  const late = await join(base, { invite: code }, 'Barbara')
  assert.equal(late.welcome.retained.tail.$chat?.[0]?.data, 'hello all')
  assert.equal(late.welcome.retained.tail.$chat?.[0]?.name, 'Grace')

  const info = (await (await api(base, '/invite', code, GAME)).json()) as InviteInfo
  assert.deepEqual([info.hostName, info.members], ['Ada', 4])
  for (const p of [host, g1, g2, late]) p.c.close()
})

test('ws: connections from other sites are refused', async () => {
  const { base } = await start()
  const owner = new Owner(base)
  await owner.login()
  const key = await owner.room('game.example.com')
  await owner.room('other.example.com')

  assert.equal(await new Client(base, 'https://evil.example').opened(), false)
  assert.equal(await new Client(base, null).opened(), false)
  // A site that hosts another room connects, but cannot enter this one.
  const c = new Client(base, OTHER)
  assert.equal(await c.opened(), true)
  c.hello({ key }, 'Mallory')
  assert.equal((await c.next('error')).code, 'origin')
  await c.untilClosed()
})

test('ws: silence, malformed binary frames and oversized frames end the connection', async () => {
  const { base } = await start({}, { helloTimeoutMs: 150, maxFrameBytes: 2048 })
  const owner = new Owner(base)
  await owner.login()
  const key = await owner.room()

  const silent = new Client(base)
  assert.equal(await silent.opened(), true)
  assert.equal((await silent.next('error')).code, 'timeout')
  await silent.untilClosed()

  const binary = await join(base, { key }, 'Ada')
  binary.c.send(Buffer.from([1, 2, 3]))
  assert.equal((await binary.c.next('error')).code, 'bad-frame')
  await binary.c.untilClosed()

  const big = await join(base, { key }, 'Grace')
  big.c.send({ t: 'msg', ch: 'x', data: 'x'.repeat(4096) })
  await big.c.untilClosed()
})

test('ws: presence arrives in batches at the presence rate', async () => {
  const { base } = await start({}, { presenceHz: 10 })
  const owner = new Owner(base)
  await owner.login()
  const key = await owner.room()
  const a = await join(base, { key }, 'Ada')
  const b = await join(base, { key }, 'Grace')
  const c = await join(base, { key }, 'Edsger')

  // Many updates inside one tick: the others get one frame each, with the last value.
  for (let x = 1; x <= 20; x++) a.c.send({ t: 'pres', data: { x } })
  b.c.send({ t: 'pres', data: { x: -1 } })
  assert.deepEqual(untimed((await c.c.next('pres')).list), [[a.welcome.self.id, { x: 20 }], [b.welcome.self.id, { x: -1 }]])
  assert.deepEqual(untimed((await b.c.next('pres')).list), [[a.welcome.self.id, { x: 20 }]])
  assert.deepEqual(untimed((await a.c.next('pres')).list), [[b.welcome.self.id, { x: -1 }]])
  await new Promise((resolve) => setTimeout(resolve, 250))
  assert.equal([a, b, c].flatMap((p) => p.c.frames.filter((f) => f.t === 'pres')).length, 0)

  const late = await join(base, { key }, 'Barbara')
  assert.deepEqual(untimed(late.welcome.presence), [[a.welcome.self.id, { x: 20 }], [b.welcome.self.id, { x: -1 }]])
  for (const p of [a, b, c, late]) p.c.close()
})

test('ws: binary frames reach the others byte for byte', async () => {
  const { base } = await start()
  const owner = new Owner(base)
  await owner.login()
  const key = await owner.room()
  const a = await join(base, { key }, 'Ada')
  const b = await join(base, { key }, 'Grace')

  const payload = Array.from({ length: 5000 }, (_, i) => (i * 31) & 255)
  a.c.send(encodeBinary(JSON.stringify({ t: 'msg', ch: 'snap' }), Uint8Array.from(payload)))
  a.c.send({ t: 'msg', ch: 'after', data: 1 })
  // In order with the text frames around it.
  assert.equal((await b.c.next('msg')).ch, 'after')
  assert.equal(b.c.binary.length, 1)
  assert.deepEqual(b.c.binary[0]!.payload, payload)
  const header = b.c.binary[0]!.header
  assert.deepEqual([header.t, header.from, header.ch], ['msg', a.welcome.self.id, 'snap'])
  assert.equal(typeof header.ts, 'number')
  await a.c.settled()
  assert.equal(a.c.binary.length, 0)
  for (const p of [a, b]) p.c.close()
})

test('ws and api: the limits per address are settings', async () => {
  const { base } = await start({}, { connectRate: 0.001, connectBurst: 2, apiRate: 0.001, apiBurst: 2 })
  const owner = new Owner(base)
  await owner.login()
  const key = await owner.room()

  const calls: number[] = []
  for (let i = 0; i < 3; i++) calls.push((await api(base, '/room', key, GAME)).status)
  assert.deepEqual(calls, [200, 200, 429])

  const clients = [new Client(base), new Client(base), new Client(base)]
  assert.deepEqual(await Promise.all(clients.map((c) => c.opened())), [true, true, false])
  for (const c of clients) c.close()
})

test('stats: for the holder of the stats token only', async () => {
  const token = 'stats-token-0123456789'
  const { base } = await start({ statsToken: token })
  const stats = (bearer: string, query: string = '') =>
    fetch(`${base}/api/v1/stats${query}`, { headers: { authorization: `Bearer ${bearer}` } })
  assert.equal((await stats('wrong-token-0123456789')).status, 401)
  assert.equal((await fetch(`${base}/api/v1/stats`)).status, 401)

  const owner = new Owner(base)
  await owner.login()
  const key = await owner.room()
  const a = await join(base, { key }, 'Ada')
  const b = await join(base, { key }, 'Grace')
  a.c.send({ t: 'msg', ch: 'x', data: 1 })
  await b.c.next('msg')

  const res = await stats(token, '?reset=1')
  assert.equal(res.headers.get('access-control-allow-origin'), null)
  const s = (await res.json()) as ServerStats
  assert.deepEqual([s.rooms, s.members, s.connections], [1, 2, 2])
  // In: two hellos and a message. Out: two welcomes, a member+ and the message.
  assert.deepEqual([s.framesIn, s.framesOut], [3, 4])
  assert.ok(s.bytesIn > 300 && s.bytesOut > 300, `${s.bytesIn} in, ${s.bytesOut} out`)
  assert.ok(s.writes >= 2 && s.memory.rss > 0 && s.cpu.user > 0 && s.uptime > 0)
  assert.ok(s.loop.p50 <= s.loop.p99 && s.loop.p99 <= s.loop.max)

  // The bytes of connections that have closed still count.
  for (const p of [a, b]) p.c.close()
  await Promise.all([a.c.untilClosed(), b.c.untilClosed()])
  await new Promise((resolve) => setTimeout(resolve, 50))
  const after = (await (await stats(token)).json()) as ServerStats
  assert.equal(after.connections, 0)
  assert.ok(after.bytesIn >= s.bytesIn && after.bytesOut >= s.bytesOut)

  // A server without a token has no such endpoint.
  const plain = await start()
  assert.equal((await fetch(`${plain.base}/api/v1/stats`, { headers: { authorization: `Bearer ${token}` } })).status, 403)
})

test('portal: kick, end session, rotate key, delete room', async () => {
  const { base, r } = await start()
  const owner = new Owner(base)
  await owner.login()
  const key = await owner.room()
  const { code } = (await (await api(base, '/room/invite', key, GAME, { method: 'POST' })).json()) as InviteGrant

  const host = await join(base, { key }, 'Ada')
  const guest = await join(base, { invite: code }, 'Grace')
  const page = await (await owner.get(`/room/${key}`)).text()
  assert.match(page, /Ada/)
  assert.match(page, /Grace/)

  await owner.post(`/room/${key}/kick`, { member: String(guest.welcome.self.id) })
  assert.equal((await guest.c.next('bye')).reason, 'kicked')
  assert.equal((await host.c.next('member-')).reason, 'kicked')

  await owner.post(`/room/${key}/end`)
  assert.equal((await host.c.next('bye')).reason, 'ended')
  assert.equal((await api(base, '/invite', code, GAME)).status, 401)

  const rotated = await owner.post(`/room/${key}/rotate`)
  const fresh = rotated.headers.get('location')!.split('/').pop()!
  assert.notEqual(fresh, key)
  assert.equal((await api(base, '/room', key, GAME)).status, 401)
  assert.equal((await api(base, '/room', fresh, GAME)).status, 200)

  await owner.post(`/room/${fresh}/delete`)
  assert.equal((await owner.get(`/room/${fresh}`)).status, 404)
  // With its only room gone, the site is unknown again.
  assert.equal(r.app.origins.has(GAME), false)
  assert.equal((await api(base, '/room', fresh, GAME)).status, 403)
})

test('portal: settings and clearing saved data', async () => {
  const { base } = await start()
  const owner = new Owner(base)
  await owner.login()
  const key = await owner.room()

  const local = 'http://192.168.1.118:5173'
  assert.equal((await api(base, '/room', key, local)).status, 403)
  assert.equal((await owner.post(`/room/${key}/settings`, { name: 'Renamed', max: '4', origins: `${local}\n` })).status, 302)
  const info = (await (await api(base, '/room', key, local)).json()) as RoomInfo
  assert.deepEqual([info.name, info.maxMembers], ['Renamed', 4])
  assert.equal((await api(base, '/room', key, GAME)).status, 200) // the game's own site cannot be removed
  assert.equal((await owner.post(`/room/${key}/settings`, { name: 'x', max: '999', origins: '' })).status, 400)

  // Game versions: kept apart by default, until the owner says otherwise.
  const hello = async (version: string) => {
    const c = new Client(base)
    await c.opened()
    c.hello({ key }, `on-${version.replace('.', '-')}`, { game: { id: 'test', version } })
    return c
  }
  const settings = { name: 'Renamed', max: '4', origins: local }
  const one = await hello('1.0')
  await one.next('welcome')
  assert.equal((await (await hello('1.1')).next('error')).code, 'version')
  assert.match(await (await owner.get(`/room/${key}`)).text(), /<option value="exact" selected>/)
  await owner.post(`/room/${key}/settings`, { ...settings, versions: 'major' })
  assert.match(await (await owner.get(`/room/${key}`)).text(), /<option value="major" selected>/)
  const two = await hello('1.1')
  await two.next('welcome')
  // A form without the field, or with nonsense in it, leaves the policy alone.
  await owner.post(`/room/${key}/settings`, settings)
  await owner.post(`/room/${key}/settings`, { ...settings, versions: 'whatever' })
  assert.match(await (await owner.get(`/room/${key}`)).text(), /<option value="major" selected>/)
  one.close()
  two.close()
  await owner.post(`/room/${key}/end`)

  const host = await join(base, { key }, 'Ada')
  host.c.send({ t: 'msg', ch: 'world', data: { seed: 7 }, retain: 'room' })
  host.c.send({ t: 'msg', ch: 'pos', data: { x: 1 }, retain: 'player' })
  host.c.send({ t: 'snap', data: { blocks: [] }, upTo: 0 })
  host.c.send({ t: 'op', op: { t: 'block', x: 1 } })
  await host.c.settled()
  await owner.post(`/room/${key}/clear`)
  assert.equal((await host.c.next('bye')).reason, 'ended')
  const again = await join(base, { key }, 'Ada')
  assert.deepEqual(again.welcome.retained, { room: {}, player: {}, tail: {} })
  assert.deepEqual(again.welcome.log, { snap: null, ops: [] })
  // The log starts over, numbers included.
  again.c.send({ t: 'op', op: 'first again' })
  assert.equal((await again.c.next('op')).seq, 1)
  again.c.close()
})

test('ws: ops come back numbered, and are on disk a moment later without anyone leaving', async () => {
  const { base, r } = await start()
  const owner = new Owner(base)
  await owner.login()
  const key = await owner.room()
  const { code } = (await (await api(base, '/room/invite', key, GAME, { method: 'POST' })).json()) as InviteGrant
  const ada = await join(base, { key }, 'Ada')
  const grace = await join(base, { invite: code }, 'Grace')
  const roomId = r.app.store.listRooms()[0]!.id

  grace.c.send({ t: 'op', op: { t: 'block', x: 1 } })
  ada.c.send({ t: 'op', op: { t: 'block', x: 2 } })
  for (const c of [ada.c, grace.c]) {
    const first = await c.next('op')
    const second = await c.next('op')
    assert.deepEqual([first.seq, first.from, first.op], [1, grace.welcome.self.id, { t: 'block', x: 1 }])
    assert.deepEqual([second.seq, second.from, second.op], [2, ada.welcome.self.id, { t: 'block', x: 2 }])
  }
  const deadline = Date.now() + 2000
  while (r.app.store.loadLog(roomId).ops.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(
    r.app.store.loadLog(roomId).ops.map((o) => o.seq),
    [1, 2],
  )

  // A guest cannot replace the log by a snapshot; the host can.
  grace.c.send({ t: 'snap', data: 'mine', upTo: 2 })
  assert.equal((await grace.c.next('error')).code, 'forbidden')
  ada.c.send({ t: 'snap', data: { blocks: 2 }, upTo: 2 })
  await ada.c.settled()
  const late = await join(base, { invite: code }, 'Edsger')
  assert.deepEqual(late.welcome.log, { snap: { upTo: 2, data: { blocks: 2 } }, ops: [] })
  for (const { c } of [ada, grace, late]) c.close()
})

test('saved room and player values, the log, and the owner survive a restart', async () => {
  const dir = mkdtempSync(joinPath(tmpdir(), 'p3p2-test-'))
  try {
    const first = await start({ dataDir: dir })
    const owner = new Owner(first.base)
    await owner.login()
    const key = await owner.room()
    const host = await join(first.base, { key }, 'Ada')
    host.c.send({ t: 'msg', ch: 'world', data: { seed: 42 }, retain: 'room' })
    host.c.send({ t: 'msg', ch: 'pos', data: { x: 3, z: -4 }, retain: 'player' })
    for (const n of [1, 2, 3]) host.c.send({ t: 'op', op: { n } })
    host.c.send({ t: 'snap', data: { sum: 3 }, upTo: 2 })
    await host.c.settled()
    // The server stops with the room open: the ops it has not written yet are written first.
    await first.r.close()
    open.splice(open.indexOf(first.r), 1)

    const second = await start({ dataDir: dir })
    const again = await join(second.base, { key }, 'Ada')
    assert.deepEqual(again.welcome.retained.room, { world: { seed: 42 } })
    assert.deepEqual(again.welcome.retained.player, { [again.welcome.self.pid]: { pos: { x: 3, z: -4 } } })
    const { log } = again.welcome
    assert.deepEqual(log?.snap, { upTo: 2, data: { sum: 3 } })
    assert.deepEqual(
      log?.ops.map((o) => [o.seq, o.pid, o.op]),
      [[3, again.welcome.self.pid, { n: 3 }]],
    )
    again.c.send({ t: 'op', op: { n: 4 } })
    assert.equal((await again.c.next('op')).seq, 4)
    again.c.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
