// The load generator's command line. `npm run bench` prints what it can do.

import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, release, totalmem } from 'node:os'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { type Found, findLimit, GENERATOR_LATE, overLimit, overTarget } from './limits.ts'
import { Admin, Load, ROOM_MAX, ServerGone } from './load.ts'
import { PROFILES } from './profiles.ts'
import { line, mb, percent, type SoakSample, soakSummary, soakText, table } from './report.ts'
import { startTarget, type Target } from './target.ts'
import type { ProfileName, Result } from './types.ts'

const HELP = `Load generator for a p3p2 server.

  npm run bench -- <command> [profile] [options]

Commands
  run <profile>       one measurement: --rooms rooms of --members members, for --seconds
  sweep <profile>     one room at each of --sizes
  ramp <profile>      more and more rooms of --members, to find the limit
  idle                the memory of members that only keep their connection
  soak                the mixed profile for --hours, one line per --sample seconds into --out
  soak-report <file>  the summary of a soak file, finished or not
  all                 sweep and ramp for chat, presence, snapshots and ops, then idle; into --json

Profiles
${Object.entries(PROFILES)
  .map(([name, p]) => `  ${name.padEnd(10)} ${p.about}`)
  .join('\n')}

Options
  --target docker|local|<url>   where the server runs (docker): a container with --cpus and
                                --memory, a process on this machine, or a running server
                                (then set BENCH_PASSWORD and BENCH_STATS_TOKEN)
  --cpus 1  --memory 512m       the container's size
  --rooms 1  --members 20       the load of "run"; --members is also the room size of "ramp"
  --seconds 60  --warmup 20     how long to measure, and how long to wait before
                                (a step of "ramp": 20 and 5)
  --sizes 8,16,20,32,64         room sizes of "sweep"
  --max-rooms 500               where "ramp" gives up
  --idle 1000                   members of "idle"
  --hours 24  --sample 60       length of "soak", and seconds per line
  --out <file>                  the soak file (bench/results/soak-<date>.jsonl)
  --json <file>                 also write the results as JSON
  --workers 4                   generator threads
  --speed 1                     multiplies every rate of the profile
  --name <name>                 container name, for two runs at once
  --profile-dir <dir>           with --target local: the server writes a CPU profile there`

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    target: { type: 'string', default: 'docker' },
    cpus: { type: 'string', default: '1' },
    memory: { type: 'string', default: '512m' },
    rooms: { type: 'string', default: '1' },
    members: { type: 'string', default: '20' },
    seconds: { type: 'string' },
    warmup: { type: 'string' },
    sizes: { type: 'string', default: '8,16,20,32,64' },
    'max-rooms': { type: 'string', default: '500' },
    idle: { type: 'string', default: '1000' },
    hours: { type: 'string', default: '24' },
    sample: { type: 'string', default: '60' },
    out: { type: 'string' },
    json: { type: 'string' },
    workers: { type: 'string', default: '4' },
    speed: { type: 'string', default: '1' },
    name: { type: 'string' },
    'profile-dir': { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

function fail(message: string): never {
  console.error(`bench: ${message}`)
  process.exit(1)
}

function number(name: keyof typeof flags, fallback?: number): number {
  const raw = flags[name]
  if (raw === undefined && fallback !== undefined) return fallback
  const n = Number(raw)
  if (typeof raw !== 'string' || !Number.isFinite(n) || n <= 0) fail(`--${name} must be a number above 0`)
  return n
}

const [command, argument] = positionals
const ROOT = join(import.meta.dirname, '..', '..')
// The local date as YYYY-MM-DD, which is how the Swedish locale writes it.
const today = new Date().toLocaleDateString('sv')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const warmup = (fallback: number) => sleep(number('warmup', fallback) * 1000)
const log = (text: string) => console.error(text)

function profile(): ProfileName {
  if (!argument || !(argument in PROFILES)) fail(`"${command}" needs a profile: ${Object.keys(PROFILES).join(', ')}`)
  return argument as ProfileName
}

// ---- starting and stopping ----

/** What to undo if the run is interrupted: threads to stop, a container to remove. */
const undo = new Set<() => Promise<void>>()

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.once(signal, async () => {
    log(`\n${signal}: stopping …`)
    for (const fn of [...undo].reverse()) await fn().catch(() => {})
    process.exit(130)
  })
}

async function withTarget<T>(fn: (target: Target) => Promise<T>, name: string = 'p3p2-bench'): Promise<T> {
  const target = await startTarget({
    target: flags.target,
    name: flags.name ?? name,
    cpus: flags.cpus,
    memory: flags.memory,
    profileDir: flags['profile-dir'],
  })
  const stop = () => target.stop()
  undo.add(stop)
  try {
    return await fn(target)
  } finally {
    undo.delete(stop)
    await stop()
  }
}

async function withLoad<T>(target: Target, name: ProfileName, members: number, fn: (load: Load) => Promise<T>): Promise<T> {
  if (!Number.isInteger(members) || members > ROOM_MAX) fail(`a room holds 1 to ${ROOM_MAX} members, not ${members}`)
  const load = await Load.start(target, { profile: name, members, workers: number('workers'), speed: number('speed') })
  const stop = () => load.close()
  undo.add(stop)
  try {
    return await fn(load)
  } finally {
    undo.delete(stop)
    await stop()
  }
}

