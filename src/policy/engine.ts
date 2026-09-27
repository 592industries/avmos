import {
  actionIntentSchema,
  policySchema,
  type ActionIntent,
  type Policy,
  type PolicyCheck,
  type PolicyDecision,
  type InfrastructureResource,
} from '../domain/operations'

export type PolicyEvaluationInput = {
  intent: unknown
  policy: unknown
  spentToday: number
  resource?: InfrastructureResource
  allowDemo?: boolean
}

export function evaluatePolicy(input: PolicyEvaluationInput): PolicyDecision {
  const timestamp = new Date().toISOString()
  const parsedPolicy = policySchema.safeParse(input.policy)
  if (!parsedPolicy.success) {
    return deny('INVALID', 'Policy configuration is invalid.', [], timestamp, 0)
  }

  const policy = parsedPolicy.data
  const dailyRemaining = Math.max(0, policy.dailyBudget - Math.max(0, input.spentToday))
  const parsedIntent = actionIntentSchema.safeParse(input.intent)
  if (!parsedIntent.success) {
    return deny(
      policy.version,
      'Action intent failed schema validation.',
      [{ name: 'intent_schema', passed: false, detail: parsedIntent.error.message }],
      timestamp,
      dailyRemaining,
    )
  }

  const intent = parsedIntent.data
  const checks = buildChecks(intent, policy, input.spentToday)
  if (input.resource) {
    const age = Math.max(0, (Date.now() - new Date(input.resource.lastUpdated).getTime()) / 1000)
    checks.push(check('fresh_telemetry', (input.resource.source === 'newrelic' && input.resource.telemetryStatus === 'LIVE' && age <= policy.maxTelemetryAgeSeconds) || (input.allowDemo === true && input.resource.source === 'demo'), 'Verified telemetry is fresh for this mode.', 'Verified live telemetry is missing or stale.'))
    checks.push(check('action_threshold', input.resource.metrics.storageUtilization >= 80, 'Storage utilization reached the 80% action threshold.', 'Storage utilization is below the 80% action threshold.'))
    checks.push(check('resource_identity', input.resource.id === intent.resourceId, 'Intent targets the observed resource.', 'Intent resource differs from observed telemetry.'))
  } else {
    checks.push(check('fresh_telemetry', false, '', 'Verified telemetry is missing.'))
  }
  const failures = checks.filter((check) => !check.passed)
  if (failures.length > 0) {
    return deny(
      policy.version,
      failures.map((check) => check.detail).join(' '),
      checks,
      timestamp,
      dailyRemaining,
    )
  }

  return {
    decision: 'APPROVED',
    policyVersion: policy.version,
    reason: `All ${checks.length} deterministic policy checks passed.`,
    checks,
    timestamp,
    dailyRemaining: dailyRemaining - intent.amount,
  }
}

function buildChecks(intent: ActionIntent, policy: Policy, spentToday: number): PolicyCheck[] {
  const remaining = Math.max(0, policy.dailyBudget - Math.max(0, spentToday))
  return [
    check('policy_active', policy.enabled, 'Policy is active.', 'Policy is disabled.'),
    check(
      'agent_allowed',
      policy.allowedAgents.includes(intent.agentId),
      `Agent ${intent.agentId} is allowed.`,
      `Agent ${intent.agentId} is not allowed.`,
    ),
    check(
      'resource_allowed',
      policy.allowedResources.includes(intent.resourceId),
      `Resource ${intent.resourceId} is in scope.`,
      `Resource ${intent.resourceId} is outside policy scope.`,
    ),
    check(
      'action_allowed',
      policy.allowedActions.includes(intent.actionType),
      `Action ${intent.actionType} is permitted.`,
      `Action ${intent.actionType} is not permitted.`,
    ),
    check(
      'vendor_allowed',
      policy.allowedVendors.includes(intent.vendor),
      `Vendor ${intent.vendor} is allowlisted.`,
      `Vendor ${intent.vendor} is not allowlisted.`,
    ),
    check(
      'currency_allowed',
      intent.currency === policy.currency,
      `Currency ${intent.currency} matches policy.`,
      `Currency ${intent.currency} does not match policy currency ${policy.currency}.`,
    ),
    check(
      'transaction_limit',
      intent.amount <= policy.maxTransactionAmount,
      `Amount ${intent.amount} is within the ${policy.maxTransactionAmount} limit.`,
      `Amount ${intent.amount} exceeds the maximum transaction limit of ${policy.maxTransactionAmount} ${policy.currency}.`,
    ),
    check(
      'daily_budget',
      intent.amount <= remaining,
      `Amount ${intent.amount} is within the remaining daily budget of ${remaining}.`,
      `Amount ${intent.amount} exceeds the remaining daily budget of ${remaining} ${policy.currency}.`,
    ),
    check(
      'evidence_present',
      !policy.requireEvidence || intent.evidence.length > 0,
      'Required evidence is present.',
      'Required evidence is missing.',
    ),
  ]
}

function check(name: string, passed: boolean, success: string, failure: string): PolicyCheck {
  return { name, passed, detail: passed ? success : failure }
}

function deny(
  policyVersion: string,
  reason: string,
  checks: PolicyCheck[],
  timestamp: string,
  dailyRemaining: number,
): PolicyDecision {
  return { decision: 'DENIED', policyVersion, reason, checks, timestamp, dailyRemaining }
}
