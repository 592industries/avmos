import { telemetryTrendSchema, type TelemetryTrend } from '../domain/operations'

export interface HistoricalTelemetrySource {
  getStorageTrend(resourceId: string, signal?: AbortSignal): Promise<TelemetryTrend>
  health(signal?: AbortSignal): Promise<boolean>
}

export class TimescaleTelemetryBridge implements HistoricalTelemetrySource {
  constructor(
    private readonly baseUrl: string,
    private readonly bearerToken?: string,
  ) {
    if (!/^https:\/\//i.test(baseUrl)) {
      throw new Error(
        'TIMESCALEDB_URL must reference a narrow HTTPS read-only telemetry bridge, not a database connection string.',
      )
    }
  }

  async getStorageTrend(resourceId: string, signal?: AbortSignal): Promise<TelemetryTrend> {
    const url = new URL('/telemetry/storage-trend', this.baseUrl)
    url.searchParams.set('resourceId', resourceId)
    url.searchParams.set('window', '7d')
    const response = await fetch(url, {
      headers: this.bearerToken ? { Authorization: `Bearer ${this.bearerToken}` } : {},
      signal,
    })
    if (!response.ok) throw new Error(`Historical telemetry bridge failed (${response.status})`)
    return telemetryTrendSchema.parse(await response.json())
  }

  async health(signal?: AbortSignal): Promise<boolean> {
    try {
      const response = await fetch(new URL('/health', this.baseUrl), {
        headers: this.bearerToken ? { Authorization: `Bearer ${this.bearerToken}` } : {},
        signal,
      })
      return response.ok
    } catch {
      return false
    }
  }
}

export class DemoHistoricalTelemetry implements HistoricalTelemetrySource {
  async getStorageTrend(resourceId: string): Promise<TelemetryTrend> {
    const values = [82, 84, 87, 89, 91]
    const now = Date.now()
    return telemetryTrendSchema.parse({
      resourceId,
      metric: 'storage_utilization',
      points: values.map((value, index) => ({
        timestamp: new Date(now - (values.length - index - 1) * 24 * 60 * 60 * 1_000).toISOString(),
        value,
      })),
      source: 'demo',
    })
  }

  async health(): Promise<boolean> {
    return true
  }
}
