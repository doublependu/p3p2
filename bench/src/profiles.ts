// The traffic profiles, each shaped like a kind of game. Every message carries the time it was sent and a running
// number inside `data`, which the server never reads; the receiving member measures with them.

import { type BinaryOutHeader, CHAT_CHANNEL, type MsgOutFrame, type OpOutFrame, type PresenceEntry } from '@p3p2/protocol'
import type { Member, Room } from './room.ts'
import type { ProfileName } from './types.ts'

/** What a profile does in one room. */
export interface Driver {
  /** Sets up one member's share of the traffic, once it has joined. */
  member(m: Member): void
  /** Sets up what happens to the room as a whole, once everyone has joined. */
  room?(): void
  msg?(to: Member, f: MsgOutFrame, now: number): void
  binary?(to: Member, header: BinaryOutHeader, payload: Uint8Array, now: number): void
  pres?(to: Member, list: PresenceEntry[], now: number): void
  op?(to: Member, f: OpOutFrame, now: number): void
  /** The server asked this member, the host, for a snapshot of the log. */
  snap?(to: Member): void
}

export interface Profile {
  about: string
  drive(room: Room): Driver
}

/** Send times travel as ms with three decimals: short in JSON, and exact to the microsecond. */
const stamp = (now: number) => Math.round(now * 1000) / 1000
const round2 = (v: number) => Math.round(v * 100) / 100

const CHAT_LINE = 'the tide is higher than it was this morning, I think'
const SNAPSHOT_BYTES = 4096
/** A saved world, for `ops`: 16 KB of JSON, replacing every 1,000 ops. */
const WORLD = { blocks: 'stone_wall,'.repeat(1489) }
const WORLD_EVERY = 1000

/** Profile 1. What the client library's chat sends, ten seconds apart. */
function chat(room: Room): Driver {
  const series = room.series('chat')
  return {
    member(m) {
      let n = 0
      m.every(10_000, (now) => {
        m.send({ t: 'msg', ch: CHAT_CHANNEL, data: `${stamp(now)} ${++n} ${CHAT_LINE}`, to: 'all', retain: 'tail' })
        series.sent++
      })
    },
    msg(to, f, now) {
      if (f.ch !== CHAT_CHANNEL || typeof f.data !== 'string') return
      const [sentAt, n] = f.data.split(' ', 2)
      to.track(series, f.from, Number(n), Number(sentAt), now)
    },
  }
}

/** Players walking one world: everyone says where they are ten times a second. */
function presence(room: Room): Driver {
  const series = room.series('presence')
  return {
    member(m) {
      let n = 0
      let x = Math.random() * 200 - 100
      let z = Math.random() * 200 - 100
      let yaw = Math.random() * 6.28
      m.every(100, (now) => {
        yaw += (Math.random() - 0.5) * 0.4
        x += Math.sin(yaw) * 0.4
        z += Math.cos(yaw) * 0.4
        // About 60 bytes of JSON.
        m.send({ t: 'pres', data: { x: round2(x), z: round2(z), yaw: round2(yaw), n: ++n, t: stamp(now) } })
        series.sent++
      })
    },
    pres(to, list, now) {
      for (const [from, value] of list) {
        const p = value as { n: number; t: number } | null
        if (p) to.track(series, from, p.n, p.t, now)
      }
    },
  }
}

/**
 * A game with an authority: the host sends everyone the world as 4 KB of
 * bytes 15 times a second, and every guest sends the host its input 20 times a second. Both
 * are volatile, as a game would mark what the next message replaces.
 */
function snapshots(room: Room): Driver {
  const snapshot = room.series('snapshot')
  const input = room.series('input')
  const header = JSON.stringify({ t: 'msg', ch: 'snap', volatile: true })
  return {
    member(m) {
      let snapshotN = 0
      let inputN = 0
      // Each member has both timers and acts on the one that fits: the host can change.
      m.every(1000 / 15, (now) => {
        if (!m.isHost) return
        const payload = new Uint8Array(SNAPSHOT_BYTES)
        const view = new DataView(payload.buffer)
        view.setFloat64(0, now)
        view.setUint32(8, ++snapshotN)
        m.sendBinary(header, payload)
        snapshot.sent++
      })
      m.every(50, (now) => {
        if (m.isHost) return
        // About 40 bytes of JSON.
        const data = { t: stamp(now), n: ++inputN, x: round2(Math.random()), y: round2(Math.random()) }
        m.send({ t: 'msg', ch: 'in', data, to: 'host', volatile: true })
        input.sent++
      })
    },
    binary(to, h, payload, now) {
      if (h.ch !== 'snap' || payload.length < 12) return
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
      to.track(snapshot, h.from, view.getUint32(8), view.getFloat64(0), now)
    },
    msg(to, f, now) {
      if (f.ch !== 'in') return
      const d = f.data as { t: number; n: number }
      to.track(input, f.from, d.n, d.t, now)
    },
  }
}

