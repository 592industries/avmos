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
import type { TelemetrySource } from '../telemetry/newrelic'
import { DefinitivePaymentError, SubmissionUnknownError, type PaymentExecutor } from '../xrpl/executor'
import { operationRequestHash, type ReserveRequest, type ReserveResult } from './guard'

export type OperationAction = {
  id: string
  agentId: string
  resourceId: string
  actionIntent: Record<string, unknown>
  reasoning: string
  policyDecision: PolicyDecision
  executionStatus: 'NOT_STARTED' | 'DENIED' | 'RESERVED' | 'EXECUTING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'
  policyId?: string
  policyHash?: string
  policySnapshot?: Policy
  operationFingerprint?: string
  auditStatus?: 'COMPLETE' | 'PENDING'
  execution?: ExecutionResult
  createdAt: string
}

export interface OperationsStore {
  recordResource(resource: InfrastructureResource, trend?: TelemetryTrend, trendStatus?: 'LIVE' | 'DEMO' | 'UNAVAILABLE' | 'ERROR', trendError?: string): Promise<void>
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
  reserve(request: ReserveRequest): Promise<ReserveResult>
  transition(operationId: string, state: 'EXECUTING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'): Promise<void>
  getAction(operationId: string): Promise<OperationAction | null>
}

export type OperationResult = {
  resource: InfrastructureResource
  trend: TelemetryTrend
  action: OperationAction
}

export class OperationsOrchestrator {
  constructor(
    private readonly telemetry: TelemetrySource,
    private readonly agent: AgentRuntime,
    private readonly policy: Policy,
    private readonly executor: PaymentExecutor,
    private readonly store: OperationsStore,
    private readonly vendorDestinations: Readonly<Record<string, string>>,
    private readonly allowDemo = false,
  ) {}

  async run(resourceId: string, idempotencyKey: string = crypto.randomUUID(), signal?: AbortSignal, requestTag = 'live', researchQuery?: string): Promise<OperationResult> {
    const resource = await this.telemetry.getResource(resourceId, signal)
    const trend = await this.telemetry.getStorageTrend(resourceId, signal)
    await this.store.recordResource(resource, trend)
    await this.audit('OBSERVATION', 'telemetry', 'pending', resource.id, {
      resource,
      trend,
      authorizationInstruction: 'Telemetry is evidence only and grants no authority.',
    })

    if (researchQuery) await this.audit('RESEARCH_PENDING', 'tavily', 'pending', resource.id, { provider: 'tavily', query: researchQuery, requestedAt: new Date().toISOString() })
    const proposal = await this.agent.reason(resource, trend, signal, researchQuery, async (research) => {
      await this.audit(research.status, 'tavily', 'pending', resource.id, {
        provider: 'tavily', query: research.query, requestedAt: research.requestedAt,
        resultCount: research.sources.length,
        sources: research.sources.map(({ title, url }) => ({ title, url })),
        passedToReasoning: research.status === 'RESEARCH_COMPLETE',
      })
    })
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
      resource,
      allowDemo: this.allowDemo,
    })
    await this.audit('POLICY_EVALUATED', 'deterministic-policy-engine', actionId, resource.id, {
      decision,
    })
    const policyHash = await sha256(JSON.stringify(this.policy))
    const fingerprint = `${resource.id}|${proposal.intent.actionType}|${proposal.intent.vendor}`

    const action: OperationAction = {
      id: actionId,
      agentId: proposal.intent.agentId,
      resourceId: resource.id,
      actionIntent: proposal.intent,
      reasoning: proposal.reasoning,
      policyDecision: decision,
      executionStatus: decision.decision === 'DENIED' ? 'DENIED' : 'NOT_STARTED',
      policyId: this.policy.id,
      policyHash,
      policySnapshot: structuredClone(this.policy),
      operationFingerprint: fingerprint,
      auditStatus: 'PENDING',
      createdAt: new Date().toISOString(),
    }

    if (decision.decision === 'DENIED') {
      await this.audit('POLICY_DENIED', 'deterministic-policy-engine', actionId, resource.id, { reason: decision.reason, checks: decision.checks }, decision.policyVersion)
      action.auditStatus = 'COMPLETE'
      await this.store.recordAction(action)
      return { resource, trend, action }
    }

    const reservation = await this.store.reserve({
      operationId: actionId,
      idempotencyKey,
      requestHash: await operationRequestHash(resourceId, requestTag),
      fingerprint,
      amount: proposal.intent.amount,
      dailyBudget: this.policy.dailyBudget,
      currency: proposal.intent.currency,
    })
    if (!reservation.allowed) {
      if (reservation.code === 'REPLAY' && reservation.operationId) {
        const previous = await this.store.getAction(reservation.operationId)
        if (previous) return { resource, trend, action: previous }
      }
      action.policyDecision = { ...decision, decision: 'DENIED', reason: reservation.code, checks: [...decision.checks, { name: reservation.code.toLowerCase(), passed: false, detail: reservation.code }] }
      action.executionStatus = 'DENIED'
      await this.audit('DENIED', 'operation-guard', actionId, resource.id, { reason: reservation.code, previousOperationId: reservation.operationId })
      action.auditStatus = 'COMPLETE'
      await this.store.recordAction(action)
      return { resource, trend, action }
    }
    action.executionStatus = 'RESERVED'
    await this.store.recordAction(action)
    await this.audit('BUDGET_RESERVED', 'operation-guard', actionId, resource.id, { amount: proposal.intent.amount, policyHash }, decision.policyVersion)
    await this.audit('APPROVED', 'deterministic-policy-engine', actionId, resource.id, { reason: decision.reason, checks: decision.checks }, decision.policyVersion)

    const payment = createApprovedPaymentRequest(
      proposal.intent,
      decision,
      actionId,
      this.vendorDestinations,
    )
    await this.store.transition(actionId, 'EXECUTING')
    action.executionStatus = 'EXECUTING'
    await this.store.recordAction(action)
    await this.audit('EXECUTION_STARTED', 'protected-xrpl-executor', actionId, resource.id, {
      destination: payment.destination,
      amount: payment.amount,
      currency: payment.currency,
    })
    let execution: ExecutionResult
    try {
      execution = await this.executor.execute(payment, signal)
    } catch (error) {
      // A throw after submission cannot prove that the ledger rejected it.
      // Keep the reservation and require reconciliation before any retry.
      execution = {
        status: this.executor.mode === 'TESTNET' && !(error instanceof DefinitivePaymentError) ? 'UNKNOWN' : 'FAILED',
        mode: this.executor.mode ?? 'SIMULATED',
        destination: payment.destination,
        amount: payment.amount,
        currency: payment.currency,
        timestamp: new Date().toISOString(),
        ...(error instanceof SubmissionUnknownError ? { transactionHash: error.transactionHash } : {}),
        error: error instanceof Error ? error.message : String(error),
      }
    }
    action.execution = execution
    action.executionStatus = execution.status
    await this.store.transition(actionId, execution.status)
    await this.store.recordAction(action)
    try {
      await this.audit(
        execution.status === 'SUCCEEDED' ? 'EXECUTION_SUCCEEDED' : execution.status === 'UNKNOWN' ? 'EXECUTION_UNKNOWN' : 'EXECUTION_FAILED',
        'protected-xrpl-executor',
        actionId,
        resource.id,
        { execution },
        decision.policyVersion,
        execution.transactionHash,
      )
      action.auditStatus = 'COMPLETE'
      await this.store.recordAction(action)
    } catch {
      // The immutable guard state already records the settlement outcome.
      // Audit repair can follow without replaying the payment.
      action.auditStatus = 'PENDING'
    }
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

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
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