// ---- commands ----

async function run(target: Target, name: ProfileName, rooms: number, members: number, seconds: number): Promise<Result> {
  return withLoad(target, name, members, async (load) => {
    await load.scale(rooms)
    // Long enough for the server's hot paths to be compiled: its first seconds cost more CPU.
    await warmup(20)
    const r = await load.measure(seconds)
    log(`  ${line(r)}`)
    return r
  })
}

async function sweep(target: Target, name: ProfileName): Promise<Result[]> {
  const sizes = flags.sizes.split(',').map(Number)
  if (sizes.some((n) => !Number.isInteger(n) || n < 1)) fail('--sizes must be whole numbers, like 8,16,20')
  log(`${name}: one room, at ${sizes.join(', ')} members`)
  const results: Result[] = []
  for (const size of sizes) results.push(await run(target, name, 1, size, number('seconds', 60)))
  return results
}

interface Ramp {
  /** Every size tried, smallest first, and why it was over the limit when it was. */
  steps: { result: Result; why: string | null }[]
  found: Found
  /** Set when the search ended for another reason than the limit. */
  note: string | null
}

async function ramp(target: Target, name: ProfileName): Promise<Ramp> {
  const members = number('members')
  const max = number('max-rooms')
  log(`${name}: rooms of ${members}, up to ${max}`)
  return withLoad(target, name, members, async (load) => {
    const steps: Ramp['steps'] = []
    let note: string | null = null
    let found: Found
    const ok = async (rooms: number) => {
      await load.scale(rooms)
      await warmup(5)
      const result = await load.measure(number('seconds', 20))
      let why = overLimit(result)
      if (result.generatorLoopP99 > GENERATOR_LATE) {
        note = `at ${rooms} rooms the generator itself ran ${result.generatorLoopP99.toFixed(0)} ms late: its numbers there say little about the server`
        why = why ? `${why}, generator late` : 'generator late'
      }
      steps.push({ result, why })
      log(`  ${line(result)}${why ? `  ✗ ${why}` : ''}`)
      return why === null
    }
    try {
      found = await findLimit(ok, max)
    } catch (err) {
      if (!(err instanceof ServerGone)) throw err
      // The server did not survive this size. What passed before still stands.
      note = `at ${load.rooms} rooms ${err.message}`
      found = { pass: Math.max(0, ...steps.filter((s) => !s.why).map((s) => s.result.rooms)), fail: load.rooms }
    }
    steps.sort((a, b) => a.result.rooms - b.result.rooms)
    return { steps, found, note }
  })
}

function rampText(name: ProfileName, r: Ramp): string {
  const members = number('members')
  const limit = r.found.fail === null ? `no limit up to ${r.found.pass} rooms (${r.found.pass * members} members)` : `within the limit at ${r.found.pass} rooms (${r.found.pass * members} members), over it at ${r.found.fail}`
  return [`${name}: ${limit}${r.note ? `; ${r.note}` : ''}`, '', table(r.steps.map((s) => s.result), (x) => r.steps.find((s) => s.result === x)?.why ?? 'ok')].join('\n')
}

interface Idle {
  /** RSS of the server with nobody connected, bytes. */
  empty: number
  /** With `--idle` members, then with twice as many. */
  steps: Result[]
  /** Bytes of RSS per member: of the first batch, which pays for one-time growth too, and of the second. */
  perMemberFirst: number
  perMemberNext: number
}

async function idle(target: Target): Promise<Idle> {
  const members = 20
  const batch = Math.ceil(number('idle') / members)
  log(`idle: ${batch * members} members, then ${2 * batch * members}`)
  return withLoad(target, 'idle', members, async (load) => {
    await sleep(3000)
    const empty = (await load.admin.stats()).memory.rss
    const steps: Result[] = []
    for (const rooms of [batch, 2 * batch]) {
      await load.scale(rooms)
      await sleep(10_000)
      const r = await load.measure(number('seconds', 60))
      log(`  ${line(r)}`)
      steps.push(r)
    }
    const [first, next] = steps as [Result, Result]
    return {
      empty,
      steps,
      perMemberFirst: (first.rss - empty) / first.connections,
      perMemberNext: (next.rss - first.rss) / (next.connections - first.connections),
    }
  })
}

