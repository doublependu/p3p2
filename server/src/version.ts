import { readFileSync } from 'node:fs'

/** The server's version: the one in its package.json, which a release sets for every package at once. */
export const VERSION: string = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version
