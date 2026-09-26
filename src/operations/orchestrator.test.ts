import { describe, expect, it, vi } from 'vitest'
import { AgentRuntime, DemoAgentModel } from '../agent/runtime'
import { defaultPolicy, type AuditEvent, type InfrastructureResource } from '../domain/operations'
import { DemoHistoricalTelemetry } from '../telemetry/historical'
import { DemoTelemetryAdapter } from '../telemetry/librenms'
import type { PaymentExecutor } from '../xrpl/executor'
import { OperationsOrchestrator, type OperationAction, type OperationsStore } from './orchestrator'

class MemoryStore implements OperationsStore {
  actions: OperationAction[] = []
  audits: AuditEvent[] = []

  async recordResource(_resource: InfrastructureResource) {}
  async recordAgentRun() {}
  async recordAction(action: OperationAction) { this.actions.push(action) }
  async appendAudit(event: AuditEvent) { this.audits.push(event) }
  async spentToday() { return 0 }
}

function orchestrator(model: DemoAgentModel, executor: PaymentExecutor, store = new MemoryStore()) {
  return {
    store,
    value: new OperationsOrchestrator(
      new DemoTelemetryAdapter(),
      new DemoHistoricalTelemetry(),
      new AgentRuntime(model),
      defaultPolicy(),
      executor,
      store,
      { 'approved-storage-vendor': 'rProtectedVendorTestnet' },
    ),
  }
}

describe('operations security boundary', () => {
  it('never calls the XRPL executor for a denied action', async () => {
    const execute = vi.fn<PaymentExecutor['execute']>()
    const { value, store } = orchestrator(new DemoAgentModel(true), { execute })
    const result = await value.run('server1')

    expect(result.action.policyDecision.decision).toBe('DENIED')
    expect(execute).not.toHaveBeenCalled()
    expect(store.audits.some((event) => event.eventType === 'DENIED')).toBe(true)
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
    const result = await value.run('server1')

    expect(result.action.policyDecision.decision).toBe('APPROVED')
    expect(execute).toHaveBeenCalledOnce()
    expect(result.action.execution?.transactionHash).toBe('ABC123')
    expect(store.audits.at(-1)).toEqual(
      expect.objectContaining({ eventType: 'EXECUTION_SUCCEEDED', transactionHash: 'ABC123' }),
    )
  })

  it('records XRPL failure without reporting success', async () => {
    const execute = vi.fn<PaymentExecutor['execute']>().mockRejectedValue(new Error('ledger offline'))
    const { value, store } = orchestrator(new DemoAgentModel(), { execute })
    const result = await value.run('server1')

    expect(result.action.executionStatus).toBe('FAILED')
    expect(store.audits.at(-1)?.eventType).toBe('EXECUTION_FAILED')
    expect(result.action.execution?.error).toBe('ledger offline')
  })
})