function idleText(r: Idle): string {
  const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`
  return [
    `idle: ${mb(r.empty)} with nobody connected`,
    ...r.steps.map((s) => `  ${s.connections} members: RSS ${mb(s.rss)}, JS heap ${mb(s.heapUsed)}, CPU ${percent(s.cpu)}, ping p99 ${s.series.ping?.p99.toFixed(2)} ms`),
    `  per member: ${kb(r.perMemberFirst)} for the first ${r.steps[0]?.connections}, ${kb(r.perMemberNext)} for the next ${r.steps[0]?.connections}`,
  ].join('\n')
}

/** Versions and hardware, so the numbers can be read later. */
async function environment(target: Target): Promise<Record<string, unknown>> {
  const git = (...args: string[]) => {
    try {
      return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
    } catch {
      return ''
    }
  }
  const stats = await new Admin(target).stats()
  return {
    date: new Date().toISOString(),
    commit: git('rev-parse', '--short', 'HEAD') + (git('status', '--porcelain') ? ' + uncommitted changes' : ''),
    server: { version: stats.version, node: stats.node, where: target.where },
    generator: { node: process.version, workers: number('workers'), speed: number('speed') },
    machine: { cpu: cpus()[0]?.model, cores: cpus().length, memoryGb: Math.round(totalmem() / 2 ** 30), kernel: release() },
  }
}

function save(data: unknown): void {
  if (!flags.json) return
  mkdirSync(dirname(flags.json), { recursive: true })
  writeFileSync(flags.json, `${JSON.stringify(data, null, 1)}\n`)
  log(`Results written to ${flags.json}`)
}

async function soak(): Promise<void> {
  const out = flags.out ?? join(ROOT, 'bench', 'results', `soak-${today}.jsonl`)
  const hours = number('hours')
  const sample = number('sample')
  mkdirSync(dirname(out), { recursive: true })
  await withTarget(async (target) => {
    writeFileSync(out, `${JSON.stringify({ soak: { hours, sample, members: number('members'), ...(await environment(target)) } })}\n`)
    log(`soak: ${hours} hours of "${PROFILES.mixed.about}"\n  one line every ${sample} s into ${out}`)
    await withLoad(target, 'mixed', number('members'), async (load) => {
      await load.scale(number('rooms'))
      const start = performance.now()
      const elapsed = () => (performance.now() - start) / 3600_000
      while (elapsed() < hours) {
        try {
          const r = await load.measure(sample)
          const row: SoakSample = { at: new Date().toISOString(), hours: elapsed(), ...r }
          appendFileSync(out, `${JSON.stringify(row)}\n`)
        } catch (err) {
          if (!(err instanceof ServerGone)) throw err
          appendFileSync(out, `${JSON.stringify({ at: new Date().toISOString(), hours: elapsed(), gone: err.message })}\n`)
          log(`soak: ${err.message}`)
          break
        }
      }
    })
  }, 'p3p2-soak')
  soakReport(out)
}

function soakReport(file: string): void {
  const rows = readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((text) => JSON.parse(text) as Partial<SoakSample> & { gone?: string })
  const samples = rows.filter((r): r is SoakSample => r.cpu !== undefined)
  if (!samples.length) fail(`${file} holds no samples yet`)
  console.log(soakText(soakSummary(samples)))
  const gone = rows.find((r) => r.gone)
  if (gone) console.log(`  The run ended early: ${gone.gone}`)
}

async function main(): Promise<void> {
  if (flags.help || !command) return console.log(HELP)
  switch (command) {
    case 'run': {
      const name = profile()
      const r = await withTarget((target) => run(target, name, number('rooms'), number('members'), number('seconds', 60)))
      console.log(table([r]))
      return save(r)
    }
    case 'sweep': {
      const name = profile()
      const results = await withTarget((target) => sweep(target, name))
      console.log(table(results, (r) => (r.members === 20 ? (overTarget(r) ?? 'meets the target') : '')))
      return save(results)
    }
    case 'ramp': {
      const name = profile()
      const r = await withTarget((target) => ramp(target, name))
      console.log(rampText(name, r))
      return save(r)
    }
    case 'idle': {
      const r = await withTarget(idle)
      console.log(idleText(r))
      return save(r)
    }
    case 'soak':
      return soak()
    case 'soak-report':
      if (!argument) fail('soak-report needs the soak file')
      return soakReport(argument)
    case 'all': {
      flags.json ??= join(ROOT, 'bench', 'results', `${today}.json`)
      const names: ProfileName[] = ['chat', 'presence', 'snapshots', 'ops']
      const all = {
        environment: await withTarget(environment),
        sweeps: {} as Record<string, Result[]>,
        ramps: {} as Record<string, Ramp>,
        idle: null as Idle | null,
      }
      // A fresh server for every experiment, so none inherits the last one's memory.
      for (const name of names) all.sweeps[name] = await withTarget((target) => sweep(target, name))
      for (const name of names) all.ramps[name] = await withTarget((target) => ramp(target, name))
      all.idle = await withTarget(idle)
      save(all)
      for (const name of names) {
        console.log(`\n### ${name}: one room\n\n${table(all.sweeps[name]!, (r) => (r.members === 20 ? (overTarget(r) ?? 'meets the target') : ''))}`)
      }
      for (const name of names) console.log(`\n### ${rampText(name, all.ramps[name]!)}`)
      console.log(`\n### ${idleText(all.idle)}`)
      return
    }
    default:
      fail(`unknown command "${command}"; run it without arguments for help`)
  }
}

try {
  await main()
} catch (err) {
  fail(err instanceof Error ? err.message : String(err))
}
// Sockets and threads that are still closing must not keep the process around.
process.exit(0)
