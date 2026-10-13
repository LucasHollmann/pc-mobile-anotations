import type { IncomingMessage, Server as HttpServer } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import WebSocket, { WebSocketServer } from 'ws'
import type { createCounterDatabase } from '../database/database'
import {
  createDeviceCredential,
  createPairingCode,
  hashDeviceToken,
  isValidPairingRequest,
} from './pairing'
import { buildCounterSyncMessage, validateCounterSyncResult } from '../sync/syncService'
import { getPrivateNetworkInterfaces } from './httpServer'

type CounterDatabase = ReturnType<typeof createCounterDatabase>
type ServerStatus = 'starting' | 'online' | 'offline' | 'error'
type ConnectionStatus = 'connected' | 'disconnected'

type ServerEvents = {
  onServerStatus: (status: ServerStatus, message?: string) => void
  onConnectionStatus: (status: ConnectionStatus, deviceName?: string) => void
  onNetworkAddresses: (addresses: string[]) => void
}

type PendingSync = {
  resolve: (result: { success: boolean; message: string }) => void
  timer: NodeJS.Timeout
  value: number
  version: number
}

export function createWebSocketServer(
  server: HttpServer | HttpServer[],
  database: CounterDatabase,
  events: ServerEvents,
  listenHosts: string[] = [],
) {
  const servers = Array.isArray(server) ? server : [server]
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 })
  const authenticated = new Map<WebSocket, string>()
  const pendingSyncs = new Map<string, PendingSync>()
  let activePairing: ReturnType<typeof createPairingCode> | undefined

  const emitConnectionStatus = () => {
    const activeDevice = [...authenticated.entries()].find(([socket]) => socket.readyState === WebSocket.OPEN)?.[1]
    events.onConnectionStatus(activeDevice ? 'connected' : 'disconnected', activeDevice)
  }

  const sendError = (socket: WebSocket, id: string, code: string, message: string) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'error', id, payload: { code, message } }))
    }
  }

  const onUpgrade = (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    if (pathname !== '/ws') {
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (webSocket) => {
      wss.emit('connection', webSocket, request)
    })
  }

  for (const httpServer of servers) {
    httpServer.on('upgrade', onUpgrade)
  }

  wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
      let message: unknown
      try {
        message = JSON.parse(raw.toString())
      } catch {
        sendError(socket, 'unknown', 'invalid_json', 'Message must be valid JSON.')
        return
      }

      if (!message || typeof message !== 'object') {
        sendError(socket, 'unknown', 'invalid_message', 'Message envelope is invalid.')
        return
      }

      const envelope = message as Record<string, unknown>
      if (
        typeof envelope.type !== 'string' ||
        envelope.type.length > 40 ||
        typeof envelope.id !== 'string' ||
        !envelope.id ||
        envelope.id.length > 128 ||
        !envelope.payload ||
        typeof envelope.payload !== 'object' ||
        Array.isArray(envelope.payload)
      ) {
        sendError(socket, 'unknown', 'invalid_message', 'Message envelope is invalid.')
        return
      }

      if (envelope.type === 'pair') {
        const payload = envelope.payload
        if (!isValidPairingRequest(payload)) {
          sendError(socket, envelope.id, 'invalid_pair_request', 'Pairing request is invalid.')
          return
        }
        if (!activePairing || Date.now() > activePairing.expiresAt) {
          activePairing = undefined
          sendError(socket, envelope.id, 'pairing_expired', 'Pairing code is invalid or expired.')
          return
        }
        if (payload.code !== activePairing.code) {
          activePairing.attemptsRemaining -= 1
          if (activePairing.attemptsRemaining === 0) activePairing = undefined
          sendError(socket, envelope.id, 'pairing_expired', 'Pairing code is invalid or expired.')
          return
        }

        const credential = createDeviceCredential()
        const device = database.savePairedDevice(
          credential.deviceId,
          payload.deviceName,
          hashDeviceToken(credential.token),
        )
        activePairing = undefined
        socket.send(JSON.stringify({
          type: 'pair_result',
          id: envelope.id,
          payload: { status: 'accepted', deviceId: device?.deviceId ?? credential.deviceId, token: credential.token },
        }))
        return
      }

      if (envelope.type === 'hello') {
        const payload = envelope.payload
        if (!payload || typeof payload !== 'object') {
          sendError(socket, envelope.id, 'invalid_hello', 'Hello payload is invalid.')
          return
        }
        const hello = payload as Record<string, unknown>
        if (
          hello.protocolVersion !== 1 ||
          typeof hello.token !== 'string' ||
          hello.token.length > 128 ||
          typeof hello.deviceName !== 'string' ||
          hello.deviceName.length > 80
        ) {
          sendError(socket, envelope.id, 'invalid_hello', 'Hello payload is invalid or protocol version is unsupported.')
          return
        }
        const tokenHash = hashDeviceToken(hello.token)
        const device = database.getPairedDeviceByTokenHash(tokenHash)
        if (!device) {
          sendError(socket, envelope.id, 'unauthorized', 'Device has not been paired with this desktop.')
          socket.close(1008, 'Unauthorized')
          return
        }
        authenticated.set(socket, device.deviceName)
        socket.send(JSON.stringify({
          type: 'hello',
          id: envelope.id,
          payload: { status: 'connected', protocolVersion: 1 },
        }))
        emitConnectionStatus()
        return
      }

      if (envelope.type === 'ping') {
        if (!envelope.payload || typeof envelope.payload !== 'object' || Array.isArray(envelope.payload)) {
          sendError(socket, envelope.id, 'invalid_ping', 'Ping payload must be an object.')
          return
        }
        socket.send(JSON.stringify({ type: 'pong', id: envelope.id, payload: {} }))
        return
      }

      if (envelope.type === 'counter_sync_result') {
        if (!authenticated.has(socket)) {
          sendError(socket, envelope.id, 'unauthorized', 'Pairing is required before synchronisation.')
          return
        }
        if (!validateCounterSyncResult(message)) {
          sendError(socket, envelope.id, 'invalid_sync_result', 'Counter sync result is invalid.')
          return
        }

        const pending = pendingSyncs.get(envelope.id)
        if (!pending) {
          return
        }
        clearTimeout(pending.timer)
        pendingSyncs.delete(envelope.id)
        if (envelope.payload && typeof envelope.payload === 'object') {
          const resultPayload = envelope.payload as Record<string, unknown>
          if (
            resultPayload.status === 'applied' &&
            resultPayload.value === pending.value &&
            resultPayload.version === pending.version
          ) {
            database.confirmSyncOperation(envelope.id, pending.version)
            pending.resolve({ success: true, message: 'Android confirmou a gravação do contador.' })
          } else {
            pending.resolve({ success: false, message: 'Android rejeitou a alteração; a operação permanece pendente.' })
          }
        }
        return
      }

      sendError(socket, envelope.id, 'unknown_type', 'Unknown message type.')
    })

    socket.on('close', () => {
      authenticated.delete(socket)
      emitConnectionStatus()
    })
    socket.on('error', () => {
      authenticated.delete(socket)
      emitConnectionStatus()
    })
  })

  return {
    async start(port: number) {
      events.onServerStatus('starting')
      try {
        const listenResults = await Promise.allSettled(servers.map((httpServer, index) => new Promise<void>((resolve, reject) => {
          const onError = (error: Error) => {
            httpServer.off('listening', onListening)
            reject(error)
          }
          const onListening = () => {
            httpServer.off('error', onError)
            resolve()
          }
          httpServer.once('error', onError)
          httpServer.once('listening', onListening)
          const host = listenHosts[index]
          if (host) {
            httpServer.listen(port, host)
          } else {
            httpServer.listen(port)
          }
        })))
        const failedListener = listenResults.find((result) => result.status === 'rejected')
        if (failedListener?.status === 'rejected') {
          throw failedListener.reason
        }
        const address = servers[0].address() as AddressInfo
        const addresses = listenHosts.length > 0 ? listenHosts : getPrivateNetworkInterfaces()
        events.onNetworkAddresses(addresses)
        events.onServerStatus('online')
        return address.port
      } catch (error) {
        await Promise.all(servers.map((httpServer) => new Promise<void>((resolve) => {
          if (!httpServer.listening) {
            resolve()
            return
          }
          httpServer.close(() => resolve())
        })))
        events.onServerStatus('error', error instanceof Error ? error.message : 'Unable to start LAN server.')
        throw error
      }
    },
    generatePairingCode() {
      activePairing = createPairingCode()
      return { code: activePairing.code, expiresAt: activePairing.expiresAt }
    },
    syncCounter() {
      const operation = database.createSyncOperation()
      const client = [...authenticated.keys()].find((socket) => socket.readyState === WebSocket.OPEN)
      if (!client) {
        return Promise.resolve({ success: false, message: 'Android desconectado. A operação ficou pendente.' })
      }

      return new Promise<{ success: boolean; message: string }>((resolve) => {
        const timer = setTimeout(() => {
          pendingSyncs.delete(operation.id)
          resolve({ success: false, message: 'Tempo esgotado aguardando confirmação do Android. A operação ficou pendente.' })
        }, 10_000)
        pendingSyncs.set(operation.id, {
          resolve,
          timer,
          value: operation.payload.value,
          version: operation.payload.version,
        })

        try {
          client.send(JSON.stringify(buildCounterSyncMessage(operation.payload, operation.id)), (error) => {
            if (!error) return
            clearTimeout(timer)
            pendingSyncs.delete(operation.id)
            resolve({ success: false, message: `Falha ao enviar para Android: ${error.message}` })
          })
        } catch (error) {
          clearTimeout(timer)
          pendingSyncs.delete(operation.id)
          resolve({
            success: false,
            message: `Falha ao enviar para Android: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
          })
        }
      })
    },
    async close() {
      for (const httpServer of servers) {
        httpServer.off('upgrade', onUpgrade)
      }
      for (const pending of pendingSyncs.values()) {
        clearTimeout(pending.timer)
        pending.resolve({ success: false, message: 'Servidor local encerrado antes da confirmação.' })
      }
      pendingSyncs.clear()
      for (const client of wss.clients) {
        client.close(1001, 'Desktop app is shutting down')
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()))
    },
  }
}
