// Things that report where they are a few times a second, drawn at sixty.
//
// A report says where something was when it was sent. Drawn as it arrives, the thing stands
// still and then jumps, ten or twenty times a second. `Smooth` keeps the last few reports of
// each thing and draws it a little in the past, where there is a report on either side of the
// moment to draw between. By default it only ever draws between reports: when they stop, the thing
// stands at the last one until the next comes. A game that would rather guess ahead for a moment
// gives it `coast`: the thing then carries on the way it was going for a little while, and waits;
// when the reports have stopped for a second, it goes back to the last one and stands there.
//
// It knows nothing of rooms. Feed it from wherever the reports come: presence, for the other
// players; a host's messages, for what the host simulates. Give it the time each report was
// made, where there is one: presence comes with the moment the server got the value. A report
// dated by when it arrived is dated up to a batch late, by a different amount each time, and a
// thing drawn from such reports goes forward and back by that much.
//
// A report dated by when it was made arrives some time after that date: over a slow connection,
// longer than `delay`. So `Smooth` notes how late reports come, the most in the last second, and
// draws that much further in the past as well. That extra follows the connection slowly, so that
// it never makes things seem to speed up or slow down by more than a little.
//
//   const cars = new Smooth<number>({ angles: [2] })                  // x, z, heading
//   room.presence.on((member, p, at) => (p ? cars.set(member.id, [p.x, p.z, p.yaw], at) : cars.delete(member.id)))
//   // every frame:
//   const at = cars.get(member.id)                                    // [x, z, heading] to draw with, or null

export interface SmoothOptions {
  /**
   * How far in the past things are drawn, in ms. Default 120: room for two reports to have
   * arrived at ten a second, and for the server passing presence on twenty times a second.
   * Lower is more immediate and stutters when a report is late.
   */
  delay?: number
  /**
   * For how long, in ms, a thing carries on the way it was going when no report comes. Default 0: it stands at the
   * last report, and nothing is ever drawn where no report said it was. For a game that would rather guess ahead for
   * a moment when a report is late. A second after the last report it goes back to it, over as long again, and
   * stands there.
   */
  coast?: number
  /** The positions, among the values, of angles in radians. They turn the short way round. */
  angles?: readonly number[]
  /** The positions of the first of four values that are a rotation as a quaternion (x, y, z, w). */
  quaternions?: readonly number[]
  /**
   * A change larger than this, in any value that is not part of an angle or a rotation, is a
   * jump and not a movement: the thing is simply at the new place, with nothing drawn in
   * between. For a player who is put somewhere else. Default: no change is a jump.
   */
  jump?: number
  /** The clock `set` and `get` read when they are not given a time. `performance.now` by default; for tests. */
  clock?: () => number
}

interface Report {
  at: number
  values: number[]
}

const TURN = Math.PI * 2

/** Reports older than this are of no use to anything that is drawn, ms. */
const KEPT = 1000

/** No report for this long after the last, ms, and a thing has stopped rather than gone quiet for a moment. */
const SETTLE = 1000

/** How late reports arrive is kept as the most in each of the last ten tenths of a second. */
const SLOT = 100
const SLOTS = 10

/** At most this much later than `delay` is anything drawn, ms. */
const LATEST = 600

/**
 * How fast the extra delay follows the connection: in ms per ms. Rising, the things drawn seem a tenth slower
 * while it rises; falling, a fiftieth faster. Rising quickly matters more: until it has, things run out of
 * reports and carry on by guesswork.
 */
const RISE = 0.1
const FALL = 0.02

export class Smooth<K = number> {
  private readonly delay: number
  private readonly coast: number
  private readonly angles: readonly number[]
  private readonly quaternions: readonly number[]
  private readonly jump: number
  private readonly clock: () => number
  /** Which values are compared for a jump: all but the angles and the rotations. */
  private plain: boolean[] | null = null
  private readonly things = new Map<K, Report[]>()
  /** The most late a report arrived in each tenth of a second, and which tenth that slot last held. */
  private readonly latest = new Float64Array(SLOTS)
  private readonly slotOf = new Float64Array(SLOTS).fill(Number.NEGATIVE_INFINITY)
  /** How much further in the past than `delay` things are drawn now, ms. -1 until a report has come. */
  private late = -1
  private lastGet = Number.NEGATIVE_INFINITY

  constructor(options: SmoothOptions = {}) {
    this.delay = options.delay ?? 120
    this.coast = options.coast ?? 0
    this.angles = options.angles ?? []
    this.quaternions = options.quaternions ?? []
    this.jump = options.jump ?? Number.POSITIVE_INFINITY
    this.clock = options.clock ?? (() => performance.now())
  }

