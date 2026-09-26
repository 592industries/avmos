import { z } from 'zod/v4'

export const CURRENCY = 'RLUSD' as const

export const actionIntentSchema = z
  .object({
    id: z.string().min(1),
    agentId: z.string().min(1),
    resourceId: z.string().min(1),
    actionType: z.enum(['purchase_storage']),
    reason: z.string().min(10).max(2_000),
    evidence: z.array(z.string().min(1).max(500)).min(1).max(20),
    vendor: z.string().min(1).max(200),
    amount: z.number().positive().finite(),
    currency: z.literal(CURRENCY),
    requestedAt: z.string().datetime(),
    confidence: z.number().min(0).max(1),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()

export type ActionIntent = z.infer<typeof actionIntentSchema>

export const infrastructureResourceSchema = z.object({
  id: z.string().min(1),
  hostname: z.string().min(1),
  type: z.string().min(1),
  status: z.enum(['online', 'warning', 'critical', 'offline', 'unknown']),
  metrics: z.object({
    storageUtilization: z.number().min(0).max(100),
    storageTotalGb: z.number().nonnegative().optional(),
    storageUsedGb: z.number().nonnegative().optional(),
  }),
  alerts: z.array(z.string()),
  lastUpdated: z.string().datetime(),
  source: z.enum(['librenms', 'demo']),
})

export type InfrastructureResource = z.infer<typeof infrastructureResourceSchema>

export const telemetryTrendSchema = z.object({
  resourceId: z.string().min(1),
  metric: z.literal('storage_utilization'),
  points: z
    .array(
      z.object({
        timestamp: z.string().datetime(),
        value: z.number().min(0).max(100),
      }),
    )
    .min(2),
  source: z.enum(['timescale', 'demo']),
})

export type TelemetryTrend = z.infer<typeof telemetryTrendSchema>

export const policySchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  enabled: z.boolean(),
  maxTransactionAmount: z.number().positive(),
  dailyBudget: z.number().positive(),
  allowedActions: z.array(z.string()).min(1),
  allowedVendors: z.array(z.string()).min(1),
  allowedResources: z.array(z.string()).min(1),
  allowedAgents: z.array(z.string()).min(1),
  currency: z.literal(CURRENCY),
  requireEvidence: z.boolean().default(true),
  updatedAt: z.string().datetime(),
})

export type Policy = z.infer<typeof policySchema>

export type PolicyCheck = {
  name: string
  passed: boolean
  detail: string
}

export type PolicyDecision =
  | {
      decision: 'APPROVED'
      policyVersion: string
      reason: string
      checks: PolicyCheck[]
      timestamp: string
      dailyRemaining: number
    }
  | {
      decision: 'DENIED'
      policyVersion: string
      reason: string
      checks: PolicyCheck[]
      timestamp: string
      dailyRemaining: number
    }

export const auditEventTypes = [
  'OBSERVATION',
  'REASONING',
  'ACTION_PROPOSED',
  'POLICY_EVALUATED',
  'APPROVED',
  'DENIED',
  'EXECUTION_STARTED',
  'EXECUTION_SUCCEEDED',
  'EXECUTION_FAILED',
] as const

export type AuditEventType = (typeof auditEventTypes)[number]

export type AuditEvent = {
  id: string
  timestamp: string
  actor: string
  eventType: AuditEventType
  actionId: string
  resourceId: string
  policyVersion?: string
  details: Record<string, unknown>
  transactionHash?: string
}

export type ExecutionResult = {
  status: 'SUCCEEDED' | 'FAILED'
  mode: 'SIMULATED' | 'TESTNET'
  transactionHash?: string
  destination: string
  amount: number
  currency: typeof CURRENCY
  ledgerResult?: string
  timestamp: string
  error?: string
}

export type ApprovedPaymentRequest = Readonly<{
  actionId: string
  resourceId: string
  vendor: string
  destination: string
  amount: number
  currency: typeof CURRENCY
  policyVersion: string
  policyApprovedAt: string
}>

export const defaultPolicy = (): Policy => ({
  id: 'policy-infrastructure-spend',
  version: 'P-001',
  enabled: true,
  maxTransactionAmount: 250,
  dailyBudget: 1_000,
  allowedActions: ['purchase_storage'],
  allowedVendors: ['approved-storage-vendor'],
  allowedResources: ['server1'],
  allowedAgents: ['infrastructure-agent'],
  currency: CURRENCY,
  requireEvidence: true,
  updatedAt: new Date().toISOString(),
})
