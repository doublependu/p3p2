// The client as npm packs it, installed in a game's project of its own: what `npm install @p3p2/client` hands a
// game. The other tests load client/dist/ from the repository; this one uses only what is in the tarball.
//
// Run `npm run build` first. Needs Chrome, as the browser tests do, and no network: the client has no
// dependencies, and tsc and vite are this repository's.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { extname, join, normalize, sep } from 'node:path'
import { after, before, test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { type Browser, chromium, type Page } from '@playwright/test'

const ROOT = join(import.meta.dirname, '..', '..')
const BIN = join(ROOT, 'node_modules', '.bin')

/** The game's project. */
let game: string
/** The files in the tarball, as npm lists them. */
let packed: string[]

function run(command: string, args: string[], cwd: string): string {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string }
    throw new Error(`${command} ${args.join(' ')} failed:\n${e.stdout ?? ''}${e.stderr ?? ''}`)
  }
}

function write(file: string, text: string): void {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, text)
}

// A page that uses all three ways in, and the types a game names.
const PAGE = `import { P3P2, type Member, type P3P2Error, type Room } from '@p3p2/client'
import { pack, unpack } from '@p3p2/client/pack'
import { Smooth } from '@p3p2/client/smooth'

declare global {
  interface Window {
    p3p2: P3P2
    seen: unknown
  }
}

const p3p2 = new P3P2({ game: { id: 'packed', version: '1' }, ui: { corner: 'top-left' } })
const friends = new Smooth({ angles: [2] })
p3p2.on('room', (room: Room) => {
  room.presence.set({ x: 1, z: 2, yaw: 0 })
  room.presence.on((member: Member, p: unknown, at: number) => {
    if (p) friends.set(member.id, [1, 2, 0], at)
    else friends.delete(member.id)
  })
})
p3p2.start().catch((err: P3P2Error) => console.error(err.code))
window.p3p2 = p3p2

// A room of one, which is a lazy chunk of the game's build, and a value through pack and unpack.
const room = await P3P2.local('Ada')
window.seen = await unpack(await pack({ members: room.members.map((m) => m.name) }))
`

