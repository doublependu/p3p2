// The rally example's game. One ball between two paddles, and every page draws it from the same flight: where and
// when it left, on the room's clock, and how fast. The page of the player the ball is heading to decides whether
// it was returned, and sends the next flight, from where and when the ball met the paddle. There is no host.
//
// The page has a menu of its own (`ui: false`): it hosts, asks "Join?", lists the players, and says what went
// wrong, in its own words, through the client's API alone. The client's panel is never loaded.

import { P3P2 } from '@p3p2/client'
import { Smooth } from '@p3p2/client/smooth'

/** The court, in its own units. */
const W = 800
const H = 500
const R = 8
const PADDLE = 90
/** Where the ball meets each side's paddle. */
const FACE = [32, W - 32]
/** Units a second: a paddle, and a ball as it is served. A ball returned goes a little faster each time. */
const PADDLE_SPEED = 900
const SERVE_SPEED = 380
const MAX_SPEED = 1100
/** Between a point and the next serve, ms. */
const PAUSE = 1000

const $ = (id) => document.getElementById(id)
const canvas = $('court')
const ctx = canvas.getContext('2d')
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

const p3p2 = new P3P2({ game: { id: 'rally-example', version: BUILD_ID }, ui: false })
window.p3p2 = p3p2

let room = null
let off = []
/** The ball's flight: { id, t0, x0, y0, vx, vy, to: the side it is heading to, score }. */
let flight = null
/** Who plays each side, by player id, as the room keeps it. */
let sides = [null, null]
/** This page's paddle, and where the pointer, a finger or the keys want it. Alone, the computer's too. */
let paddle = H / 2
let goal = H / 2
let computer = H / 2
let following = false
/** The other side's paddle, drawn a little in the past. */
const theirs = new Smooth({ jump: H })
/** The last flight this page decided; and, for the flights another page decided, how late each came, and how far the ball jumped. */
let decided = 0
const delays = []
const jumps = []

/** The room's clock: the same on every page. Alone, this one's. */
const clock = () => (room ? room.now() : Date.now())

/** Where a flight has the ball at time t: across in a straight line, bouncing off the long sides. */
function ballAt(f, t) {
  const s = (t - f.t0) / 1000
  const span = H - 2 * R
  let u = (f.y0 - R + f.vy * s) % (2 * span)
  if (u < 0) u += 2 * span
  return [f.x0 + f.vx * s, R + (u <= span ? u : 2 * span - u)]
}

/** When a flight reaches the paddle it is heading to, on the room's clock. */
const arrival = (f) => f.t0 + ((FACE[f.to] - f.x0) / f.vx) * 1000

const isFlight = (f) =>
  Number.isInteger(f?.id) && [f.t0, f.x0, f.y0, f.vx, f.vy].every(Number.isFinite) && f.vx !== 0 && (f.to === 0 || f.to === 1) && Array.isArray(f.score)

function serve(id, to, at, score) {
  return { id, t0: at, x0: W / 2, y0: H / 2, vx: to ? SERVE_SPEED : -SERVE_SPEED, vy: (Math.random() * 2 - 1) * 200, to, score }
}

function publish(f) {
  flight = f
  room?.send('flight', f, { retain: 'room' })
}

const mySide = () => (room ? sides.indexOf(room.self.pid) : 0)
const present = (pid) => room?.members.some((m) => m.pid === pid)

/** Does this page decide for a side? Its own; alone, the computer's too; and an empty side's, from the other. */
function decidesFor(side) {
  if (!room) return true
  if (sides[side] === room.self.pid) return true
  return !present(sides[side]) && sides[1 - side] === room.self.pid
}

