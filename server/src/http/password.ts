import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const N = 16384
const R = 8
const P = 1
const KEY_BYTES = 32

export const PASSWORD_MIN: number = 8

function derive(password: string, salt: Buffer, n: number, r: number, p: number, bytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, bytes, { N: n, r, p }, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt, N, R, P, KEY_BYTES)
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split('$')
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !key) return false
  const want = Buffer.from(key, 'base64url')
  try {
    const got = await derive(password, Buffer.from(salt, 'base64url'), Number(n), Number(r), Number(p), want.length)
    return got.length === want.length && timingSafeEqual(got, want)
  } catch {
    return false
  }
}
