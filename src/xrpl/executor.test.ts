import { describe, expect, it } from 'vitest'
import { XrplClient } from './executor'

describe('XRPL network boundary', () => {
  it('accepts only the configured public Testnet endpoint', () => {
    expect(() => new XrplClient('wss://s.altnet.rippletest.net:51233')).not.toThrow()
    for (const url of [
      'wss://s1.ripple.com',
      'wss://s.devnet.rippletest.net:51233',
      'wss://evil.example/testnet',
      'https://s.altnet.rippletest.net:51233',
      'wss://s.altnet.rippletest.net:51233.evil.example',
    ]) expect(() => new XrplClient(url)).toThrow('approved Testnet URL')
  })
})
