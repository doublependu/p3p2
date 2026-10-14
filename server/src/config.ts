import { networkInterfaces } from 'node:os'
import { DEFAULT_LIMITS, type Limits } from './core/limits.ts'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

export interface Config {
  /** How the outside world reaches this server. Room URLs are built from it. */
  publicUrl: string
  name: string
  port: number
  /** Address to listen on. */
  host: string
  /** Directory for the database, or ':memory:' for a throwaway server. */
  dataDir: string
  logLevel: LogLevel
  /** Behind a reverse proxy: take the client address from X-Forwarded-For. */
  trustProxy: boolean
  ownerPassword: string | null
  /** Who knows it may read /api/v1/stats. Without one the endpoint does not exist. */
  statsToken: string | null
  limits: Limits
}

type Env = Record<string, string | undefined>

function number(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[`P3P2_${name}`]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`P3P2_${name} must be a number between ${min} and ${max}, got "${raw}"`)
  }
  return n
}

/** This machine's address on the local network, for phones on the same Wi-Fi. */
export function lanAddress(): string {
  for (const [name, list] of Object.entries(networkInterfaces())) {
    if (/^(docker|br-|veth|virbr|tailscale)/.test(name)) continue
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address
  }
  return 'localhost'
}

export function loadConfig(env: Env = process.env): Config {
  const d = DEFAULT_LIMITS
  const port = number(env, 'PORT', 8080, 0, 65535)
  const publicUrl = (env.P3P2_PUBLIC_URL || `http://${lanAddress()}:${port}`).replace(/\/+$/, '')
  const parsed = new URL(publicUrl)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`P3P2_PUBLIC_URL must start with http:// or https://, got "${publicUrl}"`)
  }
  const level = (env.P3P2_LOG_LEVEL || 'info') as LogLevel
  if (!['debug', 'info', 'warn', 'error', 'silent'].includes(level)) {
    throw new Error(`P3P2_LOG_LEVEL must be debug, info, warn, error or silent, got "${level}"`)
  }
  const statsToken = env.P3P2_STATS_TOKEN || null
  if (statsToken && !/^[\x21-\x7e]{16,128}$/.test(statsToken)) {
    throw new Error('P3P2_STATS_TOKEN must be 16 to 128 characters, without spaces')
  }
  const msgRate = number(env, 'MSG_RATE', d.msgRate, 1, 10_000)
  const bytesRate = number(env, 'BYTES_RATE', d.bytesRate, 1024, 1 << 30)
  const connectRate = number(env, 'CONNECT_RATE', d.connectRate, 0.01, 100_000)
  const apiRate = number(env, 'API_RATE', d.apiRate, 0.01, 100_000)
  const maxMembersCap = d.maxMembersCap
  return {
    publicUrl,
    name: env.P3P2_NAME || parsed.host,
    port,
    host: env.P3P2_HOST || '0.0.0.0',
    dataDir: env.P3P2_DATA_DIR || 'data',
    logLevel: level,
    trustProxy: /^(1|true|yes)$/i.test(env.P3P2_TRUST_PROXY ?? ''),
    ownerPassword: env.P3P2_OWNER_PASSWORD || null,
    statsToken,
    limits: {
      ...d,
      maxFrameBytes: number(env, 'MAX_FRAME_BYTES', d.maxFrameBytes, 1024, 16 * 1024 * 1024),
      msgRate,
      msgBurst: Math.ceil((msgRate * d.msgBurst) / d.msgRate),
      bytesRate,
      bytesBurst: bytesRate * 2,
      maxMembers: number(env, 'MAX_MEMBERS', d.maxMembers, 1, maxMembersCap),
      maxRooms: number(env, 'MAX_ROOMS', d.maxRooms, 1, 100_000),
      graceMs: number(env, 'GRACE_SECONDS', d.graceMs / 1000, 0, 3600) * 1000,
      hostGraceMs: number(env, 'HOST_GRACE_SECONDS', d.hostGraceMs / 1000, 0, 3600) * 1000,
      quietMs: number(env, 'QUIET_SECONDS', d.quietMs / 1000, 1, 3600) * 1000,
      maxRetainedBytes: number(env, 'MAX_RETAINED_BYTES', d.maxRetainedBytes, 0, 1 << 30),
      maxLogBytes: number(env, 'MAX_LOG_BYTES', d.maxLogBytes, 0, 1 << 30),
      inviteTtlMs: number(env, 'INVITE_TTL_HOURS', d.inviteTtlMs / 3600_000, 0.001, 24 * 365) * 3600_000,
      presenceHz: number(env, 'PRESENCE_HZ', d.presenceHz, 1, 60),
      connectRate,
      connectBurst: Math.ceil((connectRate * d.connectBurst) / d.connectRate),
      apiRate,
      apiBurst: Math.ceil((apiRate * d.apiBurst) / d.apiRate),
    },
  }
}
