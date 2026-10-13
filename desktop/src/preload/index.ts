import { contextBridge, ipcRenderer } from 'electron'

export type CounterData = {
  id: number
  value: number
  version: number
  updatedAt: string
}

export type ServerStatusEvent = {
  status: 'starting' | 'online' | 'offline' | 'error'
  message?: string
}

export type ConnectionStatusEvent = {
  status: 'connected' | 'disconnected'
  deviceName?: string
}

export type SyncResult = {
  success: boolean
  message: string
}

type PairingCode = {
  code: string
  expiresAt: number
}

type Listener<T> = (value: T) => void

function subscribe<T>(channel: string, listener: Listener<T>) {
  const handler = (_event: Electron.IpcRendererEvent, value: T) => listener(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  getCounter: () => ipcRenderer.invoke('counter:get') as Promise<CounterData>,
  setCounter: (value: number) => ipcRenderer.invoke('counter:set', value) as Promise<CounterData>,
  syncCounter: () => ipcRenderer.invoke('counter:sync') as Promise<SyncResult>,
  generatePairingCode: () => ipcRenderer.invoke('pairing:generate-code') as Promise<PairingCode>,
  getServerState: () => ipcRenderer.invoke('server:get-state') as Promise<{
    server: ServerStatusEvent
    connection: ConnectionStatusEvent
    addresses: string[]
    port: number
  }>,
  onServerStatus: (listener: Listener<ServerStatusEvent>) => subscribe('server:status', listener),
  onConnectionStatus: (listener: Listener<ConnectionStatusEvent>) => subscribe('connection:status', listener),
  onNetworkAddresses: (listener: Listener<string[]>) => subscribe('network:addresses', listener),
}

contextBridge.exposeInMainWorld('lanSync', api)

declare global {
  interface Window {
    lanSync: typeof api
  }
}
