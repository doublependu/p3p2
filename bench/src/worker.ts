// One thread of the load generator: some rooms, their members, and what they measured.
// The main thread (load.ts) says which rooms to run and asks for the counts.

import { monitorEventLoopDelay } from 'node:perf_hooks'
import { parentPort, workerData } from 'node:worker_threads'
import { Metrics } from './metrics.ts'
import { Room } from './room.ts'
import type { Command, WorkerInit, WorkerReport } from './types.ts'

const LOOP_RESOLUTION_MS = 10

const init = workerData as WorkerInit
const port = parentPort!
const metrics = new Metrics()
const rooms = new Map<number, Room>()
const loop = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS })
loop.enable()

async function run(c: Command): Promise<WorkerReport | null> {
  switch (c.cmd) {
    case 'rooms': {
      const wanted = new Set(c.plans.map((p) => p.index))
      const leaving = [...rooms].filter(([index]) => !wanted.has(index))
      for (const [index] of leaving) rooms.delete(index)
      await Promise.all(leaving.map(([, room]) => room.stop()))
      for (const plan of c.plans) {
        if (rooms.has(plan.index)) continue
        const room = new Room(plan, init, metrics)
        rooms.set(plan.index, room)
        try {
          await room.start()
        } catch (err) {
          // A room that did not fill is not left half full.
          rooms.delete(plan.index)
          await room.stop()
          throw err
        }
      }
      return null
    }
    case 'mark':
      metrics.reset()
      loop.reset()
      return null
    case 'report': {
      const report: WorkerReport = {
        histograms: {},
        counts: {},
        errors: metrics.errors,
        closes: metrics.closes,
        members: 0,
        loopP99: Math.max(0, loop.percentile(99) / 1e6 - LOOP_RESOLUTION_MS),
      }
      for (const [name, s] of metrics.entries()) {
        report.histograms[name] = s.hist
        report.counts[name] = { sent: s.sent, received: s.received, missed: s.missed }
      }
      for (const room of rooms.values()) report.members += room.ready
      return report
    }
    case 'stop':
      await Promise.all([...rooms.values()].map((room) => room.stop()))
      rooms.clear()
      return null
  }
}

port.on('message', ({ id, command }: { id: number; command: Command }) => {
  run(command).then(
    (result) => port.postMessage({ id, result }),
    (err) => port.postMessage({ id, error: err instanceof Error ? err.message : String(err) }),
  )
})
