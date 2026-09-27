import { describe, expect, it, vi } from 'vitest'
import { AgentRuntime, DemoAgentModel } from '../agent/runtime'
import { defaultPolicy, type AuditEvent, type InfrastructureResource } from '../domain/operations'
import { DemoTelemetryAdapter } from '../telemetry/demo'
import type { PaymentExecutor } from '../xrpl/executor'
import { OperationsOrchestrator, type OperationAction, type OperationsStore } from './orchestrator'

class MemoryStore implements OperationsStore {
  actions: OperationAction[] = []
  audits: AuditEvent[] = []

  async recordResource(_resource: InfrastructureResource) {}
  async recordAgentRun() {}
  async recordAction(action: OperationAction) { this.actions.push(action) }
  async recordPolicyDecision() {}
  async appendAudit(event: AuditEvent) { this.audits.push(event) }
  async spentToday() { return 0 }
  async reserve(request: { operationId: string }) { return { allowed: true as const, operationId: request.operationId } }
  async transition() {}
  async getAction(operationId: string) { return this.actions.find((action) => action.id === operationId) ?? null }
}

function orchestrator(model: DemoAgentModel, executor: PaymentExecutor, store = new MemoryStore()) {
  return {
    store,
    value: new OperationsOrchestrator(
      new DemoTelemetryAdapter(),
      new AgentRuntime(model),
      defaultPolicy(),
      executor,
      store,
      { 'approved-storage-vendor': 'rProtectedVendorTestnet' },
      true,
      'workspace-default',
      true,
    ),
  }
}

describe('operations security boundary', () => {
  it('never calls the XRPL executor for a denied action', async () => {
    const execute = vi.fn<PaymentExecutor['execute']>()
    const { value, store } = orchestrator(new DemoAgentModel(true), { execute })
    const result = await value.run('avmos')

    expect(result.action.policyDecision.decision).toBe('DENIED')
    expect(result.action.actionIntent.amount).toBe(700)
    expect(result.action.policyDecision.checks.find((check) => check.name === 'transaction_limit')?.passed).toBe(false)
    expect(execute).not.toHaveBeenCalled()
    expect(store.audits.some((event) => event.eventType === 'POLICY_DENIED')).toBe(true)
    expect(store.audits.some((event) => event.eventType === 'EXECUTION_STARTED')).toBe(false)
  })

  it('executes only after approval and records the transaction hash', async () => {
    const execute = vi.fn<PaymentExecutor['execute']>().mockResolvedValue({
      status: 'SUCCEEDED',
      mode: 'TESTNET',
      transactionHash: 'ABC123',
      destination: 'rProtectedVendorTestnet',
      amount: 129,
      currency: 'RLUSD',
      ledgerResult: 'tesSUCCESS',
      timestamp: new Date().toISOString(),
    })
    const { value, store } = orchestrator(new DemoAgentModel(), { execute })
    const result = await value.run('avmos')

    expect(result.action.policyDecision.decision).toBe('APPROVED')
    expect(execute).toHaveBeenCalledOnce()
    expect(result.action.execution?.transactionHash).toBe('ABC123')
    expect(store.audits.at(-1)).toEqual(
      expect.objectContaining({ eventType: 'EXECUTION_SUCCEEDED', transactionHash: 'ABC123' }),
    )
  })

  it('does not call the executor when global autonomy is disabled', async () => {
    const execute = vi.fn<PaymentExecutor['execute']>()
    const store = new MemoryStore()
    const value = new OperationsOrchestrator(
      new DemoTelemetryAdapter(),
      new AgentRuntime(new DemoAgentModel()),
      defaultPolicy(),
      { execute },
      store,
      { 'approved-storage-vendor': 'rProtectedVendorTestnet' },
      true,
      'workspace-default',
      false,
    )
    const result = await value.run('avmos')
    expect(result.action.policyDecision.decision).toBe('DENIED')
    expect(result.action.policyDecision.checks).toContainEqual(expect.objectContaining({ name: 'global_autonomy_enabled', passed: false }))
    expect(execute).not.toHaveBeenCalled()
  })

  it('records XRPL failure without reporting success', async () => {
    const execute = vi.fn<PaymentExecutor['execute']>().mockRejectedValue(new Error('ledger offline'))
    const { value, store } = orchestrator(new DemoAgentModel(), { execute })
    const result = await value.run('avmos')

    expect(result.action.executionStatus).toBe('FAILED')
    expect(store.audits.at(-1)?.eventType).toBe('EXECUTION_FAILED')
    expect(result.action.execution?.error).toBe('ledger offline')
  })
})
