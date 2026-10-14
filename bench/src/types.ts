// What the main thread and the generator threads tell each other, and what a measurement yields.

export type ProfileName = 'chat' | 'presence' | 'snapshots' | 'ops' | 'mixed' | 'idle' | 'shooter' | 'views'

/** One room for a generator thread to fill. */
export interface RoomPlan {
  index: number
  key: string
  invite: string
  members: number
}

export interface WorkerInit {
  /** Server base URL, and the Origin the members claim to come from. */
  server: string
  origin: string
  profile: ProfileName
  /** Multiplies every rate of the profile. 1 is the profile as described. */
  speed: number
}

export type Command =
  /** The rooms this thread should be running. It starts the new ones and empties the others. */
  | { cmd: 'rooms'; plans: RoomPlan[] }
  /** Start counting afresh. */
  | { cmd: 'mark' }
  | { cmd: 'report' }
  | { cmd: 'stop' }

/** One kind of message, as counted by a generator thread since the last mark. Times are ms. */
export interface SeriesResult {
  sent: number
  received: number
  /** Deliveries that never came: gaps in the numbering each sender gives its messages. */
  missed: number
  p50: number
  p95: number
  p99: number
  max: number
}

export interface WorkerReport {
  /** Latency histograms by series name, in microseconds. They travel between threads as they are. */
  histograms: Record<string, unknown>
  counts: Record<string, { sent: number; received: number; missed: number }>
  /** `error` and `bye` frames, by code. */
  errors: Record<string, number>
  /** Connections that closed without the generator asking. */
  closes: number
  members: number
  /** How late this thread's own event loop ran, ms. High values mean the generator is the bottleneck. */
  loopP99: number
}

/** One measurement: a profile at one size, over one stretch of time. */
export interface Result {
  profile: ProfileName
  rooms: number
  /** Members per room. */
  members: number
  connections: number
  seconds: number
  /** Share of one CPU used by the server process: 0.25 is 25 %. */
  cpu: number
  /** Bytes, at the end of the measurement, and the highest reading during it. */
  rss: number
  rssPeak: number
  heapUsed: number
  /** How late the server's event loop ran, ms. */
  loopP99: number
  loopMax: number
  /** Per second. */
  framesIn: number
  framesOut: number
  bytesIn: number
  bytesOut: number
  writes: number
  /** Share of presence batches and of volatile messages the server held back, 0–1. */
  presenceSkipped: number
  volatileDropped: number
  series: Record<string, SeriesResult>
  errors: Record<string, number>
  closes: number
  generatorLoopP99: number
  /** Only for a server in a container: ms the kernel paused it for using up its CPU share. */
  throttledMs?: number
}
