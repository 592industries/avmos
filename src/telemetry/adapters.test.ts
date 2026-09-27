import { afterEach, describe, expect, it, vi } from 'vitest'
import { OptionalResearchProvider, type ResearchProvider } from '../research/tavily'
import { NewRelicTelemetryAdapter } from './newrelic'

afterEach(() => vi.unstubAllGlobals())

const config = { userKey: 'user-key', accountId: 123, entityGuid: 'ENTITY', region: 'US' as const, resourceId: 'server1' }

describe('New Relic telemetry', () => {
  it('normalizes current and historical data from the fixed NerdGraph endpoint', async () => {
    const now = Date.now()
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: { actor: { account: { nrql: { results: [{ utilization: 91, observedAt: now, hostname: 'server1' }] } } } } }))
      .mockResolvedValueOnce(Response.json({ data: { actor: { account: { nrql: { results: [{ utilization: 89, beginTimeSeconds: Math.floor(now / 1000) - 3600 }, { utilization: 91, beginTimeSeconds: Math.floor(now / 1000) }] } } } } }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new NewRelicTelemetryAdapter(config)
    expect(await adapter.getResource('server1')).toMatchObject({ source: 'newrelic', telemetryStatus: 'LIVE', metrics: { storageUtilization: 91 } })
    expect((await adapter.getStorageTrend('server1')).points.map((point) => point.value)).toEqual([89, 91])
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.newrelic.com/graphql')
  })

  it('fails when the host has no samples', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { actor: { account: { nrql: { results: [] } } } } })))
    await expect(new NewRelicTelemetryAdapter(config).getResource('server1')).rejects.toThrow('not reporting')
  })

  it('keeps Tavily failure optional', async () => {
    const unavailable: ResearchProvider = { search: async () => { throw new Error('offline') } }
    await expect(new OptionalResearchProvider(unavailable).search('storage docs')).resolves.toEqual({ sources: [] })
  })
})