  /**
   * A report: the values of `key` as they were at `at`, in ms on the clock of `performance.now()`. Without `at`,
   * as they are now: a report dated by its arrival.
   */
  set(key: K, values: readonly number[], at?: number): void {
    const arrived = this.clock()
    if (at === undefined) at = arrived
    this.noteLate(arrived, arrived - at)
    const next = values.slice()
    let reports = this.things.get(key)
    if (!reports) {
      reports = []
      this.things.set(key, reports)
    }
    const last = reports.at(-1)
    if (last) {
      // A rotation and its negative are the same rotation; drawing between them must not go the long way.
      for (const q of this.quaternions) {
        const dot = next[q]! * last.values[q]! + next[q + 1]! * last.values[q + 1]! + next[q + 2]! * last.values[q + 2]! + next[q + 3]! * last.values[q + 3]!
        if (dot < 0) for (let i = q; i < q + 4; i++) next[i] = -next[i]!
      }
      if (this.jumped(last.values, next)) reports.length = 0
      else if (at <= last.at) {
        // Dated no later than the report before it (a clock that was read again, and found a little ahead): newer
        // news of that moment. Another report a hair later would run time backwards, or, carried on from, leap.
        last.values = next
        return
      }
    }
    reports.push({ at, values: next })
    // Keep what the drawing can still need: the last second, and never fewer than two.
    while (reports.length > 2 && reports[1]!.at < at - KEPT) reports.shift()
  }

  /** The values to draw `key` with now. Written into `out` when one is given. Null for a key nothing is known of. */
  get(key: K, now: number = this.clock(), out: number[] = []): number[] | null {
    this.followLate(now)
    const reports = this.things.get(key)
    if (!reports?.length) return null
    const when = now - this.delay - Math.max(0, this.late)
    const last = reports.at(-1)!

    let from = last
    let to = last
    let u = 0
    if (when >= last.at) {
      // Past the last report: there it stands. With `coast`, it goes on along the way it was going, for a while, and
      // there it waits for the next: a report that is late is bridged so. One that has not come for a second is not
      // late: the thing stopped (and says nothing more, since nothing changed), so it goes back, as gently as it went
      // on, to where it was last said to be, and is not left standing where it never was.
      const before = reports.at(-2)
      if (before && this.coast > 0) {
        const past = when - last.at
        const on = past <= SETTLE ? Math.min(past, this.coast) : Math.max(0, this.coast - (past - SETTLE))
        from = before
        u = 1 + on / (last.at - before.at)
      }
    } else {
      // Between two reports, or before the first.
      let i = reports.length - 2
      while (i > 0 && reports[i]!.at > when) i--
      from = reports[Math.max(i, 0)]!
      to = reports[Math.max(i, 0) + 1] ?? from
      u = to === from || when <= from.at ? 0 : (when - from.at) / (to.at - from.at)
    }

    const a = from.values
    const b = to.values
    out.length = a.length
    for (let i = 0; i < a.length; i++) out[i] = a[i]! + (b[i]! - a[i]!) * u
    for (const i of this.angles) {
      const turn = ((((b[i]! - a[i]!) % TURN) + TURN + Math.PI) % TURN) - Math.PI
      out[i] = a[i]! + turn * u
    }
    for (const q of this.quaternions) {
      const length = Math.hypot(out[q]!, out[q + 1]!, out[q + 2]!, out[q + 3]!) || 1
      for (let i = q; i < q + 4; i++) out[i] = out[i]! / length
    }
    return out
  }

  has(key: K): boolean {
    return this.things.has(key)
  }

  /** Forget a thing: a player who left. */
  delete(key: K): void {
    this.things.delete(key)
  }

  clear(): void {
    this.things.clear()
  }

  /** How late a report arrived, by the date it carries. A report that is old news (a value that has not changed for a while) says nothing about the connection. */
  private noteLate(arrived: number, late: number): void {
    if (!(late >= 0 && late < KEPT)) return
    const slot = Math.floor(arrived / SLOT)
    const i = ((slot % SLOTS) + SLOTS) % SLOTS
    if (this.slotOf[i] !== slot) {
      this.slotOf[i] = slot
      this.latest[i] = late
    } else if (late > this.latest[i]!) this.latest[i] = late
  }

  /** Moves the extra delay towards the latest a report arrived in the last second, at most a little per ms. */
  private followLate(now: number): void {
    const slot = Math.floor(now / SLOT)
    let target = -1
    for (let i = 0; i < SLOTS; i++) {
      const age = slot - this.slotOf[i]!
      if (age >= 0 && age < SLOTS && this.latest[i]! > target) target = this.latest[i]!
    }
    if (target >= 0) {
      target = Math.min(target, LATEST)
      if (this.late < 0) this.late = target
      else if (now > this.lastGet) {
        const dt = Math.min(now - this.lastGet, SLOT)
        this.late = target > this.late ? Math.min(target, this.late + dt * RISE) : Math.max(target, this.late - dt * FALL)
      }
    }
    if (now > this.lastGet) this.lastGet = now
  }

  private jumped(a: number[], b: number[]): boolean {
    if (this.jump === Number.POSITIVE_INFINITY) return false
    if (!this.plain || this.plain.length !== b.length) {
      this.plain = b.map(() => true)
      for (const i of this.angles) this.plain[i] = false
      for (const q of this.quaternions) for (let i = q; i < q + 4; i++) this.plain[i] = false
    }
    for (let i = 0; i < b.length; i++) if (this.plain[i] && Math.abs(b[i]! - a[i]!) > this.jump) return true
    return false
  }
}
