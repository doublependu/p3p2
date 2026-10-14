// Measurements as text: Markdown tables for docs/performance.md, and the summary of a soak run.

import type { Result } from './types.ts'

export const percent = (share: number, digits: number = 1) => `${(share * 100).toFixed(digits)} %`
export const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

function perSecond(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB/s`
  return `${(bytes / 1024).toFixed(1)} KB/s`
}

/** Milliseconds, with the digits that mean something at that size. */
export function ms(v: number): string {
  if (v >= 100) return v.toFixed(0)
  return v >= 10 ? v.toFixed(1) : v.toFixed(2)
}

/** "chat 0.41 / 1.20 · ping 0.38 / 0.95": median and 99th percentile per kind of message. */
function latencies(r: Result): string {
  return Object.entries(r.series)
    .map(([name, s]) => `${name} ${ms(s.p50)} / ${ms(s.p99)}`)
    .join(' · ')
}

/** Deliveries that never came, as a share of those that should have. */
export function missedShare(r: Result): number {
  let missed = 0
  let expected = 0
  for (const s of Object.values(r.series)) {
    missed += s.missed
    expected += s.missed + s.received
  }
  return expected ? missed / expected : 0
}

/** Connections the server dropped and the errors it sent, or "none". */
export function troubles(r: Result): string {
  const list = Object.entries(r.errors).map(([code, n]) => `${n} × ${code}`)
  if (r.closes) list.unshift(`${r.closes} dropped`)
  return list.join(', ') || 'none'
}

const HEAD = [
  'Rooms × members',
  'CPU',
  'Memory (RSS)',
  'Event-loop delay p99 / max',
  'Latency p50 / p99, ms',
  'Frames in → out, per s',
  'Bytes out',
  'Not delivered',
  'Errors',
]

function row(r: Result, note: string): string[] {
  return [
    `${r.rooms} × ${r.members}`,
    percent(r.cpu),
    mb(r.rss),
    `${ms(r.loopP99)} / ${ms(r.loopMax)} ms`,
    latencies(r),
    `${r.framesIn.toFixed(0)} → ${r.framesOut.toFixed(0)}`,
    perSecond(r.bytesOut),
    missedShare(r) ? percent(missedShare(r), 2) : '0',
    troubles(r),
    ...(note ? [note] : []),
  ]
}

/** A Markdown table of measurements. `notes`, when given, adds a last column. */
export function table(results: Result[], notes?: (r: Result) => string): string {
  const head = notes ? [...HEAD, 'Verdict'] : HEAD
  const lines = [head, head.map(() => '---'), ...results.map((r) => row(r, notes?.(r) ?? ''))]
  return lines.map((cells) => `| ${cells.join(' | ')} |`).join('\n')
}

/** One line for the terminal while a run is going. */
export function line(r: Result): string {
  const bad = troubles(r) === 'none' ? '' : `, ${troubles(r)}`
  return `${r.rooms} × ${r.members}: CPU ${percent(r.cpu)}, RSS ${mb(r.rss)}, loop p99 ${ms(r.loopP99)} ms (max ${ms(r.loopMax)}), ${latencies(r)}${bad}`
}

// ---- soak ----

/** One line of a soak file: a measurement, and when it ended. */
export interface SoakSample extends Result {
  at: string
  /** Hours since the soak started. */
  hours: number
}

export interface SoakSummary {
  hours: number
  samples: number
  /** Median RSS near the start (after a warm-up) and near the end, bytes, and the growth between them. */
  rssStart: number
  rssEnd: number
  growth: number
  rssPeak: number
  /** A straight line through the RSS readings after the warm-up: bytes per hour. */
  rssSlope: number
  heapStart: number
  heapEnd: number
  cpuMedian: number
  cpuMax: number
  loopP99Max: number
  /** Per series: the median and the worst of the samples' p99, ms. */
  p99: Record<string, { median: number; worst: number }>
  missed: number
  closes: number
  errors: Record<string, number>
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * Memory growth compares the run's start with its end: the first 1 % of the samples are warm-up,
 * the next 4 % are the start, the last 4 % the end. Over 24 hours those are a quarter of an hour
 * and two stretches of about an hour.
 */
export function soakSummary(samples: SoakSample[]): SoakSummary {
  const n = samples.length
  const warm = Math.min(n - 1, Math.ceil(n * 0.01))
  const span = Math.max(1, Math.round(n * 0.04))
  const start = samples.slice(warm, warm + span)
  const end = samples.slice(Math.max(warm, n - span))
  const steady = samples.slice(warm)

  // Least squares, RSS against time.
  const meanT = steady.reduce((sum, s) => sum + s.hours, 0) / steady.length
  const meanR = steady.reduce((sum, s) => sum + s.rss, 0) / steady.length
  let num = 0
  let den = 0
  for (const s of steady) {
    num += (s.hours - meanT) * (s.rss - meanR)
    den += (s.hours - meanT) ** 2
  }

  const p99: SoakSummary['p99'] = {}
  for (const name of new Set(samples.flatMap((s) => Object.keys(s.series)))) {
    const values = samples.flatMap((s) => (s.series[name] ? [s.series[name].p99] : []))
    p99[name] = { median: median(values), worst: Math.max(...values) }
  }
  const errors: Record<string, number> = {}
  for (const s of samples) for (const [code, count] of Object.entries(s.errors)) errors[code] = (errors[code] ?? 0) + count

  const rssStart = median(start.map((s) => s.rss))
  const rssEnd = median(end.map((s) => s.rss))
  return {
    hours: samples.at(-1)?.hours ?? 0,
    samples: n,
    rssStart,
    rssEnd,
    growth: rssStart ? rssEnd / rssStart - 1 : 0,
    rssPeak: Math.max(...samples.map((s) => s.rssPeak)),
    rssSlope: den ? num / den : 0,
    heapStart: median(start.map((s) => s.heapUsed)),
    heapEnd: median(end.map((s) => s.heapUsed)),
    cpuMedian: median(samples.map((s) => s.cpu)),
    cpuMax: Math.max(...samples.map((s) => s.cpu)),
    loopP99Max: Math.max(...samples.map((s) => s.loopP99)),
    p99,
    missed: samples.reduce((sum, s) => sum + Object.values(s.series).reduce((m, x) => m + x.missed, 0), 0),
    closes: samples.reduce((sum, s) => sum + s.closes, 0),
    errors,
  }
}

export function soakText(s: SoakSummary): string {
  const sign = s.growth >= 0 ? '+' : ''
  const errors = Object.entries(s.errors).map(([code, n]) => `${n} × ${code}`)
  return [
    `Soak: ${s.hours.toFixed(2)} hours, ${s.samples} samples`,
    `  RSS      ${mb(s.rssStart)} at the start → ${mb(s.rssEnd)} at the end (${sign}${percent(s.growth)}), peak ${mb(s.rssPeak)}, trend ${(s.rssSlope / 1024 / 1024).toFixed(2)} MB/hour`,
    `  JS heap  ${mb(s.heapStart)} → ${mb(s.heapEnd)}`,
    `  CPU      median ${percent(s.cpuMedian)}, highest sample ${percent(s.cpuMax)}`,
    `  Event-loop delay p99, worst sample: ${ms(s.loopP99Max)} ms`,
    ...Object.entries(s.p99).map(([name, v]) => `  ${name.padEnd(8)} p99: median of the samples ${ms(v.median)} ms, worst sample ${ms(v.worst)} ms`),
    `  Not delivered: ${s.missed}; connections dropped: ${s.closes}; errors: ${errors.join(', ') || 'none'}`,
  ].join('\n')
}