/** At the paddle: returned, from where it met it, or a point for the other side and a new serve. */
function decide() {
  const f = flight
  if (!f || decided >= f.id || !decidesFor(f.to)) return
  const t = arrival(f)
  if (clock() < t) return
  decided = f.id
  const y = ballAt(f, t)[1]
  const at = !room && f.to === 1 ? computer : f.to === mySide() ? paddle : null
  if (at !== null && Math.abs(y - at) <= PADDLE / 2 + R) {
    const speed = Math.min(MAX_SPEED, Math.abs(f.vx) * 1.05)
    publish({ id: f.id + 1, t0: t, x0: FACE[f.to], y0: y, vx: f.to ? -speed : speed, vy: ((y - at) / (PADDLE / 2)) * 300, to: 1 - f.to, score: f.score })
  } else {
    const score = [...f.score]
    score[1 - f.to]++
    publish(serve(f.id + 1, f.to, t + PAUSE, score))
  }
}

// ---- in a room ----

/** Takes a side: the first two to press Play have them. */
async function play() {
  if (!room || mySide() !== -1) return
  for (const side of [0, 1]) {
    if (sides[side] && sides[side] !== room.self.pid) continue
    if ((await room.offer(`side:${side}`, room.self.pid)) === room.self.pid) return
  }
}

/** With both sides taken and no ball yet, side 1 serves: once, whoever presses first. */
function maybeServe() {
  if (room && !flight && sides.every(Boolean) && mySide() === 0) void room.offer('flight', serve(1, 1, room.now() + PAUSE, [0, 0]))
}

/**
 * The ball and the sides as the room keeps them: on coming in, and after a gap, when flights may have been missed.
 * A flight this page decided while the connection was down never left it (a saved value is not kept back to be sent
 * later, as an op is), and the other page would wait for it for ever: it goes now.
 */
function catchUp(r) {
  const kept = r.retained('flight')
  if (isFlight(kept) && kept.id >= (flight?.id ?? 0)) flight = kept
  else if (flight && decided === flight.id - 1) r.send('flight', flight, { retain: 'room' })
  sides = [r.retained('side:0') ?? null, r.retained('side:1') ?? null]
}

function enter(r) {
  for (const stop of off) stop()
  room = r
  theirs.clear()
  flight = null
  decided = 0
  catchUp(r)
  const see = (m, p, at) => {
    if ((p?.side === 0 || p?.side === 1) && Number.isFinite(p.y) && sides[p.side] === m.pid && m !== r.self) theirs.set(p.side, [p.y], at)
  }
  for (const m of r.members) see(m, r.presence.get(m), r.presence.at(m))
  off = [
    r.presence.on(see),
    r.on('flight', (f, from) => {
      if (!isFlight(f) || f.id <= (flight?.id ?? 0)) return
      if (from && from !== r.self) {
        // What this page saw of somebody else's decision: how long after the ball met the paddle it heard, and how
        // far the ball it drew meanwhile was from where it really went.
        const now = r.now()
        delays.push(Math.round(now - f.t0))
        if (flight) {
          const [a, b] = [ballAt(flight, now), ballAt(f, now)]
          jumps.push(Math.round(Math.hypot(a[0] - b[0], a[1] - b[1])))
        }
      }
      flight = f
    }),
    ...[0, 1].map((side) =>
      r.on(`side:${side}`, (pid) => {
        sides[side] = typeof pid === 'string' ? pid : null
        maybeServe()
        menu()
      }),
    ),
    r.on('status', (status) => {
      if (status === 'open') catchUp(r)
    }),
    r.on('close', (reason) => {
      // Why the room closed for this player, in this game's words.
      const why = {
        left: 'You left the game.',
        kicked: 'The host took you out of the game.',
        ended: 'The host ended the game for everybody.',
        replaced: 'This game is open in another tab now.',
        lost: 'The connection to the game was lost, and did not come back.',
      }
      $('problem').textContent = why[reason] ?? ''
    }),
    ...['member-join', 'member-leave', 'host-change', 'latency', 'status'].map((event) => r.on(event, menu)),
  ]
  maybeServe()
  menu()
}

p3p2.on('room', enter)
p3p2.on('leave', () => {
  for (const stop of off) stop()
  off = []
  room = null
  flight = null
  sides = [null, null]
  decided = 0
  menu()
})

