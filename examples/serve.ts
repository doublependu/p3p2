// A static file server for the examples: examples/ at /, the built client at /dist/.
// Usage: node examples/serve.ts [port]   (default 5180; listens on all interfaces)

import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'

const here = import.meta.dirname
const roots: [string, string][] = [
  ['/dist/', join(here, '..', 'client', 'dist')],
  ['/', here],
]
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
}

const port = Number(process.argv[2] ?? process.env.PORT ?? 5180)

createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  if (path.endsWith('/')) path += 'index.html'
  for (const [prefix, dir] of roots) {
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
}).listen(port, '0.0.0.0', () => {
  console.log(`examples on http://localhost:${port}/  (use this machine's LAN address from other devices)`)
})
