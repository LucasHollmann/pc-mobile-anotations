import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { createCounterDatabase } from './database/database'
import { createHttpServer, getPrivateNetworkInterfaces } from './server/httpServer'
import { createWebSocketServer } from './server/websocketServer'

const configuredPort = process.env.LAN_SYNC_PORT
const port = configuredPort === undefined ? 47831 : Number(configuredPort)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('LAN_SYNC_PORT must be an integer between 1 and 65535.')
}
let mainWindow: BrowserWindow | undefined
let database: ReturnType<typeof createCounterDatabase> | undefined
let lanServer: ReturnType<typeof createWebSocketServer> | undefined
let httpServer: ReturnType<typeof createHttpServer> | undefined
let shuttingDown = false
let serverStatus: 'starting' | 'online' | 'offline' | 'error' = 'offline'
let serverMessage: string | undefined
let connectionStatus: 'connected' | 'disconnected' = 'disconnected'
let connectionDeviceName: string | undefined
let networkAddresses: string[] = []

function sendToRenderer(channel: string, ...args: unknown[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

function registerIpcHandlers() {
  ipcMain.handle('counter:get', () => {
    if (!database) throw new Error('Local database has not been initialized.')
    return database.getCounter()
  })

  ipcMain.handle('counter:set', (_event, value: unknown) => {
    if (!database) throw new Error('Local database has not been initialized.')
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      throw new TypeError('Counter value must be a safe integer.')
    }
    return database.setCounter(value)
  })

  ipcMain.handle('counter:sync', async () => {
    if (!lanServer) throw new Error('LAN server has not been initialized.')
    return lanServer.syncCounter()
  })

  ipcMain.handle('pairing:generate-code', () => {
    if (!lanServer) throw new Error('LAN server has not been initialized.')
    return lanServer.generatePairingCode()
  })

  ipcMain.handle('server:get-state', () => ({
    server: { status: serverStatus, message: serverMessage },
    connection: { status: connectionStatus, deviceName: connectionDeviceName },
    addresses: networkAddresses,
    port,
  }))
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 620,
    height: 720,
    minWidth: 480,
    minHeight: 560,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const devServerUrl = process.env.LAN_SYNC_DEV_SERVER_URL
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl)
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = undefined
  })
}

async function startLanServer() {
  try {
    if (!database) throw new Error('Local database has not been initialized.')

    httpServer = createHttpServer(port)
    lanServer = createWebSocketServer(httpServer.servers, database, {
      onServerStatus: (status, message) => {
        serverStatus = status
        serverMessage = message
        sendToRenderer('server:status', { status, message })
      },
      onConnectionStatus: (status, deviceName) => {
        connectionStatus = status
        connectionDeviceName = deviceName
        sendToRenderer('connection:status', { status, deviceName })
      },
      onNetworkAddresses: (addresses) => {
        networkAddresses = addresses
        sendToRenderer('network:addresses', addresses)
      },
    }, httpServer.addresses)

    await lanServer.start(port)
  } catch (error) {
    serverStatus = 'error'
    serverMessage = error instanceof Error ? error.message : 'Unable to start local LAN server.'
    console.error('Failed to start the local LAN server:', error)
  }
}

async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true

  if (lanServer) {
    await lanServer.close()
  }
  if (httpServer) {
    await httpServer.close()
  }
  database?.close()
}

app.whenReady().then(async () => {
  app.setName('LAN Sync Counter')
  database = createCounterDatabase({ userDataDir: app.getPath('userData') })
  registerIpcHandlers()
  await startLanServer()
  await createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow()
    }
  })
})

app.on('before-quit', (event) => {
  if (shuttingDown) return
  event.preventDefault()
  void shutdown().finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

process.on('SIGINT', () => {
  void shutdown().finally(() => app.quit())
})

export { getPrivateNetworkInterfaces }
