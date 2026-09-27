import type { ActionTools } from 'deepspace/worker'
import { infrastructureResourceSchema, telemetryTrendSchema, type InfrastructureResource, type TelemetryTrend } from '../domain/operations'
import type { TelemetrySource } from './newrelic'

export class StoredTelemetrySource implements TelemetrySource {
  constructor(private readonly tools: ActionTools) {}
  async getResource(resourceId: string): Promise<InfrastructureResource> {
    const result = await this.tools.get('resources', resourceId)
    if (!result.success || !result.data.record?.data) throw new Error('Stored New Relic resource state is unavailable.')
    const data = result.data.record.data
    return infrastructureResourceSchema.parse({ id: resourceId, hostname: data.hostname, type: data.type, status: data.status, metrics: data.metrics, alerts: data.alerts ?? [], lastUpdated: data.lastObservedAt, receivedAt: data.lastQueryAt, sourceEntityId: data.sourceEntityId, telemetryStatus: data.telemetryStatus, freshnessSeconds: data.freshnessSeconds, source: data.telemetrySource })
  }
  async getStorageTrend(resourceId: string): Promise<TelemetryTrend> {
    const aggregates = await this.tools.query<{ resourceId: string; metric: string; bucketStart: string; average: number }>('telemetry-aggregates', { where: { resourceId, metric: 'storage_utilization' }, orderBy: 'bucketStart', orderDir: 'desc', limit: 168 })
    if (!aggregates.success) throw new Error(aggregates.error)
    let points = aggregates.data.records.map((row) => ({ timestamp: row.data.bucketStart, value: row.data.average })).reverse()
    if (points.length < 2) {
      const raw = await this.tools.query<{ resourceId: string; metric: string; observedAt: string; value?: number; status: string }>('telemetry-observations', { where: { resourceId, metric: 'storage_utilization' }, orderBy: 'observedAt', orderDir: 'desc', limit: 120 })
      if (!raw.success) throw new Error(raw.error)
      points = raw.data.records.flatMap((row) => row.data.status === 'LIVE' && row.data.value !== undefined ? [{ timestamp: row.data.observedAt, value: row.data.value }] : []).reverse()
    }
    if (points.length < 2) throw new Error('Stored telemetry has insufficient trend samples.')
    return telemetryTrendSchema.parse({ resourceId, metric: 'storage_utilization', points, source: 'newrelic' })
  }
  async health(resourceId = 'avmos') { try { return (await this.getResource(resourceId)).telemetryStatus === 'LIVE' } catch { return false } }
}
