import {
  infrastructureResourceSchema,
  type InfrastructureResource,
} from '../domain/operations'

export interface TelemetrySource {
  getResource(resourceId: string, signal?: AbortSignal): Promise<InfrastructureResource>
  health(signal?: AbortSignal): Promise<boolean>
}

type LibreNmsConfig = {
  baseUrl: string
  apiKey: string
}

export class LibreNmsAdapter implements TelemetrySource {
  constructor(private readonly config: LibreNmsConfig) {}

  async getResource(resourceId: string, signal?: AbortSignal): Promise<InfrastructureResource> {
    const device = await this.request<Record<string, unknown>>(
      `/api/v0/devices/${encodeURIComponent(resourceId)}`,
      signal,
    )
    const deviceData = firstObject(device.devices) ?? device
    const deviceId = stringValue(deviceData.device_id) ?? resourceId
    const storage = await this.request<Record<string, unknown>>(
      `/api/v0/devices/${encodeURIComponent(deviceId)}/health/storage`,
      signal,
    )
    const storageRows = arrayValue(storage.storage)
    const primary =
      storageRows
        .filter(isObject)
        .sort((a, b) => numberValue(b.storage_perc) - numberValue(a.storage_perc))[0] ?? {}
    const utilization = numberValue(
      primary.storage_perc ?? primary.percent_used ?? primary.storage_perc_warn,
    )
    const statusText = stringValue(deviceData.status) ?? 'unknown'

    return infrastructureResourceSchema.parse({
      id: resourceId,
      hostname: stringValue(deviceData.hostname) ?? resourceId,
      type: stringValue(deviceData.type) ?? 'server',
      status:
        statusText === '1' || statusText.toLowerCase() === 'up'
          ? utilization >= 90
            ? 'critical'
            : utilization >= 80
              ? 'warning'
              : 'online'
          : 'offline',
      metrics: {
        storageUtilization: utilization,
        storageTotalGb: bytesToGb(primary.storage_size),
        storageUsedGb: bytesToGb(primary.storage_used),
      },
      alerts: [],
      lastUpdated: new Date().toISOString(),
      source: 'librenms',
    })
  }

  async health(signal?: AbortSignal): Promise<boolean> {
    try {
      await this.request('/api/v0/system', signal)
      return true
    } catch {
      return false
    }
  }

  private async request<T = unknown>(path: string, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}${path}`, {
      headers: { 'X-Auth-Token': this.config.apiKey, Accept: 'application/json' },
      signal,
    })
    if (!response.ok) throw new Error(`LibreNMS request failed (${response.status})`)
    return response.json() as Promise<T>
  }
}

export class DemoTelemetryAdapter implements TelemetrySource {
  async getResource(resourceId: string): Promise<InfrastructureResource> {
    return infrastructureResourceSchema.parse({
      id: resourceId,
      hostname: resourceId,
      type: 'server',
      status: 'critical',
      metrics: { storageUtilization: 91, storageTotalGb: 1_000, storageUsedGb: 910 },
      alerts: ['Storage utilization exceeded 90%'],
      lastUpdated: new Date().toISOString(),
      source: 'demo',
    })
  }

  async health(): Promise<boolean> {
    return true
  }
}

function firstObject(value: unknown): Record<string, unknown> | undefined {
  return arrayValue(value).find(isObject) as Record<string, unknown> | undefined
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
}

function numberValue(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : 0
}

function bytesToGb(value: unknown): number | undefined {
  const bytes = numberValue(value)
  return bytes > 0 ? Math.round((bytes / 1024 ** 3) * 100) / 100 : undefined
}