before(() => {
  game = mkdtempSync(join(tmpdir(), 'p3p2-packed-'))
  if (!existsSync(join(ROOT, 'client', 'dist', 'p3p2.js'))) throw new Error('client/dist/ is missing: run "npm run build" first')
  const out = run('npm', ['pack', '--workspace', '@p3p2/client', '--pack-destination', game, '--json'], ROOT)
  const [info] = JSON.parse(out) as { filename: string; files: { path: string }[] }[]
  packed = info!.files.map((f) => f.path).sort()
  write(join(game, 'package.json'), JSON.stringify({ name: 'a-game', private: true, type: 'module' }))
  run('npm', ['install', join(game, info!.filename), '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], game)
  write(join(game, 'src', 'main.ts'), PAGE)
})

after(() => rmSync(game, { recursive: true, force: true }))

test('the tarball holds the built library and its notices, and nothing else', () => {
  for (const f of ['package.json', 'README.md', 'LICENSE', 'dist/p3p2.js', 'dist/p3p2.iife.js', 'dist/types/index.d.ts']) {
    assert.ok(packed.includes(f), `${f} is missing from the tarball`)
  }
  const stray = packed.filter((f) => !/^(package\.json|README\.md|LICENSE|dist\/[\w.-]+\.js(\.map)?|dist\/types\/\w+\.d\.ts)$/.test(f))
  assert.deepEqual(stray, [])
  // lean-qr's notice travels with the files that carry its code.
  const dist = join(game, 'node_modules', '@p3p2', 'client', 'dist')
  for (const f of ['p3p2-qr.js', 'p3p2.iife.js']) assert.match(readFileSync(join(dist, f), 'utf8'), /^\/\*! Includes lean-qr, MIT License/)
  assert.match(readFileSync(join(game, 'node_modules', '@p3p2', 'client', 'LICENSE'), 'utf8'), /Copyright \(c\) 2021-2025 David Evans/)
})

test('the declarations import nothing outside the package', () => {
  const types = join(game, 'node_modules', '@p3p2', 'client', 'dist', 'types')
  for (const file of readdirSync(types)) {
    const text = readFileSync(join(types, file), 'utf8')
    for (const [, spec] of text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      assert.ok(spec!.startsWith('./'), `${file} imports ${spec}`)
    }
  }
})

test('every export resolves, and the helpers run in Node', () => {
  const script = `
    const paths = {}
    for (const s of ['@p3p2/client', '@p3p2/client/smooth', '@p3p2/client/pack', '@p3p2/client/iife', '@p3p2/client/package.json']) {
      paths[s] = new URL(import.meta.resolve(s)).pathname
    }
    const { pack, unpack } = await import('@p3p2/client/pack')
    const { Smooth } = await import('@p3p2/client/smooth')
    const smooth = new Smooth()
    smooth.set(1, [5])
    const value = { seed: 42, blocks: Array.from({ length: 200 }, (_, i) => [i, i * 2]) }
    console.log(JSON.stringify({ paths, back: await unpack(await pack(value)), drawn: smooth.get(1) }))
  `
  const out = JSON.parse(run(process.execPath, ['--input-type=module', '-e', script], game)) as {
    paths: Record<string, string>
    back: unknown
    drawn: number[]
  }
  const installed = join(game, 'node_modules', '@p3p2', 'client')
  for (const [spec, path] of Object.entries(out.paths)) {
    assert.ok(path.startsWith(installed + sep), `${spec} resolved outside the package: ${path}`)
    assert.ok(statSync(path).isFile(), `${spec} resolved to ${path}, which is not there`)
  }
  assert.deepEqual(out.back, { seed: 42, blocks: Array.from({ length: 200 }, (_, i) => [i, i * 2]) })
  assert.deepEqual(out.drawn, [5])
})

for (const resolution of ['bundler', 'nodenext'] as const) {
  test(`a page type-checks against it (moduleResolution ${resolution})`, () => {
    const config = join(game, `tsconfig.${resolution}.json`)
    write(
      config,
      JSON.stringify({
        compilerOptions: {
          target: 'es2022',
          module: resolution === 'bundler' ? 'esnext' : 'nodenext',
          moduleResolution: resolution,
          lib: ['es2023', 'dom', 'dom.iterable'],
          strict: true,
          noEmit: true,
          // The package's own declarations are checked too, as a strict game would.
          skipLibCheck: false,
          types: [],
        },
        include: ['src'],
      }),
    )
    run(join(BIN, 'tsc'), ['-p', config], game)
  })
}

test('a Vite build of the page works, and keeps the lazy parts lazy', () => {
  write(join(game, 'index.html'), '<!doctype html><title>a game</title><link rel="icon" href="data:,"><script type="module" src="/src/main.ts"></script>')
  // As docs/integrate.md says.
  write(join(game, 'vite.config.js'), "export default { optimizeDeps: { exclude: ['@p3p2/client'] }, logLevel: 'warn' }\n")
  run(join(BIN, 'vite'), ['build'], game)
  const html = readFileSync(join(game, 'dist', 'index.html'), 'utf8')
  const entry = html.match(/src="\/(assets\/[^"]+\.js)"/)?.[1]
  assert.ok(entry, 'no entry script in the built page')
  const chunks = readdirSync(join(game, 'dist', 'assets')).filter((f) => f.endsWith('.js'))
  // The entry, the room client and panel, the QR code and the local room: one file would be all of it on every visit.
  assert.ok(chunks.length >= 3, `the build has ${chunks.length} scripts: ${chunks.join(', ')}`)
  const kb = gzipSync(readFileSync(join(game, 'dist', entry))).length / 1024
  assert.ok(kb < 6, `the entry is ${kb.toFixed(1)} KB gzipped: the room client went into it`)
})

// ---- in a browser ----

let server: Server
let base: string
let browser: Browser

/** The built page at /, and the installed package under /node_modules/. */
function serve(): Promise<void> {
  const roots: [string, string][] = [
    ['/node_modules/', join(game, 'node_modules')],
    ['/', join(game, 'dist')],
  ]
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.map': 'application/json' }
  server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
    if (path.endsWith('/')) path += 'index.html'
    for (const [prefix, dir] of roots) {
      if (!path.startsWith(prefix)) continue
      const file = normalize(join(dir, path.slice(prefix.length)))
      if (!file.startsWith(dir + sep) || !existsSync(file) || !statSync(file).isFile()) break
      res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' })
      createReadStream(file).pipe(res)
      return
    }
    res.writeHead(404).end()
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      resolve()
    }),
  )
}

/** A page, with every error it reports collected. */
async function open(path: string): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()))
  page.on('requestfailed', (req) => errors.push(`${req.url()}: ${req.failure()?.errorText}`))
  page.on('response', (res) => res.status() >= 400 && errors.push(`${res.url()}: ${res.status()}`))
  await page.goto(`${base}${path}`)
  return { page, errors }
}

test('in Chrome', async (t) => {
  await serve()
  browser = await chromium.launch({ channel: 'chrome' })
  t.after(async () => {
    await browser.close()
    server.close()
  })

  await t.test('the IIFE loads from a <script> tag', async () => {
    write(
      join(game, 'dist', 'iife.html'),
      `<!doctype html><title>no bundler</title><link rel="icon" href="data:,">
<script src="/node_modules/@p3p2/client/dist/p3p2.iife.js"></script>
<script>window.p3p2 = new P3P2({ game: { id: 'packed', version: '1' } })</script>`,
    )
    const { page, errors } = await open('/iife.html')
    const has = await page.evaluate(() => {
      const P = (window as unknown as { P3P2: { Smooth: unknown; pack: unknown; unpack: unknown } }).P3P2
      return [typeof P, typeof P.Smooth, typeof P.pack, typeof P.unpack]
    })
    assert.deepEqual(has, ['function', 'function', 'function', 'function'])
    await page.getByRole('button', { name: 'Multiplayer' }).waitFor()
    assert.deepEqual(errors, [])
  })

  await t.test('the page built by Vite opens its panel and a room of one', async () => {
    const { page, errors } = await open('/')
    await page.waitForFunction(() => (window as unknown as { seen?: unknown }).seen !== undefined)
    assert.deepEqual(await page.evaluate(() => (window as unknown as { seen: unknown }).seen), { members: ['Ada'] })
    // The panel is a lazy chunk of the game's build, fetched from the game's own site.
    await page.getByRole('button', { name: 'Multiplayer' }).click()
    await page.getByRole('dialog', { name: 'Multiplayer' }).waitFor()
    assert.deepEqual(errors, [])
  })
})
