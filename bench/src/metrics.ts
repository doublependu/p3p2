// Counting on a generator thread: one latency histogram and three counters per kind of message.

import { createHistogram, type RecordableHistogram } from 'node:perf_hooks'
import type { SeriesResult } from './types.ts'

/** Histograms hold microseconds, from 1 µs to 10 minutes, to three significant figures. */
const HIGHEST_US = 600_000_000

export function newHistogram(): RecordableHistogram {
  return createHistogram({ lowest: 1, highest: HIGHEST_US, figures: 3 })
}

export class Series {
  hist: RecordableHistogram = newHistogram()
  sent: number = 0
  received: number = 0
  missed: number = 0

  record(ms: number): void {
    this.received++
    this.hist.record(Math.min(HIGHEST_US, Math.max(1, Math.round(ms * 1000))))
  }
}

export class Metrics {
  private readonly all = new Map<string, Series>()
  errors: Record<string, number> = {}
  closes: number = 0

  series(name: string): Series {
    let s = this.all.get(name)
    if (!s) {
      s = new Series()
      this.all.set(name, s)
    }
    return s
  }

  error(code: string): void {
    this.errors[code] = (this.errors[code] ?? 0) + 1
  }

  entries(): [string, Series][] {
    return [...this.all]
  }

  /** Starts counting afresh. The series stay, so whoever holds one keeps counting into it. */
  reset(): void {
    for (const s of this.all.values()) {
      s.hist.reset()
      s.sent = s.received = s.missed = 0
    }
    this.errors = {}
    this.closes = 0
  }
}

const ms = (us: number) => Math.round(us) / 1000

export function summarize(hist: RecordableHistogram, counts: { sent: number; received: number; missed: number }): SeriesResult {
  const empty = hist.count === 0
  return {
    ...counts,
    p50: empty ? 0 : ms(hist.percentile(50)),
    p95: empty ? 0 : ms(hist.percentile(95)),
    p99: empty ? 0 : ms(hist.percentile(99)),
    max: empty ? 0 : ms(hist.max),
  }
}
