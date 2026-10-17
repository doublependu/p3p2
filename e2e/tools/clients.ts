// The client under test, and every client released on npm.
//
// A test run gets one client, as the tarball npm would hand a game: the checkout's, packed (`npm run build` first),
// or the one E2E_CLIENT names. Everything is kept in the system's temporary folder, outside the repository: a game
// built inside the checkout would find the checkout's client through the root's node_modules, and a run "against
// 0.1.0" would quietly test the checkout.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { packCheckout } from '../../examples/build.ts'

/** Where the tests keep what they make: client tarballs, unpacked clients, and builds of the examples. */
export const CACHE = join(tmpdir(), 'p3p2-e2e')
/** On npm, and never a client: placeholders from before the first release. */
const PLACEHOLDERS = new Set(['0.0.0-stage', '0.0.1'])

function npm(args: string[]): string {
  return execFileSync('npm', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/** The checkout's client, packed as npm would publish it. */
function checkout(): string {
  const dest = join(CACHE, 'checkout')
  rmSync(dest, { recursive: true, force: true })
  return packCheckout(dest)
}

export interface Client {
  tarball: string
  /** The package, unpacked: package.json, dist/, … */
  dir: string
  version: string
  /** Of the tarball's bytes: npm packs the same files into the same bytes. */
  hash: string
}

/** A client tarball, unpacked once into the cache. */
export function unpack(tarball: string): Client {
  const hash = sha256(readFileSync(tarball)).slice(0, 16)
  const dir = join(CACHE, 'clients', hash, 'package')
  if (!existsSync(join(dir, 'package.json'))) {
    const into = join(CACHE, 'clients', `${hash}.partial`)
    rmSync(into, { recursive: true, force: true })
    mkdirSync(into, { recursive: true })
    execFileSync('tar', ['-xzf', tarball, '-C', into])
    rmSync(join(CACHE, 'clients', hash), { recursive: true, force: true })
    renameSync(into, join(CACHE, 'clients', hash))
  }
  const { version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string }
  return { tarball, dir, version, hash }
}

/** The client this run tests: the tarball E2E_CLIENT names, or the checkout's. */
export function clientUnderTest(): Client {
  return unpack(process.env.E2E_CLIENT || checkout())
}

/** What a client's files are, but for the version in its package.json: two releases of the same files share it. */
function fingerprint(client: Client): string {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else files.push(path)
    }
  }
  walk(client.dir)
  const hash = createHash('sha256')
  for (const file of files) {
    const name = relative(client.dir, file)
    if (name === 'package.json') continue
    hash.update(`${name}\0`).update(readFileSync(file)).update('\0')
  }
  return hash.digest('hex')
}

export interface ClientGroup {
  /** Released versions whose files are the same. */
  versions: string[]
  /** The newest of them. */
  tarball: string
}

/**
 * Every client released on npm, grouped by their files, less the group whose files are the checkout's: the main
 * run tests that one. A new release joins by itself.
 */
export function releasedClients(): ClientGroup[] {
  const versions = (JSON.parse(npm(['view', '@p3p2/client', 'versions', '--json'])) as string[]).filter((v) => !PLACEHOLDERS.has(v))
  const dest = join(CACHE, 'released')
  mkdirSync(dest, { recursive: true })
  const groups = new Map<string, ClientGroup>()
  for (const version of versions) {
    const tarball = join(dest, `p3p2-client-${version}.tgz`)
    if (!existsSync(tarball)) npm(['pack', `@p3p2/client@${version}`, '--pack-destination', dest, '--silent'])
    const print = fingerprint(unpack(tarball))
    const group = groups.get(print)
    if (group) {
      group.versions.push(version)
      group.tarball = tarball
    } else groups.set(print, { versions: [version], tarball })
  }
  groups.delete(fingerprint(unpack(checkout())))
  return [...groups.values()]
}
