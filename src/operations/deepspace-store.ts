import type { ActionTools } from 'deepspace/worker'
import type { AuditEvent, InfrastructureResource, TelemetryTrend } from '../domain/operations'
import type { OperationAction, OperationsStore } from './orchestrator'
import type { ReserveRequest, ReserveResult } from './guard'
import type { Env } from '../../worker'

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

  async recordResource(resource: InfrastructureResource, trend: TelemetryTrend): Promise<void> {
    await expectSuccess(
      this.tools.create(
        'resources',
        {
          hostname: resource.hostname,
          type: resource.type,
          status: resource.status,
          telemetryStatus: resource.telemetryStatus ?? 'ERROR',
          telemetrySource: resource.source,
          historicalStatus: trend.source === 'demo' ? 'DEMO' : 'LIVE',
          historicalSource: trend.source,
          storageUtilization: resource.metrics.storageUtilization / 100,
          metrics: resource.metrics,
          trendPoints: trend.points,
          ...(resource.freshnessSeconds !== undefined ? { freshnessSeconds: resource.freshnessSeconds } : {}),
          ...(resource.sourceEntityId ? { sourceEntityId: resource.sourceEntityId } : {}),
          alerts: resource.alerts,
          lastObservedAt: resource.lastUpdated,
        },
        resource.id,
      ),
    )
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
          reasoning: action.reasoning,
          policyDecision: action.policyDecision,
          executionStatus: action.executionStatus,
          ...(action.policyId ? { policyId: action.policyId } : {}),
          ...(action.policyHash ? { policyHash: action.policyHash } : {}),
          ...(action.policySnapshot ? { policySnapshot: action.policySnapshot } : {}),
          ...(action.operationFingerprint ? { operationFingerprint: action.operationFingerprint } : {}),
          ...(action.auditStatus ? { auditStatus: action.auditStatus } : {}),
          ...(action.execution ? { execution: action.execution } : {}),
          createdAt: action.createdAt,
        },
        action.id,
      ),
    )
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
