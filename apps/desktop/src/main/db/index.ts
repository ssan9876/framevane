import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import init from './migrations/001_init.sql'
import agentStarter from './migrations/002_agent_starter.sql'

/** Migrations, in order. Each runs once inside a transaction; PRAGMA user_version records progress. */
const MIGRATIONS: string[] = [init, agentStarter]

export type Db = DatabaseSync

export function openDb(file: string): Db {
  mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;')
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN')
    try {
      // PRAGMA statements inside migration files are connection-level and already set above
      db.exec(MIGRATIONS[v]!.replace(/^PRAGMA .*;$/gm, ''))
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  return db
}

export const now = () => Date.now()

/** uuid v7: time-sortable ids for every row. */
export function uuid7(): string {
  const ms = BigInt(Date.now())
  const rnd = crypto.getRandomValues(new Uint8Array(10))
  const b = new Uint8Array(16)
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn)
  b.set(rnd, 6)
  b[6] = (b[6]! & 0x0f) | 0x70
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
