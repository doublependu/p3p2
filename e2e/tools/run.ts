// Runs the browser tests in two parts: first those that may run side by side, four at a time, then those tagged
// @alone, which time something, one at a time. Both parts always run, and the command fails if either did. What
// follows the run's name goes to Playwright: a file to run (`world`), `--headed`, and so on.
//
//   node tools/run.ts main       npm run e2e           all but the measurements (@measure) and the upgrade (@docker)
//   node tools/run.ts measure    npm run e2e:measure   the measurements alone, one at a time
//   node tools/run.ts clients    npm run e2e:clients   the main run with every released client in place of the checkout's
//   node tools/run.ts image      npm run e2e:image     the main run against the published image, then the upgrade
//   node tools/run.ts all        npm run e2e:all       the four, then a table of how long each took
//
// The tags: @alone (one at a time), @measure (what it costs the server), @docker (needs the published image),
// @this-client (something only the newest client does), @this-server (something only the checkout's server does).

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { releasedClients } from './clients.ts'
import { IMAGE } from './server.ts'
import type { Summary } from './summary.ts'

const E2E = join(import.meta.dirname, '..')
const CLI = join(E2E, '..', 'node_modules', 'playwright', 'cli.js')
const REPORTER = join(import.meta.dirname, 'summary.ts')

interface Run {
  name: string
  /** Only the tests with this tag, one at a time. Without it: everything else, in the two parts. */
  only?: string
  without: string[]
  env?: Record<string, string>
}

interface Done {
  run: string
  part: string
  summary: Summary
  ok: boolean
}

const scratch = mkdtempSync(join(tmpdir(), 'p3p2-e2e-run-'))
process.once('exit', () => rmSync(scratch, { recursive: true, force: true }))
rmSync(join(E2E, 'test-results'), { recursive: true, force: true })
let parts = 0

function part(run: Run, label: string, grep: string | undefined, without: string[], workers: number | undefined, args: string[]): Done {
  const file = join(scratch, `${parts}.json`)
  // A folder of its own for each part: Playwright empties its folder when it starts, and the traces of the part
  // before would go.
  const output = join(E2E, 'test-results', `${parts++}-${run.name}-${label}`.replace(/[^\w.-]+/g, '-').replace(/-+$/, ''))
  const flags = ['test', `--reporter=list,${REPORTER}`, '--pass-with-no-tests', '--output', output]
  if (grep) flags.push('--grep', grep)
  if (without.length) flags.push('--grep-invert', without.join('|'))
  if (workers) flags.push('--workers', String(workers))
  console.log(`\n── ${run.name}: ${label} ──`)
  const result = spawnSync(process.execPath, [CLI, ...flags, ...args], {
    cwd: E2E,
    stdio: 'inherit',
    env: { ...process.env, ...run.env, E2E_SUMMARY: file },
  })
  let summary: Summary
  try {
    summary = JSON.parse(readFileSync(file, 'utf8')) as Summary
  } catch {
    // Playwright stopped before its reporters ended: the setup failed, say.
    summary = { passed: 0, failed: 0, skipped: 0, known: 0, seconds: 0, status: 'failed' }
  }
  return { run: run.name, part: label, summary, ok: result.status === 0 && summary.status === 'passed' }
}

function execute(run: Run, args: string[]): Done[] {
  if (run.only) return [part(run, `only ${run.only}, one at a time`, run.only, run.without, 1, args)]
  return [
    part(run, 'side by side', undefined, ['@alone', ...run.without], undefined, args),
    part(run, 'one at a time (@alone)', '@alone', run.without, 1, args),
  ]
}

const MAIN: Run = { name: 'main', without: ['@measure', '@docker'] }
const MEASURE: Run = { name: 'measure', only: '@measure', without: ['@docker'] }
const IMAGE_RUN: Run = { name: 'image', without: ['@measure', '@this-server'], env: { E2E_SERVER: 'image' } }

function clients(args: string[]): Done[] {
  const done: Done[] = []
  const groups = releasedClients()
  if (!groups.length) console.log('\nEvery released client has the checkout\'s files: the main run has tested them.')
  for (const group of groups) {
    const name = `client ${group.versions.join(', ')}`
    done.push(...execute({ name, without: [...MAIN.without, '@this-client'], env: { E2E_CLIENT: group.tarball } }, args))
  }
  return done
}

function image(args: string[]): Done[] {
  console.log(`\nPulling ${IMAGE}…`)
  execFileSync('docker', ['pull', '--quiet', IMAGE], { stdio: 'inherit' })
  return execute(IMAGE_RUN, args)
}

function table(done: Done[]): void {
  const rows = done.map((d) => [
    d.run,
    d.part,
    String(d.summary.passed),
    String(d.summary.known),
    String(d.summary.failed),
    String(d.summary.skipped),
    `${d.summary.seconds.toFixed(0)} s`,
  ])
  const total = done.reduce((sum, d) => sum + d.summary.seconds, 0)
  rows.push(['', 'total', '', '', '', '', `${total.toFixed(0)} s (${(total / 60).toFixed(1)} min)`])
  const head = ['run', 'part', 'passed', 'known bugs', 'failed', 'skipped', 'time']
  const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)))
  const line = (cells: string[]) => cells.map((c, i) => (i >= 2 ? c.padStart(width[i]!) : c.padEnd(width[i]!))).join('  ')
  console.log(`\n${line(head)}\n${line(width.map((w) => '─'.repeat(w)))}`)
  for (const row of rows) console.log(line(row))
}

const [name, ...args] = process.argv.slice(2)
let done: Done[]
switch (name) {
  case 'main':
    done = execute(MAIN, args)
    break
  case 'measure':
    done = execute(MEASURE, args)
    break
  case 'clients':
    done = clients(args)
    break
  case 'image':
    done = image(args)
    break
  case 'all':
    done = [...execute(MAIN, args), ...execute(MEASURE, args), ...clients(args), ...image(args)]
    break
  default:
    console.error('Usage: node tools/run.ts main|measure|clients|image|all [what Playwright is given]')
    process.exit(2)
}
table(done)
process.exitCode = done.every((d) => d.ok) ? 0 : 1
