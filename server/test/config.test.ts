import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadConfig, SOURCE_URL } from '../src/config.ts'
import { DEFAULT_LIMITS } from '../src/core/limits.ts'

const BASE = { P3P2_PUBLIC_URL: 'https://p3p2.example.com' }

test('config: defaults', () => {
  const c = loadConfig(BASE)
  assert.deepEqual(c.limits, DEFAULT_LIMITS)
  assert.equal(c.statsToken, null)
  assert.equal(c.name, 'p3p2.example.com')
})

test('config: a rate brings its burst along', () => {
  const { limits } = loadConfig({ ...BASE, P3P2_MSG_RATE: '180', P3P2_CONNECT_RATE: '50', P3P2_API_RATE: '10' })
  assert.deepEqual([limits.msgRate, limits.msgBurst], [180, 240])
  assert.deepEqual([limits.connectRate, limits.connectBurst], [50, 2000])
  assert.deepEqual([limits.apiRate, limits.apiBurst], [10, 80])
})

test('config: the byte burst takes at least one frame as large as the server takes', () => {
  const MB = 1024 * 1024
  assert.equal(loadConfig(BASE).limits.bytesBurst, 512 * 1024)
  assert.equal(loadConfig({ ...BASE, P3P2_MAX_FRAME_BYTES: String(MB) }).limits.bytesBurst, MB)
  assert.equal(loadConfig({ ...BASE, P3P2_MAX_FRAME_BYTES: String(MB), P3P2_BYTES_RATE: String(MB) }).limits.bytesBurst, 2 * MB)
})

test('config: the log cap, the host grace period, and how long a member may go unheard are settings', () => {
  const { limits } = loadConfig({ ...BASE, P3P2_MAX_LOG_BYTES: '4194304', P3P2_HOST_GRACE_SECONDS: '0', P3P2_QUIET_SECONDS: '10' })
  assert.deepEqual([limits.maxLogBytes, limits.hostGraceMs, limits.quietMs], [4194304, 0, 10_000])
  assert.throws(() => loadConfig({ ...BASE, P3P2_QUIET_SECONDS: '0' }), /P3P2_QUIET_SECONDS/)
})

test('config: a bad setting is named', () => {
  assert.throws(() => loadConfig({ ...BASE, P3P2_CONNECT_RATE: 'fast' }), /P3P2_CONNECT_RATE/)
  assert.throws(() => loadConfig({ ...BASE, P3P2_STATS_TOKEN: 'short' }), /P3P2_STATS_TOKEN/)
  assert.throws(() => loadConfig({ P3P2_PUBLIC_URL: 'ftp://p3p2.example.com' }), /P3P2_PUBLIC_URL/)
  assert.equal(loadConfig({ ...BASE, P3P2_STATS_TOKEN: 'long-enough-token' }).statsToken, 'long-enough-token')
})

test('config: the source link is this repository unless set, and an http(s) address', () => {
  assert.equal(loadConfig(BASE).sourceUrl, 'https://github.com/doublependu/p3p2')
  assert.equal(SOURCE_URL, 'https://github.com/doublependu/p3p2')
  const changed = 'https://git.example.com/someone/p3p2-changed'
  assert.equal(loadConfig({ ...BASE, P3P2_SOURCE_URL: changed }).sourceUrl, changed)
  assert.throws(() => loadConfig({ ...BASE, P3P2_SOURCE_URL: 'javascript:alert(1)' }), /P3P2_SOURCE_URL/)
  assert.throws(() => loadConfig({ ...BASE, P3P2_SOURCE_URL: 'my fork' }), /P3P2_SOURCE_URL/)
  assert.throws(() => loadConfig({ ...BASE, P3P2_SOURCE_URL: `https://x.example/${'a'.repeat(400)}` }), /P3P2_SOURCE_URL/)
})
