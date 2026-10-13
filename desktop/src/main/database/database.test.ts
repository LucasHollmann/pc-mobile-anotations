import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createCounterDatabase } from './database'

describe('createCounterDatabase', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('creates the initial counter record and persists the value', () => {
    const userDataDir = path.join(os.tmpdir(), `lan-sync-counter-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    tempDirs.push(userDataDir)

    const db = createCounterDatabase({ userDataDir })

    expect(db.getCounter().value).toBe(0)
    expect(db.getCounter().version).toBe(0)

    db.setCounter(42)
    expect(db.getCounter().value).toBe(42)
    expect(db.getCounter().version).toBe(1)

    db.close()

    const reopenedDb = createCounterDatabase({ userDataDir })
    expect(reopenedDb.getCounter().value).toBe(42)
    expect(reopenedDb.getCounter().version).toBe(1)
    reopenedDb.close()
  })

  it('stores a pending sync operation without duplicating the counter update', () => {
    const userDataDir = path.join(os.tmpdir(), `lan-sync-counter-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    tempDirs.push(userDataDir)

    const db = createCounterDatabase({ userDataDir })

    db.setCounter(7)
    const operation = db.createSyncOperation()

    expect(db.listPendingSyncOperations()).toHaveLength(2)
    expect(db.confirmSyncOperation(operation.id, operation.payload.version)).toBe(true)
    expect(db.listPendingSyncOperations()).toHaveLength(0)

    db.close()
  })
})
