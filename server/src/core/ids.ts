import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz'

/** `chars` characters of Crockford base32 (5 random bits each), lower case. */
export function randomBase32(chars: number): string {
  const bytes = randomBytes(chars)
  let out = ''
  for (let i = 0; i < chars; i++) out += CROCKFORD[bytes[i]! & 31]
  return out
}

/** 130 random bits. The room key is the hosting capability. */
export function newRoomKey(): string {
  return randomBase32(26)
}

/** 50 random bits. Join-only, expiring, revocable. */
export function newInviteCode(): string {
  return randomBase32(10)
}

export function newToken(): string {
  return randomBytes(18).toString('base64url')
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('base64url')
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** For logs: never print a whole key or code. */
export function redact(secret: string): string {
  return `${secret.slice(0, 4)}…`
}
