// The code in the documents for game developers is type-checked against the client's own types, so that a call
// that was renamed or changed its arguments cannot stay in a document.
//
// Each `js` or `ts` block becomes a module, with what the documents take for granted declared ahead of it: a room,
// a member, the game's own world. Names a block leaves to the game (`world`, `drawShot`) are declared as `any`, so
// only what the block asks of p3p2 is checked.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const ROOT = join(import.meta.dirname, '..', '..')
const DOCS = ['README.md', 'docs/integrate.md', 'docs/sharing-state.md', 'docs/api.md', 'docs/testing.md']

/** What a block may use without declaring it: p3p2's own objects, typed. Only those the block does not make itself. */
function prelude(code: string): string {
  const has = (name: string) => new RegExp(`(?:import[^\\n]*\\b${name}\\b|(?:const|let|var|function)\\s+${name}\\b)`).test(code)
  const lines: string[] = []
  const imports: [string, string][] = [
    ['P3P2', `import { P3P2 } from '@p3p2/client'`],
    ['Smooth', `import { Smooth } from '@p3p2/client/smooth'`],
    ['pack', `import { pack, unpack } from '@p3p2/client/pack'`],
  ]
  for (const [name, line] of imports) if (!has(name)) lines.push(line, `void ${name}`)
  lines.push(`import type { Room, Member } from '@p3p2/client'`)
  const typed: [string, string][] = [
    ['p3p2', 'P3P2'],
    ['room', 'Room'],
    ['member', 'Member'],
    ['guests', 'Member[]'],
  ]
  for (const [name, type] of typed) if (!has(name)) lines.push(`declare const ${name}: ${type === 'P3P2' ? "import('@p3p2/client').P3P2" : type}`)
  return lines.join('\n')
}

interface Block {
  doc: string
  line: number
  code: string
}

function blocks(): Block[] {
  const out: Block[] = []
  for (const doc of DOCS) {
    const lines = readFileSync(join(ROOT, doc), 'utf8').split('\n')
    let code: string[] | null = null
    let start = 0
    for (const [n, line] of lines.entries()) {
      if (code === null && /^```(js|ts)\s*$/.test(line)) {
        code = []
        start = n + 2
      } else if (code !== null && line.startsWith('```')) {
        // A piece of a configuration file (`optimizeDeps: { … },`) is not code to run.
        const first = code.find((l) => l.trim() && !l.trim().startsWith('//')) ?? ''
        if (!/^\s*[\w$]+\s*:/.test(first)) out.push({ doc, line: start, code: code.join('\n') })
        code = null
      } else if (code !== null) code.push(line)
    }
  }
  return out
}

/** The names a block uses and does not declare, which the game would have: declared as `any`. */
function free(code: string): string[] {
  const used = new Set(code.match(/(?<![.\w$'"`])[A-Za-z_$][\w$]*/g) ?? [])
  const declared = new Set([...code.matchAll(/(?:const|let|var|function|class|import)\s+\{?\s*([\w$, ]+)/g)].flatMap((m) => m[1]!.split(/[ ,]+/)))
  for (const m of code.matchAll(/\(([\w$, ]*)\)\s*=>|([\w$]+)\s*=>/g)) for (const n of (m[1] ?? m[2] ?? '').split(/[ ,]+/)) declared.add(n)
  for (const m of code.matchAll(/(?:const|let|var)\s+\[([\w$, ]+)\]/g)) for (const n of m[1]!.split(/[ ,]+/)) declared.add(n)
  for (const m of code.matchAll(/for\s*\(\s*const\s+(?:\[([\w$, ]+)\]|([\w$]+))/g)) for (const n of (m[1] ?? m[2] ?? '').split(/[ ,]+/)) declared.add(n)
  const known = new Set([
    ...'P3P2 Room Member Smooth pack unpack p3p2 room member guests'.split(' '),
    ...'const let var function class return await async if else for of in new import from type typeof true false null undefined void this'.split(' '),
    ...'Math Date JSON Object Array Number String Promise console location window document performance crypto Uint8Array Uint16Array Uint32Array Float32Array Float64Array DataView ArrayBuffer TextEncoder Map Set Error'.split(' '),
  ])
  return [...used].filter((n) => !declared.has(n) && !known.has(n) && !/^\d/.test(n))
}

test('the code in the documents uses the client as its types say', () => {
  const all = blocks()
  assert.ok(all.length >= 8, `only ${all.length} code blocks found`)
  const dir = mkdtempSync(join(tmpdir(), 'p3p2-snippets-'))
  try {
    const files: string[] = []
    const heads: number[] = []
    for (const [i, b] of all.entries()) {
      const names = free(b.code)
      const file = `block${i}.ts`
      files.push(file)
      const declarations = names.map((n) => `declare const ${n}: any`).join('\n')
      const head = `${prelude(b.code)}\n${declarations}\n// ${b.doc}:${b.line}\n`
      heads.push(head.split('\n').length - 1)
      // A module of its own, and top-level await allowed.
      writeFileSync(join(dir, file), `${head}${b.code}\nexport {}\n`)
    }
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'es2023',
          module: 'esnext',
          moduleResolution: 'bundler',
          lib: ['es2023', 'dom', 'dom.iterable'],
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          allowImportingTsExtensions: true,
          types: [],
          paths: {
            '@p3p2/client': [join(ROOT, 'client', 'src', 'index.ts')],
            '@p3p2/client/smooth': [join(ROOT, 'client', 'src', 'smooth.ts')],
            '@p3p2/client/pack': [join(ROOT, 'client', 'src', 'pack.ts')],
            '@p3p2/protocol': [join(ROOT, 'protocol', 'src', 'index.ts')],
            '@p3p2/protocol/links': [join(ROOT, 'protocol', 'src', 'links.ts')],
          },
          // Arguments of callbacks the documents leave untyped are the game's business.
          noImplicitAny: false,
        },
        files,
      }),
    )
    let output = ''
    try {
      execFileSync(join(ROOT, 'node_modules', '.bin', 'tsc'), ['-p', join(dir, 'tsconfig.json')], { encoding: 'utf8' })
    } catch (err) {
      output = String((err as { stdout?: string }).stdout ?? err)
    }
    // Each error, with the document and line of its block.
    // What arrives from the others is `unknown` until the game says what it is: the documents, written in
    // JavaScript, use it as the game's data. Those are the game's business; everything about p3p2's own objects
    // is checked.
    const errors = output
      .split('\n')
      .filter((l) => /error TS\d+/.test(l))
      .filter((l) => !/is of type 'unknown'|on type '\{\}'/.test(l))
      .map((l) => {
        const m = l.match(/block(\d+)\.ts\((\d+),\d+\): (.*)$/)
        if (!m) return l
        const b = all[Number(m[1])]!
        return `${b.doc}:${b.line + Number(m[2]) - heads[Number(m[1])]! - 1}: ${m[3]}`
      })
    assert.deepEqual(errors, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
