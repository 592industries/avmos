import { infrastructureResourceSchema, telemetryTrendSchema, type InfrastructureResource, type TelemetryTrend } from '../domain/operations'

export interface TelemetrySource {
  getResource(resourceId: string, signal?: AbortSignal): Promise<InfrastructureResource>
  getStorageTrend(resourceId: string, signal?: AbortSignal): Promise<TelemetryTrend>
  health(resourceId?: string, signal?: AbortSignal): Promise<boolean>
}

export type NewRelicConfig = {
  userKey: string
  accountId: number
  entityGuid: string
  region: 'US' | 'EU' | 'JP'
  resourceId: string
}

const ENDPOINTS = {
  US: 'https://api.newrelic.com/graphql',
  EU: 'https://api.eu.newrelic.com/graphql',
  JP: 'https://api.jp.newrelic.com/graphql',
} as const

export class NewRelicTelemetryAdapter implements TelemetrySource {
  constructor(private readonly config: NewRelicConfig) {
    if (!Number.isSafeInteger(config.accountId) || config.accountId <= 0 || !config.userKey || !config.entityGuid || !ENDPOINTS[config.region]) {
      throw new Error('New Relic configuration is incomplete.')
    }
  }

  async getResource(resourceId: string, signal?: AbortSignal): Promise<InfrastructureResource> {
    this.assertResource(resourceId)
    const rows = await this.query(
      `FROM StorageSample SELECT latest(diskUsedPercent) AS utilization, latest(timestamp) AS observedAt, latest(hostname) AS hostname, latest(diskTotalBytes) AS totalBytes, latest(diskUsedBytes) AS usedBytes WHERE entityGuid = '${escapeNrql(this.config.entityGuid)}' SINCE 10 minutes ago`,
      signal,
    )
    const row = rows[0]
    if (!row) throw new Error('New Relic host is not reporting storage telemetry.')
    const utilization = finitePercent(row.utilization)
    const observedMs = Number(row.observedAt)
    if (!Number.isFinite(observedMs) || observedMs <= 0 || observedMs > Date.now() + 30_000) throw new Error('New Relic telemetry has no valid observation timestamp.')
    const receivedAt = new Date().toISOString()
    const freshnessSeconds = Math.max(0, Math.floor((Date.now() - observedMs) / 1000))
    const status = freshnessSeconds > 600 ? 'OFFLINE' : freshnessSeconds > 120 ? 'STALE' : 'LIVE'
    return infrastructureResourceSchema.parse({
      id: resourceId,
      hostname: typeof row.hostname === 'string' && row.hostname ? row.hostname : resourceId,
      type: 'server',
      status: status === 'OFFLINE' ? 'offline' : utilization >= 90 ? 'critical' : utilization >= 75 ? 'warning' : 'online',
      metrics: {
        storageUtilization: utilization,
        ...(finiteNonnegative(row.totalBytes) !== undefined ? { storageTotalGb: Number(row.totalBytes) / 1024 ** 3 } : {}),
        ...(finiteNonnegative(row.usedBytes) !== undefined ? { storageUsedGb: Number(row.usedBytes) / 1024 ** 3 } : {}),
      },
      alerts: [],
      lastUpdated: new Date(observedMs).toISOString(),
      receivedAt,
      sourceEntityId: this.config.entityGuid,
      telemetryStatus: status,
      freshnessSeconds,
      source: 'newrelic',
    })
  }

  async getStorageTrend(resourceId: string, signal?: AbortSignal): Promise<TelemetryTrend> {
    this.assertResource(resourceId)
    const rows = await this.query(
      `FROM StorageSample SELECT average(diskUsedPercent) AS utilization WHERE entityGuid = '${escapeNrql(this.config.entityGuid)}' TIMESERIES 1 hour SINCE 7 days ago`,
      signal,
    )
    const points = rows.flatMap((row) => {
      if (row.utilization === null || row.utilization === undefined) return []
      const value = Number(row.utilization)
      const seconds = Number(row.beginTimeSeconds)
      return Number.isFinite(value) && value >= 0 && value <= 100 && Number.isFinite(seconds) && seconds > 0 && seconds * 1000 <= Date.now() + 30_000
        ? [{ timestamp: new Date(seconds * 1000).toISOString(), value }]
        : []
    })
    points.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    if (points.length < 2) throw new Error('New Relic has insufficient historical storage samples.')
    if (Date.now() - Date.parse(points.at(-1)!.timestamp) > 2 * 60 * 60_000) throw new Error('New Relic storage trend is stale.')
    return telemetryTrendSchema.parse({ resourceId, metric: 'storage_utilization', points, source: 'newrelic' })
  }

  async health(resourceId = this.config.resourceId, signal?: AbortSignal): Promise<boolean> {
    try {
      return (await this.getResource(resourceId, signal)).telemetryStatus === 'LIVE'
    } catch {
      return false
    }
  }

  private assertResource(resourceId: string): void {
    if (resourceId !== this.config.resourceId) throw new Error('Resource is not mapped to the configured New Relic entity.')
  }

  private async query(nrql: string, signal?: AbortSignal): Promise<Record<string, unknown>[]> {
    const response = await fetch(ENDPOINTS[this.config.region], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'API-Key': this.config.userKey },
      body: JSON.stringify({
        query: `{ actor { account(id: ${this.config.accountId}) { nrql(query: ${JSON.stringify(nrql)}) { results } } } }`,
      }),
      signal,
    })
    if (!response.ok) throw new Error(`New Relic request failed (${response.status}).`)
    const body = await response.json() as { data?: { actor?: { account?: { nrql?: { results?: unknown } } } }; errors?: unknown[] }
    if (body.errors?.length || !Array.isArray(body.data?.actor?.account?.nrql?.results)) {
      throw new Error('New Relic returned an invalid NRQL response.')
    }
    return body.data.actor.account.nrql.results.filter(isObject)
  }
}

function escapeNrql(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finitePercent(value: unknown): number {
  if (value === null || value === undefined || value === '') throw new Error('New Relic returned invalid storage utilization.')
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0 || number > 100) throw new Error('New Relic returned invalid storage utilization.')
  return number
}

function finiteNonnegative(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}
