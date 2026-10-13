import express from 'express'
import os from 'node:os'
import { createServer } from 'node:http'

export function isPrivateIPv4(address: string) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) {
    return false
  }
  const octets = address.split('.').map((octet) => Number(octet))
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false
  }

  return octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
}

export function getPrivateNetworkInterfaces() {
  const interfaces = os.networkInterfaces()
  const addresses: string[] = []

  for (const value of Object.values(interfaces)) {
    for (const detail of value ?? []) {
      if (detail.family === 'IPv4' && !detail.internal && isPrivateIPv4(detail.address)) {
        addresses.push(detail.address)
      }
    }
  }

  return [...new Set(addresses)]
}

export function createHttpServer(port: number) {
  const app = express()

  app.get('/health', (_req, res) => {
    res.json({ ok: true, port, interfaces: getPrivateNetworkInterfaces() })
  })

  const addresses = getPrivateNetworkInterfaces()
  if (addresses.length === 0) {
    throw new Error('No private IPv4 network interface is available.')
  }
  const servers = addresses.map(() => createServer(app))

  return {
    addresses,
    servers,
    close() {
      return Promise.all(servers.map((server) => new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve()
          return
        }
        server.close((error) => (error ? reject(error) : resolve()))
      }))).then(() => undefined)
    },
  }
}
