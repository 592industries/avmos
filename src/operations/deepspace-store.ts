import type { ActionTools } from 'deepspace/worker'
import type { AuditEvent, InfrastructureResource, TelemetryTrend } from '../domain/operations'
import type { OperationAction, OperationsStore } from './orchestrator'

type RecordEnvelope<T> = {
  recordId: string
  data: T
  createdAt: string
}

export class DeepSpaceOperationsStore implements OperationsStore {
  constructor(private readonly tools: ActionTools) {}

  async recordResource(resource: InfrastructureResource, trend: TelemetryTrend): Promise<void> {
    await expectSuccess(
      this.tools.create(
        'resources',
        {
          hostname: resource.hostname,
          type: resource.type,
          status: resource.status,
          telemetryStatus: 'CONNECTED',
          telemetrySource: resource.source,
          historicalStatus: 'CONNECTED',
          historicalSource: trend.source,
          storageUtilization: resource.metrics.storageUtilization / 100,
          metrics: resource.metrics,
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
