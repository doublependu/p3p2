import { loadConfig } from './config.ts'
import { startServer } from './server.ts'
import { VERSION } from './version.ts'

let config: ReturnType<typeof loadConfig>
try {
  config = loadConfig()
} catch (err) {
  // A bad setting: say which one, without a stack trace.
  console.error(`p3p2-server: ${(err as Error).message}`)
  process.exit(1)
}
const running = await startServer(config)

console.log(`p3p2-server ${VERSION}`)
console.log(`  Portal   ${config.publicUrl}/`)
console.log(`  Local    http://localhost:${running.port}/`)
if (running.setupUrl) {
  console.log('')
  console.log('  This server has no owner yet. Open this link once to choose the password:')
  console.log(`  ${running.setupUrl}`)
}
console.log('')

let closing = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (closing) return
    closing = true
    running.close().then(
      () => process.exit(0),
      () => process.exit(1),
    )
  })
}
