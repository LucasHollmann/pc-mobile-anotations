import { describe, expect, it } from 'vitest'
import { isPrivateIPv4 } from './httpServer'

describe('isPrivateIPv4', () => {
  it.each(['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.2'])(
    'accepts private IPv4 address %s',
    (address) => {
      expect(isPrivateIPv4(address)).toBe(true)
    },
  )

  it.each(['127.0.0.1', '172.32.0.1', '8.8.8.8', '192.168.1', '192.168.1.999', '.10.0.1'])(
    'rejects non-private or invalid IPv4 address %s',
    (address) => {
      expect(isPrivateIPv4(address)).toBe(false)
    },
  )
})
