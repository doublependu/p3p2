import type { LogLevel } from './config.ts'

const ORDER: LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent']

export type Log = (level: Exclude<LogLevel, 'silent'>, event: string, detail?: Record<string, unknown>) => void

/** One line per event. Message contents and whole secrets are never passed in. */
export function createLog(min: LogLevel): Log {
  const floor = ORDER.indexOf(min)
  return (level, event, detail = {}) => {
    if (ORDER.indexOf(level) < floor) return
    const fields = Object.entries(detail)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : String(v)}`)
      .join(' ')
    const line = `${new Date().toISOString()} ${level.padEnd(5)} ${event}${fields ? ` ${fields}` : ''}`
    if (level === 'error' || level === 'warn') console.error(line)
    else console.log(line)
  }
}
