import type { InfrastructureResource, TelemetryMetric, TelemetryObservation, TelemetryStatus } from '../domain/operations'

export interface TelemetrySource {
  getResource(resourceId: string, signal?: AbortSignal): Promise<InfrastructureResource>
  getStorageTrend(resourceId: string, signal?: AbortSignal): Promise<{ resourceId: string; metric: 'storage_utilization'; points: Array<{ timestamp: string; value: number }>; source: 'newrelic' | 'demo' }>
  health(resourceId?: string, signal?: AbortSignal): Promise<boolean>
}
export type TelemetrySnapshot = { resource: InfrastructureResource; observations: TelemetryObservation[] }
export type NewRelicConfig = { userKey: string; accountId: number; entityGuid: string; region: 'US' | 'EU' | 'JP'; resourceId: string }
const ENDPOINTS = { US: 'https://api.newrelic.com/graphql', EU: 'https://api.eu.newrelic.com/graphql', JP: 'https://api.jp.newrelic.com/graphql' } as const

export class NewRelicTelemetryAdapter implements TelemetrySource {
  constructor(private readonly config: NewRelicConfig) {
    if (!Number.isSafeInteger(config.accountId) || config.accountId <= 0 || !config.userKey || !config.entityGuid || !ENDPOINTS[config.region]) throw new Error('New Relic configuration is incomplete.')
  }
  async getSnapshot(resourceId: string, signal?: AbortSignal): Promise<TelemetrySnapshot> {
    this.assertResource(resourceId)
    const receivedAt = new Date().toISOString()
    const [system, storage, network] = await Promise.allSettled([
      this.query(`FROM SystemSample SELECT latest(cpuPercent) AS cpu, latest(memoryUsedPercent) AS memory, latest(timestamp) AS observedAt, latest(hostname) AS hostname WHERE entityGuid = '${escapeNrql(this.config.entityGuid)}' SINCE 10 minutes ago`, signal),
      this.query(`FROM StorageSample SELECT latest(diskUsedPercent) AS utilization, latest(diskTotalBytes) AS totalBytes, latest(diskUsedBytes) AS usedBytes, latest(timestamp) AS observedAt, latest(hostname) AS hostname FACET mountPoint WHERE entityGuid = '${escapeNrql(this.config.entityGuid)}' SINCE 10 minutes ago LIMIT MAX`, signal),
      this.query(`FROM NetworkSample SELECT latest(receiveBytesPerSecond) AS received, latest(transmitBytesPerSecond) AS transmitted, latest(timestamp) AS observedAt FACET interfaceName WHERE entityGuid = '${escapeNrql(this.config.entityGuid)}' SINCE 10 minutes ago LIMIT MAX`, signal),
    ])
    if (system.status === 'rejected' && storage.status === 'rejected' && network.status === 'rejected') throw new Error('New Relic infrastructure telemetry is unavailable.')
    const observations: TelemetryObservation[] = []
    let hostname = resourceId
    const add = (metric: TelemetryMetric, unit: TelemetryObservation['unit'], value: unknown, observed: unknown, metadata: Record<string, unknown> = {}, forcedStatus?: TelemetryStatus) => {
      const number = optionalFinite(value); const observedMs = Number(observed)
      const validTime = Number.isFinite(observedMs) && observedMs > 0 && observedMs <= Date.now() + 30_000
      const freshnessMs = validTime ? Math.max(0, Date.now() - observedMs) : 0
      const status: TelemetryStatus = forcedStatus ?? (number === undefined || !validTime ? 'UNAVAILABLE' : freshnessMs > 600_000 ? 'UNAVAILABLE' : freshnessMs > 120_000 ? 'STALE' : 'LIVE')
      observations.push({ resourceId, provider: 'new_relic', metric, ...(number !== undefined ? { value: number } : {}), unit, observedAt: validTime ? new Date(observedMs).toISOString() : receivedAt, receivedAt, freshnessMs, status, sourceEntityGuid: this.config.entityGuid, metadata })
    }
    if (system.status === 'fulfilled' && system.value[0]) { const row = system.value[0]; if (typeof row.hostname === 'string' && row.hostname) hostname = row.hostname; add('cpu_utilization', 'percent', row.cpu, row.observedAt); add('memory_utilization', 'percent', row.memory, row.observedAt) }
    else { const failed = system.status === 'rejected' ? 'ERROR' : undefined; add('cpu_utilization', 'percent', undefined, undefined, {}, failed); add('memory_utilization', 'percent', undefined, undefined, {}, failed) }
    const disks = storage.status === 'fulfilled' ? storage.value : []
    const disk = disks.filter((row) => optionalPercent(row.utilization) !== undefined).sort((a, b) => Number(b.utilization) - Number(a.utilization))[0]
    if (disk) { if (typeof disk.hostname === 'string' && disk.hostname) hostname = disk.hostname; add('storage_utilization', 'percent', disk.utilization, disk.observedAt, { mountPoint: disk.facet ?? disk.mountPoint, totalBytes: optionalFinite(disk.totalBytes), usedBytes: optionalFinite(disk.usedBytes) }) }
    else add('storage_utilization', 'percent', undefined, undefined, {}, storage.status === 'rejected' ? 'ERROR' : undefined)
    const networks = network.status === 'fulfilled' ? network.value : []
    const newest = networks.reduce((max, row) => Math.max(max, Number(row.observedAt) || 0), 0)
    const networkFailure = network.status === 'rejected' ? 'ERROR' : undefined
    add('network_receive_bytes_per_second', 'bytes_per_second', sum(networks, 'received'), newest, { interfaces: networks.length }, networkFailure)
    add('network_transmit_bytes_per_second', 'bytes_per_second', sum(networks, 'transmitted'), newest, { interfaces: networks.length }, networkFailure)
    const storageObservation = observations.find((item) => item.metric === 'storage_utilization')!
    const metricValues = Object.fromEntries(observations.flatMap((item) => item.value === undefined ? [] : [[metricField(item.metric), item.value]])) as Record<string, number>
    if (disk && optionalFinite(disk.totalBytes) !== undefined) metricValues.storageTotalGb = Number(disk.totalBytes) / 1024 ** 3
    if (disk && optionalFinite(disk.usedBytes) !== undefined) metricValues.storageUsedGb = Number(disk.usedBytes) / 1024 ** 3
    const storageValue = storageObservation.value
    const status = storageObservation.status === 'LIVE' ? storageValue! >= 90 ? 'critical' : storageValue! >= 75 ? 'warning' : 'online' : storageObservation.status === 'STALE' ? 'warning' : 'unknown'
    return { resource: { id: resourceId, hostname, type: 'server', status, metrics: metricValues, alerts: [], lastUpdated: storageObservation.observedAt, receivedAt, sourceEntityId: this.config.entityGuid, telemetryStatus: storageObservation.status, freshnessSeconds: Math.floor(storageObservation.freshnessMs / 1000), source: 'newrelic' }, observations }
  }
  async getResource(resourceId: string, signal?: AbortSignal) { return (await this.getSnapshot(resourceId, signal)).resource }
  async getStorageTrend(): Promise<never> { throw new Error('Historical telemetry is read from DeepSpace.') }
  async health(resourceId = this.config.resourceId, signal?: AbortSignal) { return (await this.getSnapshot(resourceId, signal)).resource.telemetryStatus === 'LIVE' }
  private assertResource(resourceId: string) { if (resourceId !== this.config.resourceId) throw new Error('Resource is not mapped to the configured New Relic entity.') }
  private async query(nrql: string, signal?: AbortSignal): Promise<Record<string, unknown>[]> {
    const response = await fetch(ENDPOINTS[this.config.region], { method: 'POST', headers: { 'Content-Type': 'application/json', 'API-Key': this.config.userKey }, body: JSON.stringify({ query: `{ actor { account(id: ${this.config.accountId}) { nrql(query: ${JSON.stringify(nrql)}) { results } } } }` }), signal })
    if (!response.ok) throw new Error(`New Relic request failed (${response.status}).`)
    const body = await response.json() as { data?: { actor?: { account?: { nrql?: { results?: unknown } } } }; errors?: unknown[] }
    if (body.errors?.length || !Array.isArray(body.data?.actor?.account?.nrql?.results)) throw new Error('New Relic returned an invalid NRQL response.')
    return body.data.actor.account.nrql.results.filter(isObject)
  }
}
function metricField(metric: TelemetryMetric) { return ({ cpu_utilization: 'cpuUtilization', memory_utilization: 'memoryUtilization', storage_utilization: 'storageUtilization', network_receive_bytes_per_second: 'networkReceiveBytesPerSecond', network_transmit_bytes_per_second: 'networkTransmitBytesPerSecond' } as const)[metric] }
function sum(rows: Record<string, unknown>[], field: string): number | undefined { const values = rows.map((row) => optionalFinite(row[field])).filter((value): value is number => value !== undefined); return values.length ? values.reduce((a, b) => a + b, 0) : undefined }
function optionalFinite(value: unknown): number | undefined { if (value === null || value === undefined || value === '') return undefined; const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : undefined }
function optionalPercent(value: unknown) { const number = optionalFinite(value); return number !== undefined && number <= 100 ? number : undefined }
function escapeNrql(value: string) { return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'") }
function isObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
