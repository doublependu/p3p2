// The world example's game, shared by its two pages: the yard (index.html) and the cellar (cellar.html). One room
// holds both. Each page draws its own part, and keeps all of the world: the log and its snapshots are the room's,
// and the host, who is asked for the snapshots, may be in either part.

import { P3P2 } from '@p3p2/client'
import { pack, unpack } from '@p3p2/client/pack'
import { Smooth } from '@p3p2/client/smooth'

/** The two parts of the world, each raised from the room's seed with a salt of its own. */
const PARTS = {
  yard: { w: 512, h: 256, stones: 40, salt: 0x9e3779b9, other: 'cellar', page: './' },
  cellar: { w: 24, h: 16, stones: 8, salt: 0x85ebca6b, other: 'yard', page: 'cellar.html' },
}
const GRASS = 0
const WATER = 1
const TREE = 2
/** The walls a player builds. */
const WOOD = 1
const STONE = 2
/** A part keeps at most this many walls: the newest. */
const MAX_WALLS = 100_000
/** Pixels a tile. */
const TILE = 16
/** How often a page writes down where its player stands, while the player walks. */
const STAND_MS = 3000
/** How often the cellar's thing moves. */
const THING_MS = 250

/**
 * A seeded generator of whole numbers below `n` (xorshift32). Integers only: every engine draws the same numbers
 * from the same seed, which Math.sin, Math.random or floating-point sums do not promise.
 */
function generator(seed) {
  let s = seed >>> 0 || 1
  return (n) => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s % n
  }
}

/** One part of the world, raised from a seed: its tiles, its stones, its door and the place where newcomers stand. */
function raise(seed, part) {
  const { w, h, stones, salt } = PARTS[part]
  const draw = generator((seed ^ salt) >>> 0)
  const tiles = new Uint8Array(w * h)
  for (let i = 0; i < tiles.length; i++) {
    const x = i % w
    const y = (i / w) | 0
    // A draw for every tile, the edge's too: the number of draws never depends on what was drawn.
    const n = draw(100)
    tiles[i] = x === 0 || y === 0 || x === w - 1 || y === h - 1 || n < 7 ? TREE : n < 12 ? WATER : GRASS
  }
  // The stones, the door and the way in go on open ground, shuffled with one draw for each place (Fisher–Yates).
  // Never `sort` with a seeded comparison: engines sort in different ways and ask the comparison a different number
  // of times, and two browsers then raise two different worlds from one seed.
  const open = []
  for (let i = 0; i < tiles.length; i++) if (tiles[i] === GRASS) open.push(i)
  for (let i = open.length - 1; i > 0; i--) {
    const j = draw(i + 1)
    ;[open[i], open[j]] = [open[j], open[i]]
  }
  return { part, w, h, tiles, stones: open.slice(0, stones), door: open[stones], entry: open[stones + 1] }
}

/** A short fingerprint of a part as it was raised, the same on every page that raised the same part. */
function fingerprint(land) {
  let h = 0x811c9dc5
  const add = (n) => {
    h = Math.imul(h ^ (n & 0xff), 16777619)
    h = Math.imul(h ^ ((n >>> 8) & 0xff), 16777619)
    h = Math.imul(h ^ (n >>> 16), 16777619)
  }
  for (const t of land.tiles) h = Math.imul(h ^ t, 16777619)
  for (const n of [...land.stones, land.door, land.entry]) add(n)
  return (h >>> 0).toString(16).padStart(8, '0')
}

const walkable = (land, at) => land.tiles[at] === GRASS
/** A wall goes on open ground that is not a stone, the door, or the way in. */
const buildable = (land, at) => walkable(land, at) && at !== land.door && at !== land.entry && !land.stones.includes(at)

// ---- what the room's log adds up to ----

/** For each part: the stones taken, and by whom; and the walls, oldest first, by place. */
const fresh = () => ({ yard: { taken: new Map(), walls: new Map() }, cellar: { taken: new Map(), walls: new Map() } })

/**
 * One op, from player `pid`. The only place the world changes: every page is handed the same ops in the same order,
 * so every page has the same world. An op that does not apply changes nothing, on any page.
 */
