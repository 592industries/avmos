import type { ActionTools } from 'deepspace/worker'
import type { AuditEvent, InfrastructureResource, TelemetryObservation, TelemetryTrend } from '../domain/operations'
import type { OperationAction, OperationsStore } from './orchestrator'
import type { ReserveRequest, ReserveResult } from './guard'
import type { Env } from '../../worker'
import { expiry, hourBucket, retentionDays } from '../telemetry/retention'

type RecordEnvelope<T> = {
  recordId: string
  data: T
  createdAt: string
}

export class DeepSpaceOperationsStore implements OperationsStore {
  constructor(private readonly tools: ActionTools, private readonly env: Env) {}

  private async guard(path: string, body: unknown): Promise<Response> {
    const namespace = this.env.RECORD_ROOMS
    const stub = namespace.get(namespace.idFromName(`app:${this.env.DEEPSPACE_APP_ID}`))
    return stub.fetch(new Request(`https://internal/internal/avmos/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }))
  }

  async reserve(request: ReserveRequest): Promise<ReserveResult> {
    const response = await this.guard('reserve', request)
    if (!response.ok) throw new Error('Operation reservation unavailable.')
    return response.json() as Promise<ReserveResult>
  }

  async transition(operationId: string, state: 'EXECUTING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'): Promise<void> {
    const response = await this.guard('transition', { operationId, state })
    if (!response.ok) throw new Error('Operation transition unavailable.')
  }

  async getAction(operationId: string): Promise<OperationAction | null> {
    const result = await this.tools.get('actions', operationId)
    if (!result.success) return null
    const record = (result.data as unknown as { record?: { data?: OperationAction } }).record
    return record?.data ? { ...record.data, id: operationId } : null
  }

  async recordResource(resource: InfrastructureResource, trend?: TelemetryTrend, trendStatus?: 'LIVE' | 'DEMO' | 'UNAVAILABLE' | 'ERROR', trendError?: string): Promise<void> {
    const historicalStatus = trendStatus ?? (trend?.source === 'demo' ? 'DEMO' : trend ? 'LIVE' : 'UNAVAILABLE')
    await expectSuccess(
      this.tools.create(
        'resources',
        {
          hostname: resource.hostname,
          type: resource.type,
          status: resource.status,
          telemetryStatus: resource.telemetryStatus ?? 'ERROR',
          telemetrySource: resource.source,
          historicalStatus,
          historicalSource: trend?.source ?? resource.source,
          ...(resource.metrics.storageUtilization !== undefined ? { storageUtilization: resource.metrics.storageUtilization / 100 } : {}),
          metrics: resource.metrics,
          trendPoints: trend?.points ?? [],
          trendStatus: historicalStatus,
          ...(trendError ? { trendError: trendError.slice(0, 240) } : {}),
          ...(resource.freshnessSeconds !== undefined ? { freshnessSeconds: resource.freshnessSeconds } : {}),
          ...(resource.sourceEntityId ? { sourceEntityId: resource.sourceEntityId } : {}),
          alerts: resource.alerts,
          lastObservedAt: resource.lastUpdated,
          lastQueryAt: new Date().toISOString(),
          lastQueryStatus: 'SUCCESS',
        },
        resource.id,
      ),
    )
  }

  async recordTelemetrySnapshot(resource: InfrastructureResource, observations: TelemetryObservation[]): Promise<void> {
    await this.recordResource(resource)
    const expiration = expiry(retentionDays(this.env).observations)
    for (const observation of observations) {
      const data = { ...observation, hourBucket: hourBucket(observation.observedAt), ...expiration }
      await expectSuccess(this.tools.create('current-telemetry', observation, `${observation.resourceId}:${observation.metric}`))
      await expectSuccess(this.tools.create('telemetry-observations', data, `obs:${observation.resourceId}:${observation.metric}:${Date.parse(observation.observedAt)}`))
    }
    const storage = observations.find((item) => item.metric === 'storage_utilization')
    if (storage?.value !== undefined && storage.status === 'LIVE') await this.updateStorageAlert(storage)
  }

  private async updateStorageAlert(observation: TelemetryObservation): Promise<void> {
    const id = `${observation.resourceId}:storage_utilization`
    const existing = await this.tools.get<{ status?: string; openedAt?: string }>('alerts', id)
    const current = existing.success ? existing.data.record?.data : undefined
    const severity = observation.value! >= 90 ? 'CRITICAL' : observation.value! >= 75 ? 'WARNING' : 'HEALTHY'
    if (severity !== 'HEALTHY') {
      const now = new Date().toISOString()
      await expectSuccess(this.tools.create('alerts', { resourceId: observation.resourceId, metric: observation.metric, severity, status: 'ACTIVE', value: observation.value, threshold: severity === 'CRITICAL' ? 90 : 75, openedAt: current?.openedAt ?? now, updatedAt: now, expiresAt: '9999-12-31T23:59:59.999Z', expiresOn: '9999-12-31' }, id))
    } else if (current?.status === 'ACTIVE') {
      const now = new Date(); await expectSuccess(this.tools.update('alerts', id, { status: 'RESOLVED', severity: 'RESOLVED', value: observation.value, updatedAt: now.toISOString(), resolvedAt: now.toISOString(), ...expiry(retentionDays(this.env).alerts, now) }))
    }
  }

  async recordTelemetryFailure(resourceId: string, status: 'UNAVAILABLE' | 'ERROR'): Promise<void> {
    const previous = await this.tools.get('resources', resourceId)
    const data = previous.success
      ? (previous.data as { record?: { data?: Record<string, unknown> } }).record?.data
      : undefined
    const lastObservedAt = typeof data?.lastObservedAt === 'string' ? data.lastObservedAt : new Date(0).toISOString()
    await expectSuccess(this.tools.create('resources', {
      hostname: resourceId,
      type: 'server',
      status: 'unknown',
      telemetryStatus: status,
      telemetrySource: 'newrelic',
      historicalStatus: 'UNAVAILABLE',
      historicalSource: 'newrelic',
      trendStatus: 'UNAVAILABLE',
      ...(data?.storageUtilization !== undefined ? { storageUtilization: data.storageUtilization } : {}),
      metrics: data?.metrics ?? {},
      trendPoints: data?.trendPoints ?? [],
      ...(data?.sourceEntityId ? { sourceEntityId: data.sourceEntityId } : {}),
      alerts: [],
      lastObservedAt,
      lastQueryAt: new Date().toISOString(),
      lastQueryStatus: status,
    }, resourceId))
    const failedAt = new Date().toISOString()
    for (const metric of ['cpu_utilization', 'memory_utilization', 'storage_utilization', 'network_receive_bytes_per_second', 'network_transmit_bytes_per_second'] as const) {
      const id = `${resourceId}:${metric}`
      const current = await this.tools.get<Record<string, unknown>>('current-telemetry', id)
      const prior = current.success ? current.data.record?.data : undefined
      await expectSuccess(this.tools.create('current-telemetry', {
        ...(prior ?? {}),
        resourceId,
        provider: 'new_relic',
        metric,
        unit: metric.startsWith('network_') ? 'bytes_per_second' : 'percent',
        observedAt: typeof prior?.observedAt === 'string' ? prior.observedAt : failedAt,
        receivedAt: failedAt,
        freshnessMs: typeof prior?.freshnessMs === 'number' ? prior.freshnessMs : 0,
        status,
        metadata: typeof prior?.metadata === 'object' && prior.metadata ? prior.metadata : {},
      }, id))
    }
  }

  async recordAgentRun(agent: {
    id: string
    name: string
    status: string
    modelProvider: string
    model: string
    lastRunAt: string
  }): Promise<void> {
    await expectSuccess(
      this.tools.create(
        'agents',
        {
          name: agent.name,
          status: agent.status,
          modelProvider: agent.modelProvider,
          model: agent.model,
          lastRunAt: agent.lastRunAt,
        },
        agent.id,
      ),
    )
  }

  async recordAction(action: OperationAction): Promise<void> {
    await expectSuccess(
      this.tools.create(
        'actions',
        {
          agentId: action.agentId,
          resourceId: action.resourceId,
          actionIntent: action.actionIntent,
          ...(action.decisionSummary ? { decisionSummary: action.decisionSummary } : {}),
          ...(action.providerId ? { providerId: action.providerId } : {}),
          policyDecision: action.policyDecision,
          executionStatus: action.executionStatus,
          ...(action.policyId ? { policyId: action.policyId } : {}),
          ...(action.policyHash ? { policyHash: action.policyHash } : {}),
          ...(action.policySnapshot ? { policySnapshot: action.policySnapshot } : {}),
          ...(action.operationFingerprint ? { operationFingerprint: action.operationFingerprint } : {}),
          ...(action.auditStatus ? { auditStatus: action.auditStatus } : {}),
          ...(action.execution ? { execution: action.execution } : {}),
          createdAt: action.createdAt,
          ...expiry(retentionDays(this.env).actions, new Date(action.createdAt)),
        },
        action.id,
      ),
    )
  }

  async recordPolicyDecision(action: OperationAction): Promise<void> {
    const decidedAt = action.policyDecision.timestamp
    await expectSuccess(this.tools.create('policy-decisions', { actionId: action.id, resourceId: action.resourceId, policyId: action.policyId ?? 'unknown', ...(action.providerId ? { providerId: action.providerId } : {}), decision: action.policyDecision.decision, checks: action.policyDecision.checks, decidedAt, ...expiry(retentionDays(this.env).decisions, new Date(decidedAt)) }, action.id))
  }

  async appendAudit(event: AuditEvent): Promise<void> {
    await expectSuccess(
      this.tools.create(
        'audit-events',
        {
          timestamp: event.timestamp,
          actor: event.actor,
          eventType: event.eventType,
          actionId: event.actionId,
          resourceId: event.resourceId,
          ...(event.policyVersion ? { policyVersion: event.policyVersion } : {}),
          details: event.details,
          ...(event.transactionHash ? { transactionHash: event.transactionHash } : {}),
          ...expiry(retentionDays(this.env).audit, new Date(event.timestamp)),
        },
        event.id,
      ),
    )
  }

  async spentToday(): Promise<number> {
    const result = await this.tools.query('actions', { limit: 500 })
    if (!result.success) throw new Error(result.error)
    const start = new Date()
    start.setUTCHours(0, 0, 0, 0)
    return (
      result.data as { records: Array<RecordEnvelope<{ executionStatus?: string; execution?: unknown }>> }
    ).records.reduce((total, record) => {
      if (new Date(record.createdAt) < start || record.data.executionStatus !== 'SUCCEEDED') {
        return total
      }
      const execution = record.data.execution
      if (!isObject(execution) || typeof execution.amount !== 'number') return total
      return total + execution.amount
    }, 0)
  }
}

async function expectSuccess(result: ReturnType<ActionTools['create']>): Promise<void> {
  const settled = await result
  if (!settled.success) throw new Error(settled.error)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
