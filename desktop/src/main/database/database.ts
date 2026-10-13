import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'

export type CounterRecord = {
  id: number
  value: number
  updatedAt: string
  version: number
}

export type SyncOutboxRecord = {
  id: string
  entity_type: string
  entity_id: number
  payload: string
  created_at: string
  status: 'pending' | 'acknowledged'
}

export type DatabaseOptions = {
  userDataDir?: string
}

export function createCounterDatabase({ userDataDir = path.join(os.homedir(), '.lan-sync-counter') }: DatabaseOptions = {}) {
  fs.mkdirSync(userDataDir, { recursive: true })

  const databaseFile = path.join(userDataDir, 'lan-sync-counter.db')
  const db = new Database(databaseFile)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS counter (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      value INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sync_outbox (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged'))
    );

    CREATE TABLE IF NOT EXISTS paired_devices (
      device_id TEXT PRIMARY KEY,
      device_name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
  `)

  const existing = db.prepare('SELECT COUNT(*) AS total FROM counter WHERE id = 1').get() as { total: number }
  if (existing.total === 0) {
    db.prepare('INSERT INTO counter (id, value, updated_at, version) VALUES (1, 0, ?, 0)')
      .run(new Date().toISOString())
  }

  const getCounter = db.prepare(
    'SELECT id, value, updated_at AS updatedAt, version FROM counter WHERE id = 1',
  )
  const insertOutbox = db.prepare(`
    INSERT INTO sync_outbox (id, entity_type, entity_id, payload, created_at, status)
    VALUES (?, 'counter', 1, ?, ?, 'pending')
  `)

  return {
    db,
    getCounter() {
      const counter = getCounter.get() as CounterRecord | undefined
      if (!counter) {
        throw new Error('Counter record is missing from the local database.')
      }
      return counter
    },
    setCounter(value: number) {
      if (!Number.isSafeInteger(value)) {
        throw new TypeError('Counter value must be a safe integer.')
      }

      const current = this.getCounter()
      const nextVersion = current.version + 1
      const updatedAt = new Date().toISOString()
      const payload = { value, version: nextVersion, updatedAt }
      const operationId = randomUUID()

      db.transaction(() => {
        db.prepare('UPDATE counter SET value = ?, updated_at = ?, version = ? WHERE id = 1')
          .run(value, updatedAt, nextVersion)
        insertOutbox.run(operationId, JSON.stringify(payload), updatedAt)
      })()

      return this.getCounter()
    },
    createSyncOperation() {
      const counter = this.getCounter()
      const operationId = randomUUID()
      const payload = {
        value: counter.value,
        version: counter.version,
        updatedAt: counter.updatedAt,
      }
      insertOutbox.run(operationId, JSON.stringify(payload), new Date().toISOString())
      return { id: operationId, payload }
    },
    listPendingSyncOperations() {
      return db
        .prepare('SELECT * FROM sync_outbox WHERE status = ? ORDER BY created_at ASC')
        .all('pending') as SyncOutboxRecord[]
    },
    confirmSyncOperation(operationId: string, acknowledgedVersion: number) {
      return db.transaction(() => {
        const pendingOperation = db.prepare(
          'SELECT id FROM sync_outbox WHERE id = ? AND status = ?',
        ).get(operationId, 'pending')
        if (!pendingOperation) return false

        const pendingOperations = db.prepare(
          'SELECT id, payload FROM sync_outbox WHERE entity_type = ? AND entity_id = ? AND status = ?',
        ).all('counter', 1, 'pending') as Array<{ id: string; payload: string }>
        const acknowledge = db.prepare('UPDATE sync_outbox SET status = ? WHERE id = ?')
        for (const operation of pendingOperations) {
          const payload = JSON.parse(operation.payload) as { version?: unknown }
          if (typeof payload.version === 'number' && payload.version <= acknowledgedVersion) {
            acknowledge.run('acknowledged', operation.id)
          }
        }
        return true
      })()
    },
    savePairedDevice(deviceId: string, deviceName: string, tokenHash: string) {
      db.prepare(`
        INSERT INTO paired_devices (device_id, device_name, token_hash, created_at)
        VALUES (?, ?, ?, ?)
      `).run(deviceId, deviceName, tokenHash, new Date().toISOString())
      return this.getPairedDeviceByTokenHash(tokenHash)
    },
    getPairedDeviceByTokenHash(tokenHash: string) {
      return db.prepare(
        'SELECT device_id AS deviceId, device_name AS deviceName FROM paired_devices WHERE token_hash = ?',
      ).get(tokenHash) as { deviceId: string; deviceName: string } | undefined
    },
    close() {
      db.close()
    },
  }
}
