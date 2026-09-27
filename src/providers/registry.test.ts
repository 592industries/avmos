import { describe, expect, it } from 'vitest'
import { validProviderValues } from './registry'

describe('provider configuration registry', () => {
  it('accepts only controlled New Relic and Grok endpoints', () => {
    expect(validProviderValues('newrelic', { accountId: '123', region: 'US', fleetPrefix: 'avmos-node-' })).toBe(true)
    expect(validProviderValues('newrelic', { accountId: '123', region: 'OTHER' })).toBe(false)
    expect(validProviderValues('grok', { baseUrl: 'https://api.x.ai/v1', model: 'grok-4-fast-reasoning' })).toBe(true)
    expect(validProviderValues('grok', { baseUrl: 'https://internal.example.test' })).toBe(false)
  })

  it('rejects arbitrary provider fields and non-Testnet XRPL endpoints', () => {
    expect(validProviderValues('tavily', { redirect: 'https://example.test' })).toBe(false)
    expect(validProviderValues('xrpl', { testnetUrl: 'wss://example.test', executionMode: 'live' })).toBe(false)
  })
})