// ---- the menu ----

/** Every P3P2Error code, in this game's words. */
const WORDS = {
  unreachable: 'No answer from that server. Is it running, and is the address right?',
  mixed: 'This game is on https, and that server is on plain http: the browser will not let the two talk.',
  origin: 'That room is not set up for this site.',
  'room-url': "That is not a room URL. Copy it whole from the server's portal.",
  room: 'There is no such room on that server.',
  auth: 'That invite has run out, or was replaced by a new one.',
  full: 'That game is full.',
  rate: 'Too many tries from here just now. Wait a little, and try again.',
  proto: 'That server is too old for this game. Its owner has to update it.',
  player: "That server knows this browser's player by another key.",
  version: 'The others play another version of this game. Reload the page.',
  game: 'That room is for another game.',
}
const say = (err) => {
  $('problem').textContent = err ? (WORDS[err.code] ?? `Something went wrong (${err.code ?? err.message}).`) : ''
}

const name = () => $('name').value.trim()
try {
  $('name').value = localStorage.getItem('rally-example:name') ?? ''
} catch {
  // A name for this visit.
}
$('name').onchange = () => {
  try {
    localStorage.setItem('rally-example:name', name())
  } catch {
    // Not kept.
  }
}

$('host').onclick = async () => {
  say(null)
  try {
    await p3p2.host($('room-url').value, { name: name() })
  } catch (err) {
    say(err)
  }
}

let invite = null
/** A page opened from an invite: who is behind it, before the player says yes. */
async function ask(found) {
  invite = found
  $('asking').hidden = false
  $('hosting').hidden = true
  $('ask').textContent = 'Looking up the invite…'
  try {
    const d = await p3p2.peek(found)
    const who = d.hostName ? `hosted by ${d.hostName}` : 'nobody there yet'
    $('ask').textContent = `Join "${d.roomName}", ${who}, ${d.members} of ${d.maxMembers} players?`
  } catch (err) {
    $('ask').textContent = `You were invited to a game on ${new URL(found.server).host}.`
    say(err)
  }
}
$('join').onclick = async () => {
  say(null)
  try {
    await p3p2.join(invite, { name: name() })
  } catch (err) {
    say(err)
  }
}
$('alone').onclick = () => {
  const url = new URL(location.href)
  url.searchParams.delete('room')
  history.replaceState(history.state, '', url)
  invite = null
  say(null)
  menu()
}
$('copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('invite').value)
    $('copy').textContent = 'Copied'
  } catch {
    $('invite').select()
  }
}
$('play').onclick = () => void play()
$('leave').onclick = () => room?.leave()
$('end').onclick = () => room?.end()

function menu() {
  $('inroom').hidden = !room
  $('asking').hidden = !!room || !invite
  $('hosting').hidden = !!room || !!invite
  if (!room) {
    $('state').textContent = 'Playing alone against the computer. Host a game, or open an invite, to play somebody.'
    return
  }
  $('where').textContent = `In "${room.name}" on ${new URL(room.server).host}${room.status === 'reconnecting' ? ', reconnecting…' : ''}.`
  $('invite-row').hidden = !room.inviteUrl
  $('invite').value = room.inviteUrl ?? ''
  $('end').hidden = !room.isMod
  $('play').hidden = mySide() !== -1 || sides.every((pid) => pid && present(pid))
  $('members').replaceChildren(
    ...room.members.map((m) => {
      const li = document.createElement('li')
      const side = sides.indexOf(m.pid)
      const text = document.createElement('span')
      text.textContent = `${m.name}${m === room.self ? ' (you)' : ''}${side === -1 ? ', watching' : `, side ${side + 1}`} · ${m.rtt === null ? '…' : `${m.rtt} ms`}`
      li.append(text)
      if (room.isMod && m !== room.self) {
        const remove = document.createElement('button')
        remove.type = 'button'
        remove.textContent = `Remove ${m.name}`
        remove.onclick = () => room.kick(m.id)
        li.append(remove)
      }
      return li
    }),
  )
  const mine = mySide()
  $('state').textContent = mine === -1 ? 'Watching.' : `Playing side ${mine + 1}.`
}

