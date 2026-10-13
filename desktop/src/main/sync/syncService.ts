export type CounterSyncPayload = {
  value: number
  version: number
  updatedAt: string
}

export type CounterSyncEnvelope = {
  type: 'counter_sync'
  id: string
  payload: CounterSyncPayload
}

export type CounterSyncResultEnvelope = {
  type: 'counter_sync_result'
  id: string
  payload: {
    status: 'applied' | 'rejected'
    value: number
    version: number
  }
}

export function buildCounterSyncMessage(payload: CounterSyncPayload, operationId?: string): CounterSyncEnvelope {
  return {
    type: 'counter_sync',
    id: operationId ?? `counter-sync-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    payload,
  }
}

export function createSyncResult(
  status: 'applied' | 'rejected',
  value: number,
  version: number,
  operationId?: string,
): CounterSyncResultEnvelope {
  return {
    type: 'counter_sync_result',
    id: operationId ?? `counter-sync-result-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    payload: { status, value, version },
  }
}

export function validateCounterSyncMessage(message: unknown): message is CounterSyncEnvelope {
  if (!message || typeof message !== 'object') return false

  const candidate = message as Record<string, unknown>
  if (candidate.type !== 'counter_sync') return false
  if (typeof candidate.id !== 'string' || candidate.id.length === 0 || candidate.id.length > 128) return false
  if (!candidate.payload || typeof candidate.payload !== 'object') return false

  const payload = candidate.payload as Record<string, unknown>
  return (
    typeof payload.value === 'number' &&
    Number.isSafeInteger(payload.value) &&
    typeof payload.version === 'number' &&
    Number.isSafeInteger(payload.version) &&
    payload.version >= 0 &&
    typeof payload.updatedAt === 'string' &&
    payload.updatedAt.length > 0 &&
    Number.isFinite(Date.parse(payload.updatedAt))
  )
}

export function validateCounterSyncResult(message: unknown): message is CounterSyncResultEnvelope {
  if (!message || typeof message !== 'object') return false

  const candidate = message as Record<string, unknown>
  if (candidate.type !== 'counter_sync_result') return false
  if (typeof candidate.id !== 'string' || candidate.id.length === 0 || candidate.id.length > 128) return false
  if (!candidate.payload || typeof candidate.payload !== 'object') return false

  const payload = candidate.payload as Record<string, unknown>
  return (
    (payload.status === 'applied' || payload.status === 'rejected') &&
    typeof payload.value === 'number' &&
    Number.isSafeInteger(payload.value) &&
    typeof payload.version === 'number' &&
    Number.isSafeInteger(payload.version) &&
    payload.version >= 0
  )
}
