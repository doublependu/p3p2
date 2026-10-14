import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findLimit, overLimit, overTarget } from '../src/limits.ts'
import { type SoakSample, soakSummary, table } from '../src/report.ts'
import type { Result, SeriesResult } from '../src/types.ts'

function series(p99: number, over: Partial<SeriesResult> = {}): SeriesResult {
  return { sent: 100, received: 1900, missed: 0, p50: p99 / 2, p95: p99, p99, max: p99, ...over }
}

function result(over: Partial<Result> = {}): Result {
  return {
    profile: 'presence',
    rooms: 1,
    members: 20,
    connections: 20,
    seconds: 60,
    cpu: 0.05,
    rss: 100 * 1024 * 1024,
    rssPeak: 101 * 1024 * 1024,
    heapUsed: 15 * 1024 * 1024,
    loopP99: 1,
    loopMax: 2,
    framesIn: 200,
    framesOut: 400,
    bytesIn: 20_000,
    bytesOut: 230_000,
    writes: 0,
    presenceSkipped: 0,
    volatileDropped: 0,
    series: { ping: series(1), presence: series(51) },
    errors: {},
    closes: 0,
    generatorLoopP99: 1,
    ...over,
  }
}

test('findLimit: doubles, then closes in to within a tenth', async () => {
  for (const [limit, max, pass, fail] of [
    [96, 500, 96, 104],
    [1, 500, 1, 2],
    [0, 500, 0, 1],
    [7, 500, 7, 8],
    [1000, 500, 500, null],
    [499, 500, 470, 500],
  ] as const) {
    const asked: number[] = []
    const found = await findLimit(async (n) => {
      asked.push(n)
      return n <= limit
    }, max)
    assert.deepEqual(found, { pass, fail }, `limit ${limit}`)
    assert.ok(asked.length <= 14 && Math.max(...asked) <= max, `limit ${limit}: asked ${asked.join(' ')}`)
  }
})

test('the limit and the target: presence may wait for the tick, the rest may not', () => {
  assert.equal(overLimit(result()), null)
  assert.equal(overTarget(result()), null)
  assert.equal(overLimit(result({ cpu: 0.81 })), 'CPU 81 %')
  assert.equal(overTarget(result({ cpu: 0.3 })), 'CPU 30 %')
  assert.equal(overLimit(result({ series: { ping: series(51), presence: series(99) } })), 'ping p99 51.0 ms')
  assert.equal(overLimit(result({ series: { presence: series(101) } })), 'presence p99 101.0 ms')
  assert.equal(overTarget(result({ series: { ping: series(12), presence: series(60) } })), 'ping p99 12.0 ms')
  assert.equal(overLimit(result({ closes: 2, errors: { 'bye slow': 2, rate: 5 } })), '2 connections dropped, 2 × bye slow, 5 × rate')
})

test('table: one row per measurement, with what was not delivered', () => {
  const r = result({ rooms: 2, series: { presence: series(51, { missed: 100 }) }, closes: 1 })
  const lines = table([result(), r], (x) => overLimit(x) ?? 'ok').split('\n')
  assert.equal(lines.length, 4)
  assert.match(lines[0]!, /^\| Rooms × members \| CPU \| .* \| Verdict \|$/)
  assert.match(lines[2]!, /^\| 1 × 20 \| 5\.0 % \| 100\.0 MB \| 1\.00 \/ 2\.00 ms \| ping 0\.50 \/ 1\.00 · presence 25\.5 \/ 51\.0 \| 200 → 400 \| 224\.6 KB\/s \| 0 \| none \| ok \|$/)
  assert.match(lines[3]!, /\| 5\.00 % \| 1 dropped \| 1 connections dropped \|$/)
})

test('soak summary: growth compares the start, after a warm-up, with the end', () => {
  const mbytes = 1024 * 1024
  // 1440 minutes: a high first quarter of an hour, then 100 MB creeping up by 5 MB over the day.
  const samples: SoakSample[] = Array.from({ length: 1440 }, (_, i) => ({
    ...result({
      rss: (i < 10 ? 140 : 100 + (5 * i) / 1440) * mbytes,
      cpu: i === 700 ? 0.4 : 0.06,
      series: { ping: series(i === 300 ? 30 : 1, { missed: i === 300 ? 3 : 0 }) },
      errors: i === 5 ? { rate: 2 } : {},
    }),
    at: '2026-10-09T00:00:00.000Z',
    hours: (i + 1) / 60,
  }))
  const s = soakSummary(samples)
  assert.equal(s.samples, 1440)
  assert.ok(Math.abs(s.growth - 0.047) < 0.004, `growth ${s.growth}`)
  assert.ok(Math.abs(s.rssSlope / mbytes - 5 / 24) < 0.01, `slope ${s.rssSlope / mbytes}`)
  assert.deepEqual([s.cpuMedian, s.cpuMax], [0.06, 0.4])
  assert.deepEqual(s.p99.ping, { median: 1, worst: 30 })
  assert.deepEqual([s.missed, s.closes, s.errors], [3, 0, { rate: 2 }])
  // A run that has only just begun still summarizes.
  assert.equal(soakSummary(samples.slice(0, 1)).samples, 1)
})
