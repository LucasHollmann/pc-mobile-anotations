import { useEffect, useState } from 'react'
import type { CounterData, ServerStatusEvent, ConnectionStatusEvent } from '../../preload'

const emptyCounter: CounterData = {
  id: 1,
  value: 0,
  version: 0,
  updatedAt: new Date(0).toISOString(),
}

export default function App() {
  const [counter, setCounter] = useState<CounterData>(emptyCounter)
  const [server, setServer] = useState<ServerStatusEvent>({ status: 'starting' })
  const [connection, setConnection] = useState<ConnectionStatusEvent>({ status: 'disconnected' })
  const [addresses, setAddresses] = useState<string[]>([])
  const [port, setPort] = useState(47831)
  const [message, setMessage] = useState('Carregando contador local...')
  const [pairingCode, setPairingCode] = useState<string>()
  const [pairingExpiry, setPairingExpiry] = useState<number>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    const unsubscribeServer = window.lanSync.onServerStatus(setServer)
    const unsubscribeConnection = window.lanSync.onConnectionStatus((event) => {
      setConnection(event)
      if (event.status === 'connected') {
        setPairingCode(undefined)
        setPairingExpiry(undefined)
      }
    })
    const unsubscribeAddresses = window.lanSync.onNetworkAddresses(setAddresses)

    void Promise.all([window.lanSync.getCounter(), window.lanSync.getServerState()])
      .then(([savedCounter, serverState]) => {
        if (!active) return
        setCounter(savedCounter)
        setServer(serverState.server)
        setConnection(serverState.connection)
        setAddresses(serverState.addresses)
        setPort(serverState.port)
        setMessage('Contador carregado do SQLite local.')
      })
      .catch((error: unknown) => {
        if (active) setMessage(error instanceof Error ? error.message : 'Falha ao carregar o contador.')
      })

    return () => {
      active = false
      unsubscribeServer()
      unsubscribeConnection()
      unsubscribeAddresses()
    }
  }, [])

  const adjustCounter = async (delta: number) => {
    setBusy(true)
    try {
      const saved = await window.lanSync.setCounter(counter.value + delta)
      setCounter(saved)
      setMessage('Contador salvo localmente.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao salvar o contador.')
    } finally {
      setBusy(false)
    }
  }

  const handleSync = async () => {
    setBusy(true)
    try {
      const result = await window.lanSync.syncCounter()
      setMessage(result.message)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha na sincronização.')
    } finally {
      setBusy(false)
    }
  }

  const handlePairing = async () => {
    try {
      const pairing = await window.lanSync.generatePairingCode()
      setPairingCode(pairing.code)
      setPairingExpiry(pairing.expiresAt)
      setMessage('Informe o código de pareamento no Android. Ele expira em 2 minutos.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível gerar o código de pareamento.')
    }
  }

  const addressText = addresses.length > 0
    ? addresses.map((address) => `${address}:${port}`).join(', ')
    : 'Nenhum IPv4 privado detectado'

  return (
    <main className="counter-app">
      <h1>LAN Sync Counter</h1>
      <div className="counter-panel">
        <div className="display" id="counter-value" aria-live="polite">{counter.value}</div>
        <div className="controls">
          <button type="button" id="decrement" disabled={busy} onClick={() => void adjustCounter(-1)}>
            -1
          </button>
          <button type="button" id="increment" disabled={busy} onClick={() => void adjustCounter(1)}>
            +1
          </button>
        </div>
        <button type="button" className="pair-button" disabled={busy || server.status !== 'online'} onClick={() => void handlePairing()}>
          Gerar código de pareamento
        </button>
        {pairingCode && (
          <div className="pairing-code" aria-live="polite">
            <span>Código de pareamento (válido por 2 minutos)</span>
            <strong>{pairingCode}</strong>
            {pairingExpiry && <small>Expira às {new Date(pairingExpiry).toLocaleTimeString()}</small>}
          </div>
        )}
        <button type="button" className="sync-button" disabled={busy} onClick={() => void handleSync()}>
          Sincronizar com Android
        </button>
        <div className="status-row">
          <span>Servidor local:</span>
          <strong>{server.status}{server.message ? ` — ${server.message}` : ''}</strong>
        </div>
        <div className="status-row">
          <span>Conexão Android:</span>
          <strong>{connection.status === 'connected' ? `conectado${connection.deviceName ? ` (${connection.deviceName})` : ''}` : 'desconectado'}</strong>
        </div>
        <div className="status-row">
          <span>Última mensagem:</span>
          <strong>{message}</strong>
        </div>
        <div className="status-row">
          <span>Endereço:</span>
          <strong>{addressText}</strong>
        </div>
        <p className="network-note">A conexão usa WebSocket sem TLS e deve ficar restrita a uma rede local confiável.</p>
      </div>
    </main>
  )
}
