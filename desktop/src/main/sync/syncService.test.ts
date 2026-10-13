import { describe, expect, it } from 'vitest'

import { buildCounterSyncMessage, createSyncResult, validateCounterSyncMessage } from './syncService'

describe('syncService', () => {
  it('creates a valid counter sync envelope', () => {
    const message = buildCounterSyncMessage({ value: 9, version: 3, updatedAt: '2026-10-12T00:00:00.000Z' }, 'op-1')

    expect(message.type).toBe('counter_sync')
    expect(message.id).toBe('op-1')
    expect(message.payload.value).toBe(9)
  })

  it('validates the payload shape and allows accept/reject outcomes', () => {
    const valid = {
      type: 'counter_sync',
      id: 'sync-123',
      payload: {
        value: 12,
        version: 7,
        updatedAt: '2026-10-12T00:00:00.000Z',
      },
    }

    expect(validateCounterSyncMessage(valid)).toBe(true)

    const result = createSyncResult('applied', 12, 7, 'sync-123')
    expect(result.payload.status).toBe('applied')
    expect(result.payload.value).toBe(12)
  })
})
