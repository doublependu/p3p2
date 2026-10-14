export interface Limits {
  maxFrameBytes: number
  /** Frames per second per member, and the burst allowed on top. */
  msgRate: number
  msgBurst: number
  /** Bytes per second per member, and the burst allowed on top. */
  bytesRate: number
  bytesBurst: number
  /** Default and hard cap for members per room. */
  maxMembers: number
  maxMembersCap: number
  maxRooms: number
  /** How long a disconnected member keeps its slot, and how long a disconnected host keeps the role. */
  graceMs: number
  hostGraceMs: number
  /**
   * A member that is connected, with its page in front, and has sent nothing for this long is
   * `lost`, and a host gives up the role: its page has stopped. Clients in front send something
   * at least once a second.
   */
  quietMs: number
  helloTimeoutMs: number
  /** Per room: saved values, the in-memory message tails, and the saved log (snapshot and ops). */
  maxRetainedBytes: number
  maxTailBytes: number
  maxLogBytes: number
  /** Counted from when the room empties. */
  inviteTtlMs: number
  /** Queued bytes per receiver: past the first, volatile messages and presence are dropped; past the second, the receiver is. */
  volatileBufferedBytes: number
  maxBufferedBytes: number
  /** How often changed presence is passed on, per second, and the largest presence value. */
  presenceHz: number
  maxPresenceBytes: number
  /** Per address: WebSocket connects and REST calls per second, and the bursts allowed on top. */
  connectRate: number
  connectBurst: number
  apiRate: number
  apiBurst: number
}

export const DEFAULT_LIMITS: Limits = {
  maxFrameBytes: 64 * 1024,
  msgRate: 90,
  msgBurst: 120,
  bytesRate: 256 * 1024,
  bytesBurst: 512 * 1024,
  maxMembers: 16,
  maxMembersCap: 64,
  maxRooms: 50,
  graceMs: 30_000,
  hostGraceMs: 5_000,
  quietMs: 3_000,
  helloTimeoutMs: 5_000,
  maxRetainedBytes: 256 * 1024,
  maxTailBytes: 64 * 1024,
  maxLogBytes: 1024 * 1024,
  inviteTtlMs: 12 * 3600_000,
  volatileBufferedBytes: 64 * 1024,
  maxBufferedBytes: 1024 * 1024,
  presenceHz: 20,
  maxPresenceBytes: 1024,
  connectRate: 1,
  connectBurst: 40,
  apiRate: 5,
  apiBurst: 40,
}

/** Token bucket: `rate` tokens per second, holding at most `burst`. */
export class Bucket {
  private tokens: number
  private last: number
  private readonly rate: number
  private readonly burst: number

  constructor(rate: number, burst: number, now: number) {
    this.rate = rate
    this.burst = burst
    this.tokens = burst
    this.last = now
  }

  take(now: number, n: number = 1): boolean {
    const tokens = Math.min(this.burst, this.tokens + (Math.max(0, now - this.last) / 1000) * this.rate)
    this.last = now
    if (tokens < n) {
      this.tokens = tokens
      return false
    }
    this.tokens = tokens - n
    return true
  }

  /** Whether `take` would succeed, without taking. */
  has(now: number, n: number = 1): boolean {
    return Math.min(this.burst, this.tokens + (Math.max(0, now - this.last) / 1000) * this.rate) >= n
  }

  /** True when the bucket has refilled, so forgetting it changes nothing. */
  idle(now: number): boolean {
    return this.tokens + ((now - this.last) / 1000) * this.rate >= this.burst
  }
}

/** One bucket per key (an IP address). */
export class KeyedLimiter {
  private readonly buckets = new Map<string, Bucket>()
  private readonly rate: number
  private readonly burst: number

  constructor(rate: number, burst: number) {
    this.rate = rate
    this.burst = burst
  }

  take(key: string, now: number): boolean {
    let b = this.buckets.get(key)
    if (!b) {
      b = new Bucket(this.rate, this.burst, now)
      this.buckets.set(key, b)
    }
    return b.take(now)
  }

  /** Whether `take` would succeed for this key, without taking. */
  allows(key: string, now: number): boolean {
    return this.buckets.get(key)?.has(now) ?? true
  }

  sweep(now: number): void {
    for (const [key, b] of this.buckets) if (b.idle(now)) this.buckets.delete(key)
  }

  get size(): number {
    return this.buckets.size
  }
}
