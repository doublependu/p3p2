// The yardsticks: the target a room of 20 should meet, and where a profile's limit is.

import type { Result } from './types.ts'

/** A room of 20 should stay under these on a 1-CPU, 512 MB machine. */
export const TARGET = { cpu: 0.25, relayP99: 10 }

/** Past any of these, the server is over its limit. */
export const LIMIT = {
  cpu: 0.8,
  /** ms, for every kind of message except presence. */
  relayP99: 50,
  /** ms. Presence waits for the server's tick (50 ms at 20 a second) by design, so it gets a tick more. */
  presenceP99: 100,
}

/** The generator's own event loop running this late (ms) means it, not the server, is being measured. */
export const GENERATOR_LATE = 20

const percent = (share: number) => `${(share * 100).toFixed(0)} %`

function p99Over(r: Result, relay: number, presence: number): string[] {
  return Object.entries(r.series)
    .filter(([name, s]) => s.p99 > (name === 'presence' ? presence : relay))
    .map(([name, s]) => `${name} p99 ${s.p99.toFixed(1)} ms`)
}

/** Why this measurement is over the limit, or null when it is within. */
export function overLimit(r: Result): string | null {
  const why = p99Over(r, LIMIT.relayP99, LIMIT.presenceP99)
  if (r.cpu > LIMIT.cpu) why.unshift(`CPU ${percent(r.cpu)}`)
  if (r.closes) why.push(`${r.closes} connections dropped`)
  for (const [code, n] of Object.entries(r.errors)) why.push(`${n} × ${code}`)
  return why.length ? why.join(', ') : null
}

/** Why this measurement misses the target for a room of 20, or null when it meets it. */
export function overTarget(r: Result): string | null {
  // Presence is held to the limit's bound here too: what it adds is the tick, not load.
  const why = p99Over(r, TARGET.relayP99, LIMIT.presenceP99)
  if (r.cpu > TARGET.cpu) why.unshift(`CPU ${percent(r.cpu)}`)
  return why.length ? why.join(', ') : null
}

export interface Found {
  /** The largest size that was within the limit; 0 when even the smallest was not. */
  pass: number
  /** The smallest size that was over it; null when none was, up to `max`. */
  fail: number | null
}

/**
 * Finds where `ok` stops holding between 1 and `max`, assuming it holds up to some size and
 * not beyond: doubles until it fails, then halves the gap until it is within `precision` of
 * the size (and never asks for less than a whole step).
 */
export async function findLimit(ok: (n: number) => Promise<boolean>, max: number, precision: number = 0.1): Promise<Found> {
  let pass = 0
  let fail: number | null = null
  for (let n = 1; fail === null; n = Math.min(max, n * 2)) {
    if (await ok(n)) pass = n
    else fail = n
    if (n === max) break
  }
  while (fail !== null && fail - pass > Math.max(1, pass * precision)) {
    const mid = Math.round((pass + fail) / 2)
    if (await ok(mid)) pass = mid
    else fail = mid
  }
  return { pass, fail }
}
