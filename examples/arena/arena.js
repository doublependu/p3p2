// The arena example's game. Each player moves a figure of their own, and says where it is in their presence. One
// page, the host's, runs what has to run once: the bots, which chase the players, and a ball the players kick. It
// tells each player, ten times a second, what that player can see, and nothing else. The round is a value the
// room keeps, which the host writes: whoever comes into a running round starts from it, and so does the next host.

import { P3P2 } from '@p3p2/client'
import { Smooth } from '@p3p2/client/smooth'

/** The field, in its own units. */
const W = 1200
const H = 800
/** Units a second: a player's figure, and a bot. */
const SPEED = 240
const BOT_SPEED = 120
/** How far a player sees: the host tells it of what is nearer than this. */
const SIGHT = 360
/** A bot this close catches a player; a player this close to the ball can kick it. */
const CATCH = 24
const REACH = 40
const BOTS = 5
/** The host's reports: ten a second. And how often it writes the round down for the room. */
const REPORT_MS = 100
const SAVE_MS = 2000
const ROUND_MS = 120_000
/** In a report, each thing is four numbers: its kind, its id, and where it is. */
const BOT = 0
const BALL = 1

const $ = (id) => document.getElementById(id)
const canvas = $('field')
const ctx = canvas.getContext('2d')
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const isPoint = (p) => Number.isFinite(p?.x) && Number.isFinite(p?.y)

/** This player's figure, and where the keys or the thumb stick push it. */
let me = { x: W / 2, y: H / 2 }
const input = { x: 0, y: 0 }
let room = null
let off = []

/** The host's world: only the host's page moves these. */
let bots = []
let ball = { x: W / 2, y: H / 3, vx: 0, vy: 0 }
/** The round: its number, its start on the room's clock, and how often each player was caught. */
let round = { n: 1, start: 0, scores: {} }
/** What the host told each member in its last report, in bytes, by name: for the tests. */
let told = {}
/** Which member each bot is after, by name: for the tests. */
let targets = {}

/** The others' figures, and what the host's reports show, drawn a little in the past. */
const figures = new Smooth({ jump: 200 })
const seen = new Smooth({ jump: 200 })
/** The things in the last report, and how large it was. */
let got = { bytes: 0, things: [] }
let caught = 0

// A reload comes back to where the figure was.
try {
  const saved = JSON.parse(sessionStorage.getItem('arena-example:me') ?? 'null')
  if (isPoint(saved)) me = saved
} catch {
  // A new figure, in the middle.
}
addEventListener('pagehide', () => {
  try {
    sessionStorage.setItem('arena-example:me', JSON.stringify(me))
  } catch {
    // Not kept.
  }
})

const p3p2 = new P3P2({
  game: { id: 'arena-example', version: BUILD_ID },
  // The thumb stick has the bottom left corner.
  ui: { corner: 'bottom-right' },
})
window.p3p2 = p3p2

function freshBots() {
  return Array.from({ length: BOTS }, (_, i) => ({ id: i + 1, x: (W / (BOTS + 1)) * (i + 1), y: 40 }))
}

/** Where this page last drew a member's figure: its own (or, alone, null's), or another's. */
function whereIs(m, now = performance.now()) {
  if (m === null || m === room?.self) return me
  const at = figures.get(m.id, now)
  return at ? { x: at[0], y: at[1] } : null
}

// ---- the host's part ----

/** Becomes the host: carries on from what this page last drew, and from the round the room keeps for the rest. */
function takeOver() {
  const kept = room.retained('round')
  if (kept && Number.isInteger(kept.n)) round = { n: kept.n, start: kept.start, scores: { ...kept.scores } }
  else round = { n: 1, start: room.now(), scores: {} }
  const now = performance.now()
  const savedBots = Array.isArray(kept?.bots) ? kept.bots : freshBots()
  bots = savedBots.filter(isPoint).map((b) => {
    const drawn = seen.get(`b${b.id}`, now)
    return { id: b.id, x: drawn ? drawn[0] : b.x, y: drawn ? drawn[1] : b.y }
  })
  if (!bots.length) bots = freshBots()
  const drawnBall = seen.get('ball', now)
  if (drawnBall) ball = { x: drawnBall[0], y: drawnBall[1], vx: 0, vy: 0 }
  else if (isPoint(kept?.ball)) ball = { ...kept.ball, vx: 0, vy: 0 }
  seen.clear()
  saveRound()
}

