// Builds the examples that use Vite (world/, arena/, rally/) as a game's own project builds them: each in a folder
// of its own, outside this repository, with the client installed from a tarball into its node_modules, as npm
// installs it. Inside the checkout a missing copy would quietly fall back on the root's node_modules, which links
// to client/: a build "with 0.1.0" would then hold this checkout's client.
//
//   node examples/build.ts [client tarball] [out folder]
//
// Without a tarball it packs this checkout's client (`npm run build` first). `npm run examples` calls it.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

const HERE = import.meta.dirname
const ROOT = join(HERE, '..')
const VITE = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')

/** What is built: an example's folder, served at /<name>/, and the build id it gets. */
const BUILDS = [
  { name: 'world', from: 'world' },
  { name: 'arena', from: 'arena' },
  // The arena once more with another build id: a newer version of the game, which a room keeps apart.
  { name: 'arena-next', from: 'arena' },
  { name: 'rally', from: 'rally' },
]

export const NAMES: readonly string[] = BUILDS.map((b) => b.name)

/** This checkout's client, packed as npm would publish it, into `dest`. */
export function packCheckout(dest: string): string {
  if (!existsSync(join(ROOT, 'client', 'dist', 'p3p2.js'))) throw new Error('client/dist/ is missing: run "npm run build" first')
  mkdirSync(dest, { recursive: true })
  const out = execFileSync('npm', ['pack', '--workspace', '@p3p2/client', '--pack-destination', dest, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const [info] = JSON.parse(out) as { filename: string }[]
  return join(dest, info!.filename)
}

/** The files a build is made from, so that a build is made again when one of them changes. */
function sources(): string[] {
  const files = [join(HERE, 'build.ts')]
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === 'node_modules' || name === 'dist') continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else files.push(path)
    }
  }
  for (const from of new Set(BUILDS.map((b) => b.from))) walk(join(HERE, from))
  return files
}

export interface Built {
  /** The built pages: <dir>/world/, <dir>/arena/, … */
  dir: string
  /** Each example's project as it was built, with the client in its node_modules: for Vite's dev server. */
  projects: string
  /** The build id of each build. */
  ids: Record<string, string>
}

/**
 * Builds every Vite example with the client in `tarball`, into `out`. A build of the same client and the same
 * sources is kept, and not made again.
 */
export function buildExamples(tarball: string, out: string): Built {
  const key = createHash('sha256').update(readFileSync(tarball))
  for (const file of sources()) key.update(`${relative(HERE, file)}\0`).update(readFileSync(file)).update('\0')
  const hash = key.digest('hex').slice(0, 16)
  const dir = join(out, hash)
  const projects = join(dir, 'projects')
  // Two builds of a game, as two deploys of it: each has an id of its own, as `game.version`.
  const ids = Object.fromEntries(BUILDS.map((b, i) => [b.name, `${hash.slice(0, 8)}-${i}`]))
  if (existsSync(join(dir, 'done'))) return { dir, projects, ids }

  rmSync(dir, { recursive: true, force: true })
  for (const { name, from } of BUILDS) {
    const project = join(projects, name)
    cpSync(join(HERE, from), project, { recursive: true, filter: (src) => !/[\\/](node_modules|dist)$/.test(src) })
    const client = join(project, 'node_modules', '@p3p2', 'client')
    mkdirSync(client, { recursive: true })
    execFileSync('tar', ['-xzf', tarball, '-C', client, '--strip-components=1'])
    execFileSync(process.execPath, [VITE, 'build', '--outDir', join(dir, name), '--emptyOutDir', '--logLevel', 'warn'], {
      cwd: project,
      env: { ...process.env, BUILD_ID: ids[name] },
      stdio: ['ignore', 'inherit', 'inherit'],
    })
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'done'), '')
  return { dir, projects, ids }
}

if (import.meta.main) {
  const out = process.argv[3] ?? join(tmpdir(), 'p3p2-examples')
  const tarball = process.argv[2] ?? packCheckout(join(out, 'client'))
  const built = buildExamples(tarball, out)
  console.log(built.dir)
}
