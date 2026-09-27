import { afterEach, describe, expect, it, vi } from 'vitest'
import { OptionalResearchProvider, type ResearchProvider } from '../research/tavily'
import { NewRelicTelemetryAdapter } from './newrelic'

afterEach(() => vi.unstubAllGlobals())

const config = { userKey: 'user-key', accountId: 123, entityGuid: 'ENTITY', region: 'US' as const, resourceId: 'avmos' }

describe('New Relic telemetry', () => {
  it('normalizes current and historical data from the fixed NerdGraph endpoint', async () => {
    const now = Date.now()
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: { actor: { account: { nrql: { results: [{ utilization: 91, observedAt: now, hostname: 'avmos' }] } } } } }))
      .mockResolvedValueOnce(Response.json({ data: { actor: { account: { nrql: { results: [{ utilization: 89, beginTimeSeconds: Math.floor(now / 1000) - 3600 }, { utilization: 91, beginTimeSeconds: Math.floor(now / 1000) }] } } } } }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new NewRelicTelemetryAdapter(config)
    expect(await adapter.getResource('avmos')).toMatchObject({ source: 'newrelic', telemetryStatus: 'LIVE', metrics: { storageUtilization: 91 } })
    expect((await adapter.getStorageTrend('avmos')).points.map((point) => point.value)).toEqual([89, 91])
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.newrelic.com/graphql')
  })

  it('fails when the host has no samples', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { actor: { account: { nrql: { results: [] } } } } })))
    await expect(new NewRelicTelemetryAdapter(config).getResource('avmos')).rejects.toThrow('not reporting')
  })

  it('rejects an absent metric instead of displaying zero percent', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { actor: { account: { nrql: { results: [{ utilization: null, observedAt: Date.now() }] } } } } })))
    await expect(new NewRelicTelemetryAdapter(config).getResource('avmos')).rejects.toThrow('invalid storage utilization')
  })

  it('rejects stale historical evidence', async () => {
    const old = Math.floor(Date.now() / 1000) - 86_400
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { actor: { account: { nrql: { results: [{ utilization: 82, beginTimeSeconds: old - 3600 }, { utilization: 85, beginTimeSeconds: old }] } } } } })))
    await expect(new NewRelicTelemetryAdapter(config).getStorageTrend('avmos')).rejects.toThrow('trend is stale')
  })

  it('keeps Tavily failure optional', async () => {
    const unavailable: ResearchProvider = { search: async () => { throw new Error('offline') } }
    await expect(new OptionalResearchProvider(unavailable).search('storage docs')).resolves.toMatchObject({ status: 'RESEARCH_FAILED', query: 'storage docs', sources: [] })
  })
})