/**
 * A world its players build: every member adds two ops a second to the
 * room's log, which the server numbers, saves and sends to everyone, the sender included. The
 * host replaces the log by a snapshot of the world every 1,000 ops, and when the server asks.
 */
function ops(room: Room): Driver {
  const series = room.series('op')
  return {
    member(m) {
      let n = 0
      m.every(500, (now) => {
        // About 70 bytes of JSON: a block that is placed.
        const op = { t: 'block', x: n % 64, y: 3, z: (n * 7) % 64, b: 'stone_wall', n: ++n, at: stamp(now) }
        m.send({ t: 'op', op })
        series.sent++
      })
    },
    op(to, f, now) {
      const d = f.op as { n: number; at: number }
      to.track(series, f.from, d.n, d.at, now)
      if (to.isHost && f.seq % WORLD_EVERY === 0) to.send({ t: 'snap', data: WORLD, upTo: f.seq })
    },
    snap(to) {
      to.send({ t: 'snap', data: WORLD, upTo: to.seq })
    },
  }
}

/**
 * For the soak test: an evening of walking and talking that never ends. Presence and chat as above; every
 * player saves its own state once a minute, and the host the room's; every 30 s someone leaves
 * and comes back as a new member; every 5 minutes someone loses the connection and resumes.
 */
function mixed(room: Room): Driver {
  const walking = presence(room)
  const talking = chat(room)
  const saved = room.series('saved')
  let turn = 0
  return {
    member(m) {
      walking.member(m)
      talking.member(m)
      let n = 0
      m.every(60_000, (now) => {
        const data = { t: stamp(now), n: ++n, pockets: [3, 14, 15, 92, 65], x: 12.5, z: -40.25 }
        m.send({ t: 'msg', ch: 'self', data, retain: 'player' })
        saved.sent++
        if (!m.isHost) return
        m.send({ t: 'msg', ch: 'world', data: { t: stamp(now), n: ++n, seed: 1234567, epoch: 1760000000000 }, retain: 'room' })
        saved.sent++
      })
    },
    room() {
      const slot = () => turn++ % room.plan.members
      room.every(30_000, () => room.replace(slot(), 1000))
      room.every(300_000, () => room.members[slot()]?.cut(2000))
    },
    pres: walking.pres,
    msg(to, f, now) {
      if (f.retain === undefined) return talking.msg?.(to, f, now)
      const d = f.data as { t: number; n: number }
      to.track(saved, f.from, d.n, d.t, now)
    },
  }
}

/** Bytes that carry the time they were sent and a running number, padded to `size`: what the receiver measures with. */
function stamped(size: number, now: number, n: number): Uint8Array {
  const payload = new Uint8Array(Math.max(12, size))
  const view = new DataView(payload.buffer)
  view.setFloat64(0, now)
  view.setUint32(8, n)
  return payload
}

function trackBinary(to: Member, series: ReturnType<Room['series']>, from: number, payload: Uint8Array, now: number): void {
  if (payload.length < 12) return
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  to.track(series, from, view.getUint32(8), view.getFloat64(0), now)
}

/**
 * A shooter whose marks are saved, as one was measured with three players firing: everyone sets
 * presence 20 times a second, sends the shots it fires about 7 times a second (bytes), and adds to the room's log
 * about 3 times a second (the paint its balls left, and the tags). The host also reports its bots 10 times a second.
 */
