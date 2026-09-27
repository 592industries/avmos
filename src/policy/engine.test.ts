import { describe, expect, it } from 'vitest'
import { defaultPolicy, type ActionIntent, type InfrastructureResource } from '../domain/operations'
import { evaluatePolicy } from './engine'

const validIntent = (overrides: Partial<ActionIntent> = {}): ActionIntent => ({
  id: 'intent-1',
  agentId: 'infrastructure-agent',
  resourceId: 'avmos',
  actionType: 'purchase_storage',
  reason: 'Storage will be exhausted within four days.',
  evidence: ['Current storage utilization is 91%.'],
  vendor: 'approved-storage-vendor',
  amount: 129,
  currency: 'RLUSD',
  requestedAt: new Date().toISOString(),
  confidence: 0.94,
  metadata: {},
  ...overrides,
})
const validResource = (): InfrastructureResource => ({ id: 'avmos', hostname: 'avmos', type: 'server', status: 'critical', metrics: { storageUtilization: 91 }, alerts: [], lastUpdated: new Date().toISOString(), source: 'newrelic', telemetryStatus: 'LIVE' })

describe('deterministic policy engine', () => {
  it('approves a valid bounded action', () => {
    expect(evaluatePolicy({ intent: validIntent(), policy: defaultPolicy(), spentToday: 0, resource: validResource() }).decision)
      .toBe('APPROVED')
  })

  it('does not authorize spending below the 80% action threshold', () => {
    const decision = evaluatePolicy({ intent: validIntent(), policy: defaultPolicy(), spentToday: 0, resource: { ...validResource(), metrics: { storageUtilization: 79 } } })
    expect(decision.checks).toContainEqual(expect.objectContaining({ name: 'action_threshold', passed: false }))
  })

  it.each([
    ['amount too high', { amount: 4_700 }, 'transaction_limit'],
    ['vendor not allowlisted', { vendor: 'unknown-vendor' }, 'vendor_allowed'],
    ['resource not permitted', { resourceId: 'server9' }, 'resource_allowed'],
    ['agent not permitted', { agentId: 'rogue-agent' }, 'agent_allowed'],
  ] as const)('denies %s', (_name, overrides, failedCheck) => {
    const decision = evaluatePolicy({
      intent: validIntent(overrides),
      policy: defaultPolicy(),
      spentToday: 0,
    })
    expect(decision.decision).toBe('DENIED')
    expect(decision.checks).toContainEqual(expect.objectContaining({ name: failedCheck, passed: false }))
  })

  it('denies an action not permitted by policy', () => {
    const policy = { ...defaultPolicy(), allowedActions: ['restart_service'] }
    const decision = evaluatePolicy({ intent: validIntent(), policy, spentToday: 0 })
    expect(decision.decision).toBe('DENIED')
    expect(decision.checks).toContainEqual(
      expect.objectContaining({ name: 'action_allowed', passed: false }),
    )
  })

  it('denies when the daily budget is exhausted', () => {
    const decision = evaluatePolicy({
      intent: validIntent(),
      policy: defaultPolicy(),
      spentToday: 950,
    })
    expect(decision.decision).toBe('DENIED')
    expect(decision.checks).toContainEqual(
      expect.objectContaining({ name: 'daily_budget', passed: false }),
    )
  })

  it('fails closed for invalid model output', () => {
    const decision = evaluatePolicy({
      intent: { ...validIntent(), amount: '129', extraAuthority: true },
      policy: defaultPolicy(),
      spentToday: 0,
    })
    expect(decision.decision).toBe('DENIED')
    expect(decision.reason).toContain('schema validation')
  })

  it('denies stale New Relic evidence', () => {
    const decision = evaluatePolicy({
      intent: validIntent(), policy: defaultPolicy(), spentToday: 0,
      resource: {
        id: 'avmos', hostname: 'avmos', type: 'server', status: 'critical',
        metrics: { storageUtilization: 91 }, alerts: [],
        lastUpdated: new Date(Date.now() - 180_000).toISOString(), source: 'newrelic',
        telemetryStatus: 'STALE',
      },
    })
    expect(decision.decision).toBe('DENIED')
    expect(decision.checks).toContainEqual(expect.objectContaining({ name: 'fresh_telemetry', passed: false }))
  })
})
