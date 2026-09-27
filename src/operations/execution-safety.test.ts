import { describe, expect, it } from 'vitest'
import type { InfrastructureResource } from '../domain/operations'
import { executionSafetyGate } from './execution-safety'

const resource = (overrides: Partial<InfrastructureResource> = {}): InfrastructureResource => ({
  id: 'resource-web-01',
  workspaceId: 'workspace-a',
  provider: 'new_relic',
  externalId: 'web-01.prod',
  hostname: 'web-01.prod',
  type: 'server',
  status: 'critical',
  metrics: { storageUtilization: 82 },
  alerts: [],
  lastUpdated: new Date().toISOString(),
  source: 'newrelic',
  telemetryStatus: 'LIVE',
  monitoringEnabled: true,
  autonomousEnabled: true,
  ...overrides,
})

describe('executionSafetyGate', () => {
  it('allows only global ON + resource ON + fresh telemetry in the same workspace', () => {
    expect(executionSafetyGate({
      globalAutonomyEnabled: true,
      workspaceId: 'workspace-a',
      resource: resource(),
    })).toEqual({ allowed: true })
  })

  it.each([
    ['global OFF', { globalAutonomyEnabled: false }, 'GLOBAL_AUTONOMY_DISABLED'],
    ['resource autonomy OFF', { resource: resource({ autonomousEnabled: false }) }, 'RESOURCE_AUTONOMY_DISABLED'],
    ['monitoring OFF', { resource: resource({ monitoringEnabled: false }) }, 'RESOURCE_NOT_MONITORED'],
    ['foreign workspace', { workspaceId: 'workspace-b' }, 'INVALID_WORKSPACE'],
    ['stale telemetry', { resource: resource({ telemetryStatus: 'STALE' }) }, 'TELEMETRY_NOT_FRESH'],
  ] as const)('denies when %s', (_name, overrides, reason) => {
    expect(executionSafetyGate({
      globalAutonomyEnabled: true,
      workspaceId: 'workspace-a',
      resource: resource(),
      ...overrides,
    })).toEqual({ allowed: false, reason })
  })
})
