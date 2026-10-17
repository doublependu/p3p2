// A static file server for the examples: examples/ at /, the client's files at /dist/, and the examples that Vite
// builds at /world/, /arena/, /arena-next/ (the arena with another build id) and /rally/.
// Usage: node examples/serve.ts [port]   (default 5180; listens on all interfaces)
//
// From the command line it builds those examples with this checkout's client first (`npm run build` before), and
// serves client/dist/. The browser tests start it with the client they test instead.

import { createReadStream, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, normalize, sep } from 'node:path'
import { buildExamples, NAMES, packCheckout } from './build.ts'

const here = import.meta.dirname
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
}

export interface Roots {
  /** The client's dist/ folder. */
  dist: string
  /** Where the built examples are: <builds>/world/, … */
  builds: string
}

/** Serves the examples on `port`, on every interface. Resolves once it listens. */
export function serveExamples(port: number, roots: Roots): Promise<Server> {
  const list: [string, string][] = [
    ['/dist/', roots.dist],
    ...NAMES.map((name): [string, string] => [`/${name}/`, join(roots.builds, name)]),
    ['/', here],
  ]
  const server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
    if (path.endsWith('/')) path += 'index.html'
    for (const [prefix, dir] of list) {
      if (!path.startsWith(prefix)) continue
      const file = normalize(join(dir, path.slice(prefix.length)))
      if (!file.startsWith(dir + sep)) break
      try {
        if (!statSync(file).isFile()) break
      } catch {
        break
      }
      res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
      createReadStream(file).pipe(res)
      return
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '0.0.0.0', () => resolve(server))
  })
}

if (import.meta.main) {
  const port = Number(process.argv[2] ?? process.env.PORT ?? 5180)
  const out = join(tmpdir(), 'p3p2-examples')
  console.log('building world/, arena/ and rally/ with this checkout\'s client…')
  const { dir } = buildExamples(packCheckout(join(out, 'client')), out)
  await serveExamples(port, { dist: join(here, '..', 'client', 'dist'), builds: dir })
  console.log(`examples on http://localhost:${port}/  (use this machine's LAN address from other devices)`)
}