function shooter(room: Room): Driver {
  const presence = room.series('presence')
  const shots = room.series('shots')
  const report = room.series('report')
  const paint = room.series('paint')
  const shotsHeader = JSON.stringify({ t: 'msg', ch: 'sh' })
  const reportHeader = JSON.stringify({ t: 'msg', ch: 'hr', volatile: true })
  return {
    member(m) {
      let n = 0
      let x = Math.random() * 100
      let z = Math.random() * 100
      let yaw = 0
      m.every(50, (now) => {
        yaw += 0.08
        x += Math.sin(yaw) * 0.3
        z += Math.cos(yaw) * 0.3
        // About 90 bytes of JSON: a place in cm, headings in mrad, flags and paint left.
        const p = [Math.round(x * 100), 120, Math.round(z * 100), Math.round(yaw * 1000), -120, 30, 0, 40]
        m.send({ t: 'pres', data: { p, f: 5, a: 180, n: ++n, t: stamp(now) } })
        presence.sent++
      })
      let shotN = 0
      m.every(150, (now) => {
        m.sendBinary(shotsHeader, stamped(42, now, ++shotN))
        shots.sent++
      })
      let reportN = 0
      m.every(100, (now) => {
        if (!m.isHost) return
        m.sendBinary(reportHeader, stamped(110, now, ++reportN))
        report.sent++
      })
      let opN = 0
      m.every(300, (now) => {
        // A batch of splats, as base64: about 90 bytes of JSON.
        m.send({ t: 'op', op: { k: 'p', d: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKA==', n: ++opN, at: stamp(now) } })
        paint.sent++
      })
    },
    pres(to, list, now) {
      for (const [from, value] of list) {
        const p = value as { n: number; t: number } | null
        if (p) to.track(presence, from, p.n, p.t, now)
      }
    },
    binary(to, h, payload, now) {
      if (h.ch === 'sh') trackBinary(to, shots, h.from, payload, now)
      else if (h.ch === 'hr') trackBinary(to, report, h.from, payload, now)
    },
    op(to, f, now) {
      const d = f.op as { n: number; at: number }
      to.track(paint, f.from, d.n, d.at, now)
    },
    snap(to) {
      // The newest 2,000 marks, as the shooter that was measured kept them: about 35 KB.
      to.send({ t: 'snap', data: { v: 1, p: 'A'.repeat(35_000) }, upTo: to.seq })
    },
  }
}

/**
 * A world too big to send round: every guest tells the host what it wants 20 times a second, and the host
 * tells each guest what it can see, 12.5 times a second, in one message with a part for each (about 500 bytes a
 * guest). Every five seconds it sends everybody the world's save, 37 KB in two parts.
 */
function views(room: Room): Driver {
  const view = room.series('view')
  const intent = room.series('intent')
  const intentHeader = JSON.stringify({ t: 'msg', ch: 'in', to: 'host', volatile: true })
  const saveHeader = JSON.stringify({ t: 'msg', ch: 'sv', volatile: true })
  return {
    member(m) {
      let viewN = 0
      m.every(80, (now) => {
        if (!m.isHost) return
        const guests = m.room.members.filter((o) => o !== m && o.ready && o.id > 0)
        if (guests.length === 0) return
        const part = stamped(500, now, ++viewN)
        const payload = new Uint8Array(part.length * guests.length)
        for (let i = 0; i < guests.length; i++) payload.set(part, i * part.length)
        const header = JSON.stringify({ t: 'msg', ch: 'v', parts: guests.map((g) => [g.id, part.length]), volatile: true })
        m.sendBinary(header, payload)
        view.sent += guests.length
      })
      let saveN = 0
      m.every(5000, (now) => {
        if (!m.isHost) return
        m.sendBinary(saveHeader, stamped(32 * 1024, now, ++saveN))
        m.sendBinary(saveHeader, stamped(5 * 1024, now, ++saveN))
      })
      let intentN = 0
      m.every(50, (now) => {
        if (m.isHost) return
        m.sendBinary(intentHeader, stamped(19, now, ++intentN))
        intent.sent++
      })
    },
    binary(to, h, payload, now) {
      if (h.ch === 'v') trackBinary(to, view, h.from, payload, now)
      else if (h.ch === 'in') trackBinary(to, intent, h.from, payload, now)
    },
  }
}

/** Members that only keep their connection, for the memory of an idle player. */
function idle(): Driver {
  return { member() {} }
}

export const PROFILES: Record<ProfileName, Profile> = {
  chat: { about: 'Chat: every member sends one line every 10 s', drive: chat },
  presence: { about: 'Presence, players walking: every member sends about 60 bytes 10 times a second', drive: presence },
  snapshots: {
    about: 'Host snapshots, a game with an authority: the host sends 4 KB to the others 15 times a second; each guest sends about 40 bytes to the host 20 times a second',
    drive: snapshots,
  },
  ops: {
    about: 'Ops, a world its players build: every member adds 2 saved ops a second to the room\'s log; the host saves a 16 KB snapshot every 1,000 ops',
    drive: ops,
  },
  mixed: {
    about: 'Soak: presence and chat, values saved every minute, a member replaced every 30 s, a connection cut every 5 minutes',
    drive: mixed,
  },
  idle: { about: 'Idle: members that only keep their connection', drive: idle },
  shooter: {
    about: 'A shooter whose marks are saved: presence 20 times a second, shots 7, log ops 3; the host reports 10 times a second',
    drive: shooter,
  },
  views: {
    about: 'A view for each player, of a world too big to send round: the host sends each guest its part of one message 12.5 times a second, and a 37 KB save every 5 s; guests send 20 a second',
    drive: views,
  },
}