function apply(state, lands, op, pid) {
  const part = state[op?.part]
  const land = lands[op?.part]
  if (!part || !land) return
  if (Number.isInteger(op.take)) {
    // The first to reach a stone has it. The second op for it changes nothing, on every page.
    if (op.take >= 0 && op.take < land.stones.length && !part.taken.has(op.take)) part.taken.set(op.take, pid)
  } else if (Array.isArray(op.build)) {
    // Many walls in one op: one message, and one entry of the log.
    for (const wall of op.build) {
      const [x, y, kind] = Array.isArray(wall) ? wall : []
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= land.w || y >= land.h) continue
      const at = y * land.w + x
      if (!buildable(land, at)) continue
      // A wall built again is the newest again; kind 0 takes it down.
      part.walls.delete(at)
      if (kind === WOOD || kind === STONE) part.walls.set(at, kind)
    }
    keepNewest(part, MAX_WALLS)
  } else if (Number.isInteger(op.keep) && op.keep >= 0) {
    // The host made a snapshot that holds only so many walls, the newest: every page keeps as many.
    keepNewest(part, op.keep)
  }
}

/** Takes down the oldest walls of a part until `n` are left. Twice is the same as once. */
function keepNewest(part, n) {
  for (const at of part.walls.keys()) {
    if (part.walls.size <= n) break
    part.walls.delete(at)
  }
}

/** The world as it is now, copied: what a snapshot holds, whatever happens while it is packed. */
const freeze = (state) => Object.fromEntries(Object.entries(state).map(([name, part]) => [name, { taken: [...part.taken], walls: [...part.walls] }]))

/**
 * The world as a snapshot holds it, with only the newest `keep[part]` walls of a part where that is given. Each wall
 * is one number, its place and its kind, and each after the first is the step from the one before: walls laid in a
 * row are then the same small step over and over, which packs to almost nothing.
 */
function serialize(frozen, keep = {}) {
  const out = { v: 1 }
  for (const [name, part] of Object.entries(frozen)) {
    const walls = []
    let last = 0
    for (const [at, kind] of part.walls.slice(Math.max(0, part.walls.length - (keep[name] ?? part.walls.length)))) {
      const n = at * 4 + kind
      walls.push(n - last)
      last = n
    }
    out[name] = { taken: part.taken, walls }
  }
  return out
}

/** A snapshot, back into a world. What came from a server is checked first. */
function restore(saved) {
  const state = fresh()
  if (saved?.v !== 1) return state
  for (const [name, part] of Object.entries(state)) {
    const from = saved[name]
    for (const pair of Array.isArray(from?.taken) ? from.taken : []) {
      if (Array.isArray(pair) && Number.isInteger(pair[0]) && typeof pair[1] === 'string') part.taken.set(pair[0], pair[1])
    }
    let n = 0
    for (const step of Array.isArray(from?.walls) ? from.walls : []) {
      if (!Number.isInteger(step)) break
      n += step
      part.walls.set(n >> 2, n & 3)
    }
  }
  return state
}

/** Of the walls of a part, in order: for a test, or for two players who want to know they see the same. */
function wallsPrint(part) {
  let h = 0x811c9dc5
  for (const [at, kind] of part.walls) h = Math.imul(h ^ (at * 4 + kind), 16777619)
  return `${part.walls.size}:${(h >>> 0).toString(16)}`
}

// ---- the page ----