/** The round, and where the bots and the ball are, for the room to keep. */
function saveRound() {
  const bots_ = bots.map(({ id, x, y }) => ({ id, x: Math.round(x), y: Math.round(y) }))
  room.send('round', { ...round, bots: bots_, ball: { x: Math.round(ball.x), y: Math.round(ball.y) } }, { retain: 'room' })
}

function runBots(dt) {
  // The bots go only for players who can play: here, not in the background, not lost. Alone, for this one.
  const prey = room ? room.members.filter((m) => m === room.self || m.state === 'here') : [null]
  targets = {}
  for (const bot of bots) {
    let best = null
    let far = Infinity
    for (const m of prey) {
      const p = whereIs(m)
      const d = p ? Math.hypot(p.x - bot.x, p.y - bot.y) : Infinity
      if (d < far) [best, far] = [m, d]
    }
    if (far === Infinity) continue
    targets[bot.id] = best?.name ?? 'you'
    const p = whereIs(best)
    const step = Math.min(far, BOT_SPEED * dt)
    if (far > 0) {
      bot.x += ((p.x - bot.x) / far) * step
      bot.y += ((p.y - bot.y) / far) * step
    }
    // Everybody this bot reaches is caught, and told so in one message: one message for a list of members.
    const reached = prey.filter((m) => {
      const q = whereIs(m)
      return q && Math.hypot(q.x - bot.x, q.y - bot.y) < CATCH
    })
    if (reached.length) {
      for (const m of reached) round.scores[m?.pid ?? 'alone'] = (round.scores[m?.pid ?? 'alone'] ?? 0) + 1
      room?.send('caught', { bot: bot.id }, { to: reached.map((m) => m.id) })
      if (reached.includes(room?.self ?? null)) caught++
      Object.assign(bot, { x: bot.id % 2 ? 20 : W - 20, y: bot.id % 3 ? 20 : H - 20 })
    }
  }
}

function runBall(dt) {
  ball.x += ball.vx * dt
  ball.y += ball.vy * dt
  if (ball.x < 10 || ball.x > W - 10) ball.vx = -ball.vx
  if (ball.y < 10 || ball.y > H - 10) ball.vy = -ball.vy
  ball.x = clamp(ball.x, 10, W - 10)
  ball.y = clamp(ball.y, 10, H - 10)
  const slow = 0.6 ** dt
  ball.vx *= slow
  ball.vy *= slow
}

/** A kick, by the host's own player or asked for by a guest: only from close by. */
function kick(m) {
  const p = whereIs(m)
  if (!p) return
  const d = Math.hypot(ball.x - p.x, ball.y - p.y)
  if (d > REACH || d === 0) return
  ball.vx = ((ball.x - p.x) / d) * 500
  ball.vy = ((ball.y - p.y) / d) * 500
}

/** Tells each guest what it can see, as bytes made for it, all in one message. */
function report() {
  const things = [...bots.map((b) => [BOT, b.id, b.x, b.y]), [BALL, 0, ball.x, ball.y]]
  const parts = []
  told = {}
  for (const m of room.members) {
    const p = m === room.self ? null : whereIs(m)
    if (!p) continue
    const near = things.filter(([, , x, y]) => Math.hypot(x - p.x, y - p.y) <= SIGHT)
    const bytes = new Int16Array(near.length * 4)
    for (const [i, [kind, id, x, y]] of near.entries()) bytes.set([kind, id, Math.round(x), Math.round(y)], i * 4)
    parts.push([m, bytes])
    told[m.name] = bytes.byteLength
  }
  if (parts.length) room.sendEach('view', parts, { volatile: true })
}

// ---- every page ----

function onView(data, from) {
  if (from !== room.host || room.isHost || !(data instanceof Uint8Array) || data.byteLength % 8) return
  // A view into the message as it came: read from its offset.
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const things = []
  for (let i = 0; i < data.byteLength; i += 8) {
    const [kind, id, x, y] = [0, 2, 4, 6].map((o) => view.getInt16(i + o, true))
    const key = kind === BALL ? 'ball' : `b${id}`
    seen.set(key, [x, y])
    things.push(key)
  }
  // What is out of sight now is not drawn.
  for (const key of got.things) if (!things.includes(key)) seen.delete(key)
  got = { bytes: data.byteLength, things }
}

