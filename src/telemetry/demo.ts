import { infrastructureResourceSchema, telemetryTrendSchema, type InfrastructureResource, type TelemetryTrend } from '../domain/operations'
import type { TelemetrySource } from './newrelic'

/** Explicit development fixture. Never selected by a missing credential. */
export class DemoTelemetryAdapter implements TelemetrySource {
  async getResource(resourceId: string): Promise<InfrastructureResource> {
    return infrastructureResourceSchema.parse({
      id: resourceId, hostname: resourceId, type: 'server', status: 'critical',
      metrics: { storageUtilization: 91, storageTotalGb: 1000, storageUsedGb: 910 },
      alerts: ['Demo storage utilization exceeded 90%'],
      lastUpdated: new Date().toISOString(), receivedAt: new Date().toISOString(),
      telemetryStatus: 'DEMO', freshnessSeconds: 0, source: 'demo',
    })
  }

  async getStorageTrend(resourceId: string): Promise<TelemetryTrend> {
    const now = Date.now()
    return telemetryTrendSchema.parse({
      resourceId, metric: 'storage_utilization', source: 'demo',
      points: [82, 84, 87, 89, 91].map((value, index) => ({
        timestamp: new Date(now - (4 - index) * 86_400_000).toISOString(), value,
      })),
    })
  }

  async health(): Promise<boolean> { return true }
}
