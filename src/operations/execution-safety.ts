import type { InfrastructureResource } from '../domain/operations'

export type ExecutionSafetyInput = {
  globalAutonomyEnabled: boolean
  workspaceId: string
  resource: InfrastructureResource
  allowDemo?: boolean
}

export type ExecutionSafetyResult =
  | { allowed: true }
  | { allowed: false; reason: 'GLOBAL_AUTONOMY_DISABLED' | 'INVALID_WORKSPACE' | 'RESOURCE_NOT_MONITORED' | 'RESOURCE_AUTONOMY_DISABLED' | 'TELEMETRY_NOT_FRESH' }

/**
 * Mandatory deterministic ceiling for every execution caller. Model output is
 * deliberately absent from this contract and cannot grant authority.
 */
export function executionSafetyGate(input: ExecutionSafetyInput): ExecutionSafetyResult {
  if (!input.globalAutonomyEnabled) return { allowed: false, reason: 'GLOBAL_AUTONOMY_DISABLED' }
  if (!input.workspaceId || input.resource.workspaceId !== input.workspaceId) return { allowed: false, reason: 'INVALID_WORKSPACE' }
  if (input.resource.monitoringEnabled !== true) return { allowed: false, reason: 'RESOURCE_NOT_MONITORED' }
  if (input.resource.autonomousEnabled !== true) return { allowed: false, reason: 'RESOURCE_AUTONOMY_DISABLED' }
  if (input.resource.telemetryStatus !== 'LIVE' && !(input.allowDemo === true && input.resource.telemetryStatus === 'DEMO')) return { allowed: false, reason: 'TELEMETRY_NOT_FRESH' }
  return { allowed: true }
}