function enter(r) {
  for (const stop of off) stop()
  room = r
  figures.clear()
  seen.clear()
  got = { bytes: 0, things: [] }
  const see = (m, p, at) => {
    if (isPoint(p)) figures.set(m.id, [p.x, p.y], at)
    else figures.delete(m.id)
  }
  // Somebody standing still says nothing more: read what the room has, with when it came.
  for (const m of r.members) if (m !== r.self) see(m, r.presence.get(m), r.presence.at(m))
  r.presence.set({ x: Math.round(me.x), y: Math.round(me.y) })
  off = [
    r.presence.on(see),
    r.on('view', onView),
    r.on('caught', (_data, from) => {
      if (from === r.host) caught++
    }),
    r.on('round', (value, from) => {
      if (!r.isHost && Number.isInteger(value?.n) && (from === null || from === r.host)) round = { n: value.n, start: value.start, scores: value.scores ?? {} }
    }),
    r.on('kick', (_data, from) => {
      if (r.isHost && from) kick(from)
    }),
    r.on('host-change', () => {
      if (r.isHost) takeOver()
      describe()
    }),
    r.on('member-leave', (m) => {
      figures.delete(m.id)
      describe()
    }),
    ...['member-join', 'member-state', 'status'].map((event) => r.on(event, describe)),
  ]
  const kept = r.retained('round')
  if (Number.isInteger(kept?.n)) round = { n: kept.n, start: kept.start, scores: kept.scores ?? {} }
  if (r.isHost) takeOver()
  describe()
}

p3p2.on('room', enter)
p3p2.on('leave', () => {
  for (const stop of off) stop()
  off = []
  room = null
  alone()
})

/** Alone, the page is its own host: the same bots and ball, with nobody to tell. */
function alone() {
  bots = freshBots()
  round = { n: 1, start: Date.now(), scores: {} }
  describe()
}

let last = performance.now()
let reported = 0
let wrote = 0
// A timer, not animation frames: those stop in a tab that is not in front, and the host has to go on.
setInterval(() => {
  const now = performance.now()
  const dt = Math.min(0.25, (now - last) / 1000)
  last = now
  const length = Math.hypot(input.x, input.y)
  if (length > 0) {
    const scale = Math.min(1, length) / length
    me = { x: clamp(me.x + input.x * scale * SPEED * dt, 0, W), y: clamp(me.y + input.y * scale * SPEED * dt, 0, H) }
    // As often as it moves: the client sends at most 20 a second, and never the same twice.
    room?.presence.set({ x: Math.round(me.x), y: Math.round(me.y) })
  }
  const hosting = !room || room.isHost
  if (!hosting) return
  if (room && room.now() - round.start > ROUND_MS) {
    round = { n: round.n + 1, start: room.now(), scores: {} }
    saveRound()
  }
  runBots(dt)
  runBall(dt)
  if (room && now - reported >= REPORT_MS) {
    reported = now
    report()
  }
  if (room && now - wrote >= SAVE_MS) {
    wrote = now
    saveRound()
  }
}, 1000 / 60)

// ---- keys, the thumb stick, and what the page says ----

const KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1] }
const held = new Set()
const fromKeys = () => {
  input.x = 0
  input.y = 0
  for (const key of held) {
    input.x += KEYS[key][0]
    input.y += KEYS[key][1]
  }
}
addEventListener('keydown', (e) => {
  if (P3P2.isTyping || e.target instanceof HTMLInputElement) return
  if (KEYS[e.key]) held.add(e.key)
  else if (e.key === ' ') doKick()
  else return
  fromKeys()
  e.preventDefault()
})
addEventListener('keyup', (e) => {
  if (held.delete(e.key)) fromKeys()
})

/** Space, or a tap: the host kicks the ball itself, a guest asks the host to. */
function doKick() {
  if (!room || room.isHost) kick(room?.self ?? null)
  else room.send('kick', null, { to: 'host' })
}

// The stick: a thumb put down on the left half pushes the figure the way it moves; a tap on the right half kicks.
let stick = null
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault()
  const box = canvas.getBoundingClientRect()
  for (const t of e.changedTouches) {
    if (t.clientX - box.left < box.width / 2 && !stick) stick = { id: t.identifier, x: t.clientX, y: t.clientY }
    else doKick()
  }
}, { passive: false })
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault()
  for (const t of e.changedTouches) {
    if (t.identifier !== stick?.id) continue
    input.x = clamp((t.clientX - stick.x) / 50, -1, 1)
    input.y = clamp((t.clientY - stick.y) / 50, -1, 1)
  }
}, { passive: false })
canvas.addEventListener('touchend', (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier !== stick?.id) continue
    stick = null
    input.x = 0
    input.y = 0
  }
})
// Quick touches on the page are cancelled, so that a double tap does not zoom. Never those on the panel: a cancelled
// touch makes no click, and its buttons would go dead under a finger.
document.addEventListener('touchend', (e) => {
  if (e.target instanceof Element && e.target.localName === 'p3p2-panel') return
  if (e.cancelable) e.preventDefault()
}, { passive: false })

