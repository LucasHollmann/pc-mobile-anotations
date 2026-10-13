import { createServer } from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { createCounterDatabase } from '../database/database'
import { createSyncResult } from '../sync/syncService'
import { createWebSocketServer } from './websocketServer'

const tempDirs: string[] = []

function nextMessage(socket: WebSocket, type: string) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}.`)), 3_000)
    const onMessage = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>
      if (message.type !== type) return
      clearTimeout(timer)
      socket.off('message', onMessage)
      resolve(message)
    }
    socket.on('message', onMessage)
  })
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('websocket server', () => {
  it('rejects a device without a stored pairing credential', async () => {
    const userDataDir = path.join(os.tmpdir(), `lan-sync-unpaired-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    tempDirs.push(userDataDir)
    const database = createCounterDatabase({ userDataDir })
    const httpServer = createServer()
    const server = createWebSocketServer(httpServer, database, {
      onServerStatus: () => undefined,
      onConnectionStatus: () => undefined,
      onNetworkAddresses: () => undefined,
    })
    const port = await server.start(0)
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`)

    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve)
        socket.once('error', reject)
      })
      const errorPromise = nextMessage(socket, 'error')
      socket.send(JSON.stringify({
        type: 'hello',
        id: 'unpaired-hello',
        payload: {
          app: 'android',
          protocolVersion: 1,
          deviceName: 'unpaired phone',
          token: 'not-a-paired-credential',
        },
      }))
      const response = await errorPromise
      expect((response.payload as Record<string, unknown>).code).toBe('unauthorized')
    } finally {
      socket.terminate()
      await server.close()
      await new Promise<void>((resolve, reject) => {
        if (!httpServer.listening) {
          resolve()
          return
        }
        httpServer.close((error) => error ? reject(error) : resolve())
      })
      database.close()
    }
  })

  it('keeps a sync operation pending when no paired Android is connected', async () => {
    const userDataDir = path.join(os.tmpdir(), `lan-sync-offline-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    tempDirs.push(userDataDir)
    const database = createCounterDatabase({ userDataDir })
    const httpServer = createServer()
    const server = createWebSocketServer(httpServer, database, {
      onServerStatus: () => undefined,
      onConnectionStatus: () => undefined,
      onNetworkAddresses: () => undefined,
    })

    try {
      await server.start(0)
      await expect(server.syncCounter()).resolves.toEqual({
        success: false,
        message: 'Android desconectado. A operação ficou pendente.',
      })
      expect(database.listPendingSyncOperations()).toHaveLength(1)
    } finally {
      await server.close()
      await new Promise<void>((resolve, reject) => {
        if (!httpServer.listening) {
          resolve()
          return
        }
        httpServer.close((error) => error ? reject(error) : resolve())
      })
      database.close()
    }
  })

  it('pairs a device and acknowledges a counter only after its result arrives', async () => {
    const userDataDir = path.join(os.tmpdir(), `lan-sync-server-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    tempDirs.push(userDataDir)
    const database = createCounterDatabase({ userDataDir })
    database.setCounter(33)

    const httpServer = createServer()
    const statuses: string[] = []
    const server = createWebSocketServer(httpServer, database, {
      onServerStatus: (status) => statuses.push(status),
      onConnectionStatus: () => undefined,
      onNetworkAddresses: () => undefined,
    })

    const port = await server.start(0)
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve)
        socket.once('error', reject)
      })

      const pairing = server.generatePairingCode()
      const pairingResultPromise = nextMessage(socket, 'pair_result')
      socket.send(JSON.stringify({
        type: 'pair',
        id: 'pair-request',
        payload: { deviceName: 'test phone', code: pairing.code },
      }))
      const pairingResult = await pairingResultPromise
      const pairingPayload = pairingResult.payload as Record<string, unknown>
      expect(pairingPayload.status).toBe('accepted')
      expect(typeof pairingPayload.token).toBe('string')

      const helloResultPromise = nextMessage(socket, 'hello')
      socket.send(JSON.stringify({
        type: 'hello',
        id: 'hello-request',
        payload: {
          app: 'android',
          protocolVersion: 1,
          deviceName: 'test phone',
          token: pairingPayload.token,
        },
      }))
      await helloResultPromise

      const syncResultPromise = server.syncCounter()
      const syncMessage = await nextMessage(socket, 'counter_sync')
      const syncId = syncMessage.id as string
      const syncPayload = syncMessage.payload as { value: number; version: number }
      expect(syncPayload.value).toBe(33)
      expect(syncPayload.version).toBe(1)

      socket.send(JSON.stringify(createSyncResult(
        'applied',
        syncPayload.value,
        syncPayload.version,
        syncId,
      )))

      await expect(syncResultPromise).resolves.toEqual({
        success: true,
        message: 'Android confirmou a gravação do contador.',
      })
      expect(database.listPendingSyncOperations()).toHaveLength(0)
      expect(statuses).toContain('online')
    } finally {
      socket.terminate()
      await server.close()
      await new Promise<void>((resolve, reject) => {
        if (!httpServer.listening) {
          resolve()
          return
        }
        httpServer.close((error) => error ? reject(error) : resolve())
      })
      database.close()
    }
  })
})
