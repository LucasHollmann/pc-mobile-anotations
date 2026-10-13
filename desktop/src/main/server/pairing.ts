import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'

export type PairingRequest = {
  deviceName: string
  code: string
}

export type PairingCode = {
  code: string
  expiresAt: number
  attemptsRemaining: number
}

export function createPairingCode(): PairingCode {
  return {
    code: randomInt(0, 1_000_000).toString().padStart(6, '0'),
    expiresAt: Date.now() + 2 * 60 * 1000,
    attemptsRemaining: 12,
  }
}

export function createDeviceCredential() {
  return {
    deviceId: randomUUID(),
    token: randomBytes(32).toString('base64url'),
  }
}

export function hashDeviceToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function isValidPairingRequest(payload: unknown): payload is PairingRequest {
  if (!payload || typeof payload !== 'object') {
    return false
  }

  const candidate = payload as Record<string, unknown>
  return (
    typeof candidate.deviceName === 'string' &&
    candidate.deviceName.length > 0 &&
    candidate.deviceName.length <= 80 &&
    typeof candidate.code === 'string' &&
    /^\d{6}$/.test(candidate.code)
  )
}