function describe() {
  if (!room) {
    $('state').textContent = 'Playing alone against the bots. Open 👥 to play with friends.'
    $('who').textContent = ''
    return
  }
  const role = room.isHost ? 'the host' : `hosted by ${room.host?.name ?? 'nobody'}`
  $('state').textContent = `In "${room.name}" as ${room.self.name} (${role}), ${room.members.length} here. Round ${round.n}.`
  const states = { here: 'here', away: 'in the background', lost: 'not heard from' }
  $('who').textContent = room.members.map((m) => `${m.name}: ${states[m.state]}, caught ${round.scores[m.pid] ?? 0}`).join(' · ')
}

requestAnimationFrame(function draw() {
  requestAnimationFrame(draw)
  const now = performance.now()
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0)
  ctx.fillStyle = '#26332a'
  ctx.fillRect(0, 0, W, H)
  const dot = (x, y, r, color) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  // Out of the host's sight: what this player cannot see is not drawn.
  ctx.strokeStyle = '#ffffff22'
  ctx.beginPath()
  ctx.arc(me.x, me.y, SIGHT, 0, Math.PI * 2)
  ctx.stroke()
  if (!room || room.isHost) {
    for (const b of bots) dot(b.x, b.y, 14, '#e05a47')
    dot(ball.x, ball.y, 9, '#f2f2f2')
  } else {
    for (const key of got.things) {
      const at = seen.get(key, now)
      if (at) dot(at[0], at[1], key === 'ball' ? 9 : 14, key === 'ball' ? '#f2f2f2' : '#e05a47')
    }
  }
  for (const m of room?.members ?? []) {
    const at = m !== room.self && figures.get(m.id, now)
    if (at) dot(at[0], at[1], 12, `hsl(${parseInt(m.pid.slice(0, 6), 16) % 360} 70% 60%)`)
  }
  dot(me.x, me.y, 12, '#ffd23f')
  if (stick) {
    const box = canvas.getBoundingClientRect()
    dot(((stick.x - box.left) / box.width) * W, ((stick.y - box.top) / box.height) * H, 40, '#ffffff33')
  }
})

// ---- for the browser tests, and for a look from the console ----

window.example = {
  get me() {
    return { x: me.x, y: me.y }
  },
  get host() {
    return !room || room.isHost
  },
  get inRoom() {
    return room !== null && room.status === 'open'
  },
  get round() {
    return round
  },
  get caught() {
    return caught
  },
  /** The bots and the ball where this page draws them: the host's own, or what its reports showed. */
  get seen() {
    const now = performance.now()
    if (!room || room.isHost) return Object.fromEntries([...bots.map((b) => [`b${b.id}`, [b.x, b.y]]), ['ball', [ball.x, ball.y]]])
    return Object.fromEntries(got.things.flatMap((key) => (seen.get(key, now) ? [[key, seen.get(key, now)]] : [])))
  },
  /** The others' figures, where this page draws them, by name. */
  others() {
    const now = performance.now()
    return Object.fromEntries((room?.members ?? []).flatMap((m) => (m === room.self || !figures.get(m.id, now) ? [] : [[m.name, figures.get(m.id, now)]])))
  },
  get targets() {
    return targets
  },
  get told() {
    return told
  },
  get got() {
    return got
  },
  /** Pushes the figure, as held keys or the stick do: -1 to 1 each way. */
  push(x, y) {
    input.x = x
    input.y = y
  },
  /** Puts the figure somewhere: a test cannot steer it there in time. */
  goTo(x, y) {
    me = { x, y }
    room?.presence.set({ x: Math.round(x), y: Math.round(y) })
  },
  kick: doKick,
  /** Where this page draws another's figure at each animation frame, for `ms`: [time, x, y]. */
  track(name, ms) {
    return new Promise((resolve) => {
      const out = []
      const end = performance.now() + ms
      requestAnimationFrame(function frame(now) {
        const m = room?.members.find((x) => x.name === name)
        const at = m && figures.get(m.id, now)
        if (at) out.push([now, at[0], at[1]])
        if (now < end) requestAnimationFrame(frame)
        else resolve(out)
      })
    })
  },
}

alone()
// After a reload: back into the room. From an invite link: asks, then joins.
await p3p2.start()
