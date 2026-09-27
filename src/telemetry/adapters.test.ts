import { afterEach, describe, expect, it, vi } from 'vitest'
import { OptionalResearchProvider, type ResearchProvider } from '../research/tavily'
import { NewRelicTelemetryAdapter } from './newrelic'

afterEach(() => vi.unstubAllGlobals())

const response = (results: unknown[]) => Response.json({ data: { actor: { account: { nrql: { results } } } } })
const emptyQueries = () => [
  vi.fn<typeof fetch>().mockResolvedValueOnce(response([])).mockResolvedValueOnce(response([])).mockResolvedValueOnce(response([])),
]

function fleetFetch(hosts: string[], now = Date.now()) {
  return vi.fn<typeof fetch>()
    .mockResolvedValueOnce(response(hosts.map((host) => ({ cpu: 21, memory: 47, observedAt: now, facet: host }))))
    .mockResolvedValueOnce(response(hosts.map((host) => ({ utilization: 63, totalBytes: 1000, usedBytes: 630, observedAt: now, facet: [host, '/'] }))))
    .mockResolvedValueOnce(response(hosts.map((host) => ({ received: 10, transmitted: 5, observedAt: now, facet: [host, 'eth0'] }))))
}

describe('New Relic fleet telemetry', () => {
  it('discovers every returned host when no prefix is configured', async () => {
    const now = Date.now()
    vi.stubGlobal('fetch', fleetFetch(['web-01.prod', 'db-primary', 'avmos-node-01'], now))
    const fleet = await new NewRelicTelemetryAdapter({ userKey: 'user-key', accountId: 123, region: 'US' }).getFleetSnapshots()
    expect(fleet.map((item) => item.resource.hostname)).toEqual(['avmos-node-01', 'db-primary', 'web-01.prod'])
    expect(fleet[2].resource.metrics).toMatchObject({ cpuUtilization: 21, memoryUtilization: 47, storageUtilization: 63 })
  })

  it('normalizes one host, ten hosts, and one hundred hosts', async () => {
    for (const count of [1, 10, 100]) {
      const hosts = Array.from({ length: count }, (_, index) => `host-${index}.internal`)
      vi.stubGlobal('fetch', fleetFetch(hosts))
      const fleet = await new NewRelicTelemetryAdapter({ userKey: 'user-key', accountId: 123, region: 'US' }).getFleetSnapshots()
      expect(fleet).toHaveLength(count)
      expect(fleet.every((item) => item.resource.hostname.startsWith('host-'))).toBe(true)
      vi.unstubAllGlobals()
    }
  })

  it('keeps an unexpected hostname and does not require avmos-node-NN', async () => {
    vi.stubGlobal('fetch', fleetFetch(['frontend-canary-7f3a']))
    const fleet = await new NewRelicTelemetryAdapter({ userKey: 'user-key', accountId: 123, region: 'US' }).getFleetSnapshots()
    expect(fleet.map((item) => item.resource.hostname)).toEqual(['frontend-canary-7f3a'])
  })

  it('optionally filters by an explicit prefix without inventing missing hosts', async () => {
    const now = Date.now()
    vi.stubGlobal('fetch', fleetFetch(['edge-01', 'edge-02', 'worker-9'], now))
    const fleet = await new NewRelicTelemetryAdapter({ userKey: 'user-key', accountId: 123, region: 'US', fleetPrefix: 'edge-' }).getFleetSnapshots()
    expect(fleet.map((item) => item.resource.hostname)).toEqual(['edge-01', 'edge-02'])
  })

  it('marks missing metrics unavailable instead of displaying zero', async () => {
    const now = Date.now()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(response([{ observedAt: now, facet: 'web-01' }])).mockResolvedValueOnce(response([])).mockResolvedValueOnce(response([])))
    const snapshot = await new NewRelicTelemetryAdapter({ userKey: 'user-key', accountId: 123, region: 'US' }).getSnapshot('web-01')
    expect(snapshot.observations.every((item) => item.status === 'UNAVAILABLE')).toBe(true)
    expect(snapshot.resource.metrics).not.toHaveProperty('storageUtilization')
    expect(snapshot.resource.status).toBe('offline')
  })

  it('marks a failed provider query as error while retaining successful metric groups', async () => {
    const now = Date.now()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(response([{ cpu: 22, memory: 61, observedAt: now, facet: 'web-01' }])).mockRejectedValueOnce(new Error('storage failed')).mockResolvedValueOnce(response([{ received: 100, transmitted: 50, observedAt: now, facet: ['web-01', 'eth0'] }])))
    const snapshot = await new NewRelicTelemetryAdapter({ userKey: 'user-key', accountId: 123, region: 'US' }).getSnapshot('web-01')
    expect(snapshot.observations.find((item) => item.metric === 'storage_utilization')?.status).toBe('ERROR')
    expect(snapshot.observations.find((item) => item.metric === 'cpu_utilization')?.status).toBe('LIVE')
  })

  it('marks stale samples without turning them healthy', async () => {
    const old = Date.now() - 180_000
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(response([{ cpu: 5, memory: 5, observedAt: old, facet: 'web-01' }])).mockResolvedValueOnce(response([{ utilization: 5, observedAt: old, facet: ['web-01', '/'] }])).mockResolvedValueOnce(response([{ received: 1, transmitted: 1, observedAt: old, facet: ['web-01', 'eth0'] }])))
    const snapshot = await new NewRelicTelemetryAdapter({ userKey: 'user-key', accountId: 123, region: 'US' }).getSnapshot('web-01')
    expect(snapshot.observations.some((item) => item.status === 'STALE')).toBe(true)
    expect(snapshot.resource.status).toBe('warning')
  })

  it('fails closed when the requested host is missing from the account', async () => {
    vi.stubGlobal('fetch', fleetFetch(['web-01']))
    await expect(new NewRelicTelemetryAdapter({ userKey: 'user-key', accountId: 123, region: 'US' }).getSnapshot('missing-host')).rejects.toThrow('unavailable from New Relic')
  })

  it('treats an empty account as no hosts rather than a healthy demo fleet', async () => {
    vi.stubGlobal('fetch', emptyQueries()[0])
    await expect(new NewRelicTelemetryAdapter({ userKey: 'user-key', accountId: 123, region: 'US' }).getFleetSnapshots()).resolves.toEqual([])
  })

  it('keeps Tavily failure optional', async () => {
    const unavailable: ResearchProvider = { search: async () => { throw new Error('offline') } }
    await expect(new OptionalResearchProvider(unavailable).search('storage docs')).resolves.toMatchObject({ status: 'RESEARCH_FAILED', sources: [] })
  })
})
