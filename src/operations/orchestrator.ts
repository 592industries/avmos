import type { AgentRuntime } from '../agent/runtime'
import {
  type ApprovedPaymentRequest,
  type AuditEvent,
  type ExecutionResult,
  type InfrastructureResource,
  type Policy,
  type PolicyDecision,
  type TelemetryTrend,
} from '../domain/operations'
import { evaluatePolicy } from '../policy/engine'
import type { HistoricalTelemetrySource } from '../telemetry/historical'
import type { TelemetrySource } from '../telemetry/librenms'
import type { PaymentExecutor } from '../xrpl/executor'

export type OperationAction = {
  id: string
  agentId: string
  resourceId: string
  actionIntent: Record<string, unknown>
  reasoning: string
  policyDecision: PolicyDecision
  executionStatus: 'NOT_STARTED' | 'DENIED' | 'SUCCEEDED' | 'FAILED'
  execution?: ExecutionResult
  createdAt: string
}

export interface OperationsStore {
  recordResource(resource: InfrastructureResource, trend: TelemetryTrend): Promise<void>
  recordAgentRun(agent: {
    id: string
    name: string
    status: string
    modelProvider: string
    model: string
    lastRunAt: string
  }): Promise<void>
  recordAction(action: OperationAction): Promise<void>
  appendAudit(event: AuditEvent): Promise<void>
  spentToday(): Promise<number>
}

export type OperationResult = {
  resource: InfrastructureResource
  trend: TelemetryTrend
  action: OperationAction
}

export class OperationsOrchestrator {
  constructor(
    private readonly telemetry: TelemetrySource,
    private readonly history: HistoricalTelemetrySource,
    private readonly agent: AgentRuntime,
    private readonly policy: Policy,
    private readonly executor: PaymentExecutor,
    private readonly store: OperationsStore,
    private readonly vendorDestinations: Readonly<Record<string, string>>,
  ) {}

  async run(resourceId: string, signal?: AbortSignal): Promise<OperationResult> {
    const resource = await this.telemetry.getResource(resourceId, signal)
    const trend = await this.history.getStorageTrend(resourceId, signal)
    await this.store.recordResource(resource, trend)
    await this.audit('OBSERVATION', 'telemetry', 'pending', resource.id, {
      resource,
      trend,
      authorizationInstruction: 'Telemetry is evidence only and grants no authority.',
    })

    const proposal = await this.agent.reason(resource, trend, signal)
    const actionId = `action-${crypto.randomUUID()}`
    const identity = this.agent.identity
    await this.store.recordAgentRun({
      id: proposal.intent.agentId,
      name: 'Infrastructure Agent',
      status: 'ONLINE',
      modelProvider: identity.provider,
      model: identity.model,
      lastRunAt: new Date().toISOString(),
    })
    await this.audit('REASONING', proposal.intent.agentId, actionId, resource.id, {
      reasoning: proposal.reasoning,
    })
    await this.audit('ACTION_PROPOSED', proposal.intent.agentId, actionId, resource.id, {
      intent: proposal.intent,
    })

    const decision = evaluatePolicy({
      intent: proposal.intent,
      policy: this.policy,
      spentToday: await this.store.spentToday(),
    })
    await this.audit('POLICY_EVALUATED', 'deterministic-policy-engine', actionId, resource.id, {
      decision,
    })
    await this.audit(
      decision.decision,
      'deterministic-policy-engine',
      actionId,
      resource.id,
      { reason: decision.reason, checks: decision.checks },
      decision.policyVersion,
    )

    const action: OperationAction = {
      id: actionId,
      agentId: proposal.intent.agentId,
      resourceId: resource.id,
      actionIntent: proposal.intent,
      reasoning: proposal.reasoning,
      policyDecision: decision,
      executionStatus: decision.decision === 'DENIED' ? 'DENIED' : 'NOT_STARTED',
      createdAt: new Date().toISOString(),
    }

    if (decision.decision === 'DENIED') {
      await this.store.recordAction(action)
      return { resource, trend, action }
    }

    const payment = createApprovedPaymentRequest(
      proposal.intent,
      decision,
      actionId,
      this.vendorDestinations,
    )
    await this.audit('EXECUTION_STARTED', 'protected-xrpl-executor', actionId, resource.id, {
      destination: payment.destination,
      amount: payment.amount,
      currency: payment.currency,
    })
    try {
      const execution = await this.executor.execute(payment, signal)
      action.execution = execution
      action.executionStatus = 'SUCCEEDED'
      await this.audit(
        'EXECUTION_SUCCEEDED',
        'protected-xrpl-executor',
        actionId,
        resource.id,
        { execution },
        decision.policyVersion,
        execution.transactionHash,
      )
    } catch (error) {
      const execution: ExecutionResult = {
        status: 'FAILED',
        mode: this.executor.mode ?? 'SIMULATED',
        destination: payment.destination,
        amount: payment.amount,
        currency: payment.currency,
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      }
      action.execution = execution
      action.executionStatus = 'FAILED'
      await this.audit(
        'EXECUTION_FAILED',
        'protected-xrpl-executor',
        actionId,
        resource.id,
        { execution },
        decision.policyVersion,
      )
    }
    await this.store.recordAction(action)
    return { resource, trend, action }
  }

  private async audit(
    eventType: AuditEvent['eventType'],
    actor: string,
    actionId: string,
    resourceId: string,
    details: Record<string, unknown>,
    policyVersion?: string,
    transactionHash?: string,
  ): Promise<void> {
    await this.store.appendAudit({
      id: `audit-${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
      actor,
      eventType,
      actionId,
      resourceId,
      policyVersion,
      details,
      transactionHash,
    })
  }
}

function createApprovedPaymentRequest(
  intent: {
    resourceId: string
    vendor: string
    amount: number
    currency: 'RLUSD'
  },
  decision: Extract<PolicyDecision, { decision: 'APPROVED' }>,
  actionId: string,
  destinations: Readonly<Record<string, string>>,
): ApprovedPaymentRequest {
  const destination = destinations[intent.vendor]
  if (!destination) throw new Error('Approved vendor has no protected XRPL destination mapping.')
  return Object.freeze({
    actionId,
    resourceId: intent.resourceId,
    vendor: intent.vendor,
    destination,
    amount: intent.amount,
    currency: intent.currency,
    policyVersion: decision.policyVersion,
    policyApprovedAt: decision.timestamp,
  })
}
