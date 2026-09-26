import { afterEach, describe, expect, it, vi } from 'vitest'
import { OptionalResearchProvider, type ResearchProvider } from '../research/tavily'
import { TimescaleTelemetryBridge } from './historical'
import { LibreNmsAdapter } from './librenms'

afterEach(() => vi.unstubAllGlobals())

describe('telemetry adapters', () => {
  it('normalizes LibreNMS device and storage responses', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ devices: [{ device_id: 7, hostname: 'server1', type: 'server', status: 1 }] }),
      )
      .mockResolvedValueOnce(
        Response.json({
          storage: [{ storage_perc: 91, storage_size: 1_073_741_824_000, storage_used: 977_105_059_840 }],
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const resource = await new LibreNmsAdapter({
      baseUrl: 'https://librenms.example.test',
      apiKey: 'test-token',
    }).getResource('server1')

    expect(resource).toMatchObject({
      id: 'server1',
      hostname: 'server1',
      status: 'critical',
      source: 'librenms',
      metrics: { storageUtilization: 91 },
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://librenms.example.test/api/v0/devices/server1',
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Auth-Token': 'test-token' }) }),
    )
  })

  it('validates data returned by the read-only Timescale bridge', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          resourceId: 'server1',
          metric: 'storage_utilization',
          points: [
            { timestamp: '2026-09-25T00:00:00.000Z', value: 89 },
            { timestamp: '2026-09-26T00:00:00.000Z', value: 91 },
          ],
          source: 'timescale',
        }),
      ),
    )

    const trend = await new TimescaleTelemetryBridge(
      'https://telemetry.example.test',
      'read-only-token',
    ).getStorageTrend('server1')

    expect(trend.points.map((point) => point.value)).toEqual([89, 91])
  })

  it('refuses direct database connection strings', () => {
    expect(() => new TimescaleTelemetryBridge('postgres://user:pass@host/db')).toThrow(
      'read-only telemetry bridge',
    )
  })

  it('keeps Tavily failure optional', async () => {
    const unavailable: ResearchProvider = {
      search: async () => {
        throw new Error('offline')
      },
    }
    await expect(new OptionalResearchProvider(unavailable).search('storage docs')).resolves.toEqual({
      sources: [],
    })
  })
})