// ---- the paddle: the pointer, a finger, or the keys ----

function setPaddle(y) {
  goal = clamp(y, PADDLE / 2, H - PADDLE / 2)
}
const pointer = (e) => {
  const box = canvas.getBoundingClientRect()
  setPaddle(((e.clientY - box.top) / box.height) * H)
}
canvas.addEventListener('pointermove', pointer)
canvas.addEventListener('pointerdown', pointer)
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return
  if (e.key === 'ArrowUp') setPaddle(goal - 40)
  else if (e.key === 'ArrowDown') setPaddle(goal + 40)
  else return
  e.preventDefault()
})

let last = performance.now()
setInterval(() => {
  const now = performance.now()
  const step = PADDLE_SPEED * Math.min(0.25, (now - last) / 1000)
  last = now
  if (!flight && !room) flight = serve(1, 1, Date.now() + PAUSE, [0, 0])
  if (following && flight) setPaddle(ballAt(flight, clock())[1])
  const before = paddle
  paddle += clamp(goal - paddle, -step, step)
  const side = mySide()
  if (room && side !== -1 && Math.round(paddle) !== Math.round(before)) room.presence.set({ side, y: Math.round(paddle) })
  if (!room && flight) computer += clamp(ballAt(flight, Date.now())[1] - computer, -step * 0.5, step * 0.5)
  decide()
}, 1000 / 60)

requestAnimationFrame(function draw() {
  requestAnimationFrame(draw)
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0)
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#ffffff22'
  ctx.fillRect(W / 2 - 1, 0, 2, H)
  const mine = mySide()
  const yOf = (side) => (side === mine ? paddle : !room ? computer : theirs.get(side)?.[0] ?? null)
  ctx.fillStyle = '#e8e2d0'
  for (const side of [0, 1]) {
    const y = yOf(side)
    if (y !== null) ctx.fillRect(FACE[side] + (side ? R : -R - 8), y - PADDLE / 2, 8, PADDLE)
  }
  if (flight) {
    const [x, y] = ballAt(flight, clock())
    ctx.beginPath()
    ctx.arc(x, y, R, 0, Math.PI * 2)
    ctx.fill()
    ctx.font = '32px system-ui'
    ctx.textAlign = 'center'
    ctx.fillText(`${flight.score[0]}   ${flight.score[1]}`, W / 2, 44)
  }
})

// ---- for the browser tests, and for a look from the console ----

window.example = {
  get inRoom() {
    return room !== null && room.status === 'open'
  },
  get side() {
    return mySide()
  },
  get sides() {
    return sides
  },
  get flight() {
    return flight
  },
  get ball() {
    return flight && ballAt(flight, clock())
  },
  /** Where this page has the ball at `t` on this machine's clock (`Date.now()`): for pages asked one after another. */
  ballAtTime(t) {
    return flight && ballAt(flight, t + clock() - Date.now())
  },
  get score() {
    return flight?.score ?? [0, 0]
  },
  get paddle() {
    return paddle
  },
  /** The other side's paddle, where this page draws it. */
  get theirs() {
    return theirs.get(1 - mySide())?.[0] ?? null
  },
  get delays() {
    return delays
  },
  get jumps() {
    return jumps
  },
  /** How far the room's clock is from this page's own. */
  get offset() {
    return clock() - Date.now()
  },
  /** Moves the paddle toward a height, as the pointer does. */
  setPaddle,
  /** The paddle follows the ball, as a player who never misses: for a test. */
  follow(on = true) {
    following = on
  },
  play,
}

menu()
// After a reload: back into the room this tab was in, without asking. From an invite: "Join?", in the menu.
const back = await p3p2.resume()
if (!back && p3p2.invite) await ask(p3p2.invite)
