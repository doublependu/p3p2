import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Smooth } from '../src/smooth.ts'

const near = (a: number, b: number, eps: number = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`)

/**
 * For the tests that give every time themselves: a clock that tells nothing, so that how late a report came is not
 * measured. The test at the end is about that.
 */
const GIVEN = { clock: () => Number.NaN }

test('between two reports a thing is drawn in between, a little in the past', () => {
  const s = new Smooth<string>({ ...GIVEN, delay: 100 })
  assert.equal(s.get('car', 0), null)
  s.set('car', [0, 10], 1000)
  // One report: it is there.
  assert.deepEqual(s.get('car', 1000), [0, 10])
  assert.deepEqual(s.get('car', 5000), [0, 10])
  s.set('car', [10, 20], 1100)
  // Drawn 100 ms in the past: at 1150 that is half way between the two.
  assert.deepEqual(s.get('car', 1100), [0, 10])
  assert.deepEqual(s.get('car', 1150), [5, 15])
  assert.deepEqual(s.get('car', 1200), [10, 20])
  // Three reports: the right two are used.
  s.set('car', [10, 40], 1200)
  assert.deepEqual(s.get('car', 1250), [10, 30])
  assert.equal(s.has('car'), true)
  s.delete('car')
  assert.equal(s.get('car', 1250), null)
})

test('when reports stop it carries on the way it was going, for a while, waits, and after a second goes back', () => {
  const s = new Smooth({ ...GIVEN, delay: 0, coast: 200 })
  s.set(1, [0], 0)
  s.set(1, [10], 100)
  assert.deepEqual(s.get(1, 150), [15])
  assert.deepEqual(s.get(1, 300), [30])
  // A late report is waited for where the thing would be.
  assert.deepEqual(s.get(1, 900), [30])
  // A second after the last: it stopped. Back, as gently as it went on, and there it stands.
  assert.deepEqual(s.get(1, 1200), [20])
  assert.deepEqual(s.get(1, 1300), [10])
  assert.deepEqual(s.get(1, 3000), [10])
  // With no coasting it stops at the last report.
  const still = new Smooth({ ...GIVEN, delay: 0, coast: 0 })
  still.set(1, [0], 0)
  still.set(1, [10], 100)
  assert.deepEqual(still.get(1, 400), [10])
})

test('angles turn the short way round', () => {
  const s = new Smooth({ ...GIVEN, delay: 0, angles: [1] })
  s.set(1, [0, 3.0], 0)
  s.set(1, [0, -3.0], 100)
  // From 3.0 to -3.0 is 0.28 rad through pi, not 6 rad back through zero.
  near(s.get(1, 50)![1]!, 3.0 + (2 * Math.PI - 6) / 2)
})

test('a rotation is drawn the short way too, and stays a rotation', () => {
  const s = new Smooth({ ...GIVEN, delay: 0, quaternions: [1] })
  const half = Math.SQRT1_2
  s.set(1, [7, 0, 0, 0, 1], 0)
  // A quarter turn about y, written as its negative: the same rotation.
  s.set(1, [7, 0, -half, 0, -half], 100)
  const at = s.get(1, 50)!
  assert.equal(at[0], 7)
  near(Math.hypot(at[1]!, at[2]!, at[3]!, at[4]!), 1)
  // An eighth of a turn about y: sin and cos of pi/8.
  near(at[2]!, Math.sin(Math.PI / 8), 1e-6)
  near(at[4]!, Math.cos(Math.PI / 8), 1e-6)
})

test('a jump is not a movement: nothing is drawn in between', () => {
  const s = new Smooth({ ...GIVEN, delay: 50, jump: 20, angles: [1] })
  s.set(1, [0, 0], 0)
  s.set(1, [5, 3], 100)
  s.set(1, [500, 3], 200)
  // Not somewhere on the way from 5 to 500.
  assert.deepEqual(s.get(1, 210), [500, 3])
  // An angle that changes a lot is a turn, not a jump.
  s.set(1, [501, -3], 300)
  assert.notEqual(s.get(1, 300)![0], 501)
})

test('old reports are let go, and one that says it is older than the last does not run time backwards', () => {
  const s = new Smooth({ ...GIVEN, delay: 0 })
  for (let t = 0; t <= 5000; t += 100) s.set(1, [t], t)
  assert.deepEqual(s.get(1, 4950), [4950])
  // Nothing from the first seconds is kept: asked for then, it is where the oldest kept report was.
  assert.ok(s.get(1, 100)![0]! >= 3900)
  s.set(1, [6000], 4000)
  assert.ok(Number.isFinite(s.get(1, 5001)![0]!))
})

test('the values can be written into an array that is given', () => {
  const s = new Smooth({ ...GIVEN, delay: 0 })
  s.set(1, [1, 2, 3], 0)
  const out: number[] = []
  assert.equal(s.get(1, 0, out), out)
  assert.deepEqual(out, [1, 2, 3])
})

test('reports that arrive late are drawn that much further back, and the drawing does not run out of them', () => {
  let now = 0
  const s = new Smooth({ delay: 100, coast: 0, clock: () => now })
  // A thing moving at 1 a ms, reported every 70 ms. Each report arrives 150 to 250 ms after it was made, the
  // amount different each time, as over a slow connection; and in order, as over one connection.
  const due: { at: number; arrives: number }[] = []
  let r = 1
  for (let at = 0; at < 4000; at += 70) {
    r = (r * 16807) % 2147483647
    due.push({ at, arrives: Math.max(due.at(-1)?.arrives ?? 0, at + 150 + (r % 100)) })
  }
  const drawn: [number, number][] = []
  for (now = 0; now < 4000; now += 16) {
    for (const d of due.filter((d) => d.arrives <= now && d.arrives > now - 16)) s.set(1, [d.at], d.at)
    const v = s.get(1, now)
    if (v) drawn.push([now, v[0]!])
  }
  // After the first half second: the drawn thing moves at its own speed, never stalls or leaps, and is drawn
  // about delay + the latest arrival (250) behind.
  const steady = drawn.filter(([t]) => t > 1000)
  for (let i = 1; i < steady.length; i++) {
    const speed = (steady[i]![1] - steady[i - 1]![1]) / 16
    assert.ok(speed > 0.85 && speed < 1.15, `at ${steady[i]![0]}: ${speed}`)
  }
  const behind = steady.map(([t, x]) => t - x)
  assert.ok(Math.min(...behind) > 300 && Math.max(...behind) < 380, `behind by ${Math.min(...behind)} to ${Math.max(...behind)}`)
})

test('reports dated by their arrival are drawn delay behind, as before', () => {
  let now = 0
  const s = new Smooth({ delay: 100, clock: () => now })
  for (now = 0; now <= 1000; now += 50) s.set(1, [now])
  assert.deepEqual(s.get(1, 1000), [900])
})

test('a report dated the same as the one before it is newer news of that moment, and nothing leaps from it', () => {
  const s = new Smooth({ ...GIVEN, delay: 0, coast: 200 })
  s.set(1, [0], 0)
  s.set(1, [10], 100)
  s.set(1, [11], 100)
  // On from the last two, at the speed between them: not 1 in no time at all.
  assert.deepEqual(s.get(1, 100), [11])
  assert.deepEqual(s.get(1, 200), [22])
})