/** Plays the part of the world this page shows: 'yard' or 'cellar'. */
export async function play(here) {
  const $ = (id) => document.getElementById(id)
  const canvas = $('view')
  const ctx = canvas.getContext('2d')

  // This browser's own world, for playing alone: a seed of its own, kept here.
  let ownSeed = 0
  try {
    ownSeed = Number(localStorage.getItem('world-example:seed'))
  } catch {
    // Storage is blocked: a new world each visit.
  }
  if (!Number.isInteger(ownSeed) || ownSeed <= 0) {
    ownSeed = crypto.getRandomValues(new Uint32Array(1))[0] || 1
    try {
      localStorage.setItem('world-example:seed', String(ownSeed))
    } catch {
      // Kept for this visit only.
    }
  }

  let seed = 0
  let lands = null
  let land = null
  let state = fresh()
  /** The room, or null when playing alone. */
  let room = null
  let off = []
  let me = { x: 0, y: 0 }
  let facing = [1, 0]
  /** This player has moved since where they stand was last written down. */
  let moved = false
  /** How much of the world came with the snapshot this page started from, and how large the last snapshot was. */
  let loaded = 0
  let saved = null
  let closed = null
  /** The room's world is raised, its log read, and this player placed in it. */
  let entered = false
  // The others in this part, drawn a little in the past. A step of more than three tiles is a jump: they came in.
  const friends = new Smooth({ jump: 3 })
  // The cellar's thing, as this page draws it, and whether this page is the one that moves it.
  const things = new Smooth({ jump: 3 })
  let thing = null
  let moving = false

  function raiseAll(s) {
    seed = s
    lands = { yard: raise(s, 'yard'), cellar: raise(s, 'cellar') }
    land = lands[here]
  }

  /** Puts this player on a tile: the end of every step, and of a test's shortcut. Takes a stone, or the door. */
  function arrive(x, y) {
    const at = y * land.w + x
    if (x < 0 || y < 0 || x >= land.w || y >= land.h || !walkable(land, at) || state[here].walls.has(at)) return false
    if (at === land.door) {
      // Through the door: the other page, back in the same room as the same member, without a question. Where this
      // player stood here is the tile before the door.
      keepWhere(true)
      try {
        sessionStorage.setItem('world-example:door', '1')
      } catch {
        // They come in at the other part's way in instead.
      }
      location.href = new URL(PARTS[PARTS[here].other].page, location.href).href
      return true
    }
    me = { x, y }
    moved = true
    const stone = land.stones.indexOf(at)
    if (stone !== -1 && !state[here].taken.has(stone)) submit({ part: here, take: stone })
    room?.presence.set({ part: here, x, y })
    describe()
    return true
  }

  function step(dx, dy) {
    facing = [dx, dy]
    return arrive(me.x + dx, me.y + dy)
  }

  /** A change to the world: through the log in a room, at once when alone. */
  function submit(op) {
    if (room) return room.log.submit(op)
    apply(state, lands, op, 'alone')
    describe()
    return true
  }

  /** Enter: a wall on the tile in front, or that wall taken down. */
  function buildInFront() {
    const x = me.x + facing[0]
    const y = me.y + facing[1]
    const kind = state[here].walls.has(y * land.w + x) ? 0 : WOOD
    submit({ part: here, build: [[x, y, kind]] })
  }

  /** Writes down where this player stands, for the next visit: a value of the player's own, which the room keeps. */
  function keepWhere(always = false) {
    if (!room || (!moved && !always)) return
    // While the connection is coming back nothing is sent: then it goes at the next try.
    if (room.send(`stand:${here}`, [me.x, me.y], { retain: 'player' })) moved = false
  }

  /** Whether this page was opened by walking through the door of the other part. Asked once. */
  function cameThroughDoor() {
    try {
      const door = sessionStorage.getItem('world-example:door') === '1'
      sessionStorage.removeItem('world-example:door')
      return door
    } catch {
      return false
    }
  }

  /** Where a newcomer to this part stands: beside the door if they came through it, else at the way in. */
  function startingPlace(door) {
    if (door) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = (land.door % land.w) + dx
        const y = ((land.door / land.w) | 0) + dy
        if (walkable(land, y * land.w + x)) return { x, y }
      }
    }
    return { x: land.entry % land.w, y: (land.entry / land.w) | 0 }
  }

  // ---- alone ----

  function alone() {
    room = null
    raiseAll(ownSeed)
    state = fresh()
    me = startingPlace(cameThroughDoor())
    friends.clear()
    describe()
  }

  // ---- in a room ----

  /** What the room's log takes for a snapshot: at most a frame, and at most half the log, so ops fit after it. */
  const budget = () => Math.min(room.limits.maxFrameBytes, room.limits.maxLogBytes / 2) - 1024

  async function enter(r) {
    for (const stop of off) stop()
    off = []
    room = r
    closed = null
    entered = false
    // Whoever comes first decides the world: this page's seed, unless the room has one. Then the room's is raised,
    // whichever it is, and before anything else is drawn of it.
    const world = await r.offer('world', { seed: ownSeed, at: r.now() })
    if (room !== r) return
    raiseAll(Number.isInteger(world?.seed) && world.seed > 0 ? world.seed : ownSeed)
    state = fresh()
    loaded = 0
    await r.log.open({
      load: async (snapshot) => {
        state = snapshot === undefined ? fresh() : restore(await unpack(snapshot))
        loaded = state.yard.walls.size + state.cellar.walls.size + state.yard.taken.size + state.cellar.taken.size
        describe()
      },
      apply: (op, entry) => {
        apply(state, lands, op, entry.pid)
        describe()
      },
      // On the host, when the server asks.
      save: async () => {
        // Copied now: ops that arrive while it is packed are not part of it.
        const frozen = freeze(state)
        let packed = await pack(serialize(frozen))
        const walls = (keep) => Object.entries(frozen).reduce((n, [name, part]) => n + Math.min(part.walls.length, keep[name] ?? Infinity), 0)
        saved = { json: JSON.stringify(serialize(frozen)).length, packed: packed.length, walls: walls({}) }
        if (packed.length <= budget()) return packed
        // Too large for this room: the newest walls that fit, found by packing fewer. The snapshot holds those, and
        // once it is sent, which frees the log, an op tells every page in the room to keep as many. Not the other
        // way round: an op sent first can find the log full, and then nothing can make room in it.
        const part = frozen.yard.walls.length >= frozen.cellar.walls.length ? 'yard' : 'cellar'
        const keep = { [part]: frozen[part].walls.length }
        while (packed.length > budget() && keep[part] > 0) {
          keep[part] = Math.floor(keep[part] * Math.min(0.95, (budget() * 0.95) / packed.length))
          packed = await pack(serialize(frozen, keep))
        }
        saved = { ...saved, packed: packed.length, walls: walls(keep) }
        setTimeout(() => r.log.submit({ part, keep: keep[part] }))
        return packed
      },
    })
    if (room !== r) return
    // Beside the door for a player who came through it. Otherwise where this player stood in this part: the room
    // keeps that, next week too.
    const door = cameThroughDoor()
    const stood = r.retained(`stand:${here}`, { player: r.self.pid })
    const start = startingPlace(door)
    if (door || !(Array.isArray(stood) && arrive(stood[0], stood[1]))) arrive(start.x, start.y)
    moved = false

    friends.clear()
    const see = (m, p, at) => {
      if (p?.part === here && Number.isInteger(p.x) && Number.isInteger(p.y)) friends.set(m.id, [p.x, p.y], at)
      else friends.delete(m.id)
    }
    for (const m of r.members) if (m !== r.self) see(m, r.presence.get(m), r.presence.at(m))
    off = [
      r.presence.on((m, p, at) => {
        see(m, p, at)
        describe()
      }),
      r.on('member-leave', (m) => {
        friends.delete(m.id)
        describe()
      }),
      r.on('thing', (data) => {
        if (here === 'cellar' && !moving && Array.isArray(data) && data.length === 2 && data.every(Number.isInteger)) things.set(0, data)
      }),
      ...['member-join', 'member-state', 'host-change', 'status'].map((event) => r.on(event, describe)),
    ]
    entered = true
    describe()
  }

  /**
   * The cellar's thing is moved by one page: whoever has been in the room longest of those in the cellar and here.
   * When that page leaves the cellar, the next carries on from where it last drew the thing.
   */
  function mover() {
    if (!room) return true
    let first = null
    for (const m of room.members) {
      const inCellar = m === room.self ? here === 'cellar' : room.presence.get(m)?.part === 'cellar' && m.state === 'here'
      if (inCellar && (!first || m.order < first.order)) first = m
    }
    return first === room.self
  }

  setInterval(() => {
    if (here !== 'cellar' || !land) return
    moving = mover()
    if (!moving) return
    const drawn = things.get(0)
    thing = drawn ? drawn.map(Math.round) : [land.entry % land.w, (land.entry / land.w) | 0]
    const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(Math.random() * 4)]
    const next = [thing[0] + dx, thing[1] + dy]
    if (walkable(land, next[1] * land.w + next[0]) && next[1] * land.w + next[0] !== land.door) thing = next
    things.set(0, thing)
    room?.send('thing', thing, { volatile: true })
  }, THING_MS)

  setInterval(() => keepWhere(), STAND_MS)
  addEventListener('pagehide', () => keepWhere())
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) keepWhere()
  })

  // ---- keys, fingers, and what the page says ----

  const KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1] }
  addEventListener('keydown', (e) => {
    if (!land || e.ctrlKey || e.metaKey || e.altKey || e.target instanceof HTMLInputElement) return
    if (e.key === 'Enter') buildInFront()
    else if (KEYS[e.key]) step(...KEYS[e.key])
    else return
    e.preventDefault()
  })
  // A tap steps toward it.
  canvas.addEventListener('pointerdown', (e) => {
    const box = canvas.getBoundingClientRect()
    const dx = (e.clientX - box.left) / box.width - 0.5
    const dy = (e.clientY - box.top) / box.height - 0.5
    if (Math.abs(dx) > Math.abs(dy)) step(Math.sign(dx), 0)
    else step(0, Math.sign(dy))
  })

  function describe() {
    if (!land) return
    const taken = state[here].taken.size
    const where = here === 'yard' ? 'in the yard' : 'in the cellar'
    if (!room) $('state').textContent = `Playing alone, ${where} of a world of your own. Open the multiplayer panel to play it with friends.`
    else {
      const role = room.isHost ? 'the host' : `hosted by ${room.host?.name ?? 'nobody'}`
      $('state').textContent = `In "${room.name}" as ${room.self.name} (${role}), ${room.members.length} here, ${where}.`
    }
    $('count').textContent = `${taken} of ${land.stones.length} stones taken here, ${state[here].walls.size} walls built.`
    const part = (m) => (m === room?.self ? here : room?.presence.get(m)?.part)
    $('who').textContent = room ? room.members.map((m) => `${m.name}: ${part(m) ?? 'arriving'}`).join(' · ') : ''
  }

  const COLORS = { [GRASS]: '#7fb069', [WATER]: '#4f8fc0', [TREE]: '#2e5e3a' }
  requestAnimationFrame(function draw() {
    requestAnimationFrame(draw)
    if (!land) return
    const cols = canvas.width / TILE
    const rows = canvas.height / TILE
    const left = Math.max(0, Math.min(land.w - cols, me.x - (cols >> 1)))
    const top = Math.max(0, Math.min(land.h - rows, me.y - (rows >> 1)))
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const at = (top + y) * land.w + left + x
        const wall = state[here].walls.get(at)
        ctx.fillStyle = wall ? (wall === STONE ? '#8a8a8a' : '#a0703c') : at === land.door ? '#3a2a1a' : COLORS[land.tiles[at]]
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE)
      }
    }
    const dot = (x, y, color, r = 0.35) => {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc((x - left + 0.5) * TILE, (y - top + 0.5) * TILE, TILE * r, 0, Math.PI * 2)
      ctx.fill()
    }
    for (const [i, at] of land.stones.entries()) if (!state[here].taken.has(i)) dot(at % land.w, (at / land.w) | 0, '#e8e2d0', 0.25)
    const now = performance.now()
    for (const m of room?.members ?? []) {
      const at = m !== room.self && friends.get(m.id, now)
      if (at) dot(at[0], at[1], `hsl(${parseInt(m.pid.slice(0, 6), 16) % 360} 70% 45%)`)
    }
    const t = here === 'cellar' && things.get(0, now)
    if (t) dot(t[0], t[1], '#c03030', 0.3)
    dot(me.x, me.y, '#ffd23f', 0.4)
  })

  // ---- for the browser tests, and for a look from the console ----

  window.example = {
    get part() {
      return here
    },
    get seed() {
      return seed
    },
    get inRoom() {
      return entered && room !== null && room.status === 'open'
    },
    get host() {
      return room?.isHost ?? true
    },
    /** Why the last room closed for this page, or null. */
    get closed() {
      return closed
    },
    /** Of this part as it was raised: tiles, stones, door and way in. */
    get fingerprint() {
      return land && fingerprint(land)
    },
    /** The same, for both parts. */
    get prints() {
      return lands && { yard: fingerprint(lands.yard), cellar: fingerprint(lands.cellar) }
    },
    /** This part's tiles, one by one: a digit each. */
    tiles() {
      return land.tiles.join('')
    },
    get stones() {
      return land.stones
    },
    /** Each part's taken stones, [stone, player id], in stone order. */
    get taken() {
      return Object.fromEntries(Object.entries(state).map(([name, part]) => [name, [...part.taken].sort((a, b) => a[0] - b[0])]))
    },
    /** Each part's walls: how many, and a print of them in order. */
    get walls() {
      return Object.fromEntries(Object.entries(state).map(([name, part]) => [name, wallsPrint(part)]))
    },
    get wallCount() {
      return state.yard.walls.size + state.cellar.walls.size
    },
    get seq() {
      return room?.log.seq ?? 0
    },
    get loaded() {
      return loaded
    },
    /** The last snapshot this page made: its size as JSON and packed, and the walls it held. */
    get saved() {
      return saved
    },
    get where() {
      return { ...me }
    },
    /** The others in this part, where this page draws them. */
    others() {
      const now = performance.now()
      return (room?.members ?? []).flatMap((m) => {
        const at = m !== room.self && friends.get(m.id, now)
        return at ? [{ name: m.name, pid: m.pid, x: at[0], y: at[1] }] : []
      })
    },
    get thing() {
      return here === 'cellar' ? things.get(0, performance.now()) : null
    },
    get moving() {
      return moving
    },
    /** A step, as an arrow key takes it. */
    step,
    /** Puts the player on a tile, as walking there would: a test cannot find its way through the world. */
    goTo: arrive,
    standOn: (stone) => arrive(land.stones[stone] % land.w, (land.stones[stone] / land.w) | 0),
    toDoor: () => arrive(land.door % land.w, (land.door / land.w) | 0),
    /** Builds walls, [x, y, kind] each, as Enter does, many in each op: as many ops as fit in the server's frames. */
    build(walls) {
      const each = room ? Math.max(1, Math.floor((room.limits.maxFrameBytes - 200) / 16)) : walls.length
      let sent = 0
      for (let i = 0; i < walls.length; i += each) if (submit({ part: here, build: walls.slice(i, i + each) })) sent++
      return sent
    },
    /** Open ground of this part that a wall may go on, in rows from the top, or scattered. */
    ground(scattered = false) {
      const out = []
      for (let at = 0; at < land.tiles.length; at++) if (buildable(land, at)) out.push([at % land.w, (at / land.w) | 0, WOOD])
      if (scattered) {
        for (let i = out.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[out[i], out[j]] = [out[j], out[i]]
        }
      }
      return out
    },
  }

  const p3p2 = new P3P2({
    game: { id: 'world-example', version: BUILD_ID },
    // Enter builds here, so T opens the chat.
    ui: { chatKey: 't' },
  })
  window.p3p2 = p3p2
  p3p2.on('room', (r) => void enter(r))
  p3p2.on('leave', (reason) => {
    for (const stop of off) stop()
    off = []
    closed = reason
    const why = {
      left: 'You left the room.',
      kicked: 'You were removed from the room.',
      ended: 'The room was ended for everyone.',
      replaced: 'This room is now open in another tab.',
      lost: 'The connection to the room was lost.',
    }
    $('note').textContent = why[reason] ?? ''
    alone()
  })
  // Before anything is raised from a seed: a reload comes back to the room, and an invite asks "Join?" first. Either
  // way the room may hold a world already, and that is the one to raise.
  if (!(await p3p2.start())) alone()
}
