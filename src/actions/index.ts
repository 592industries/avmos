import type { ActionHandler, ActionTools } from 'deepspace/worker'
import { isValidClassicAddress } from 'xrpl'
import type { Env } from '../../worker'
import { AgentRuntime } from '../agent/runtime'
import { GrokAgentModel } from '../agent/grok'
import { policySchema, type Policy, type PolicyDecision } from '../domain/operations'
import { DeepSpaceOperationsStore } from '../operations/deepspace-store'
import { operationRequestHash } from '../operations/guard'
import { OperationsOrchestrator } from '../operations/orchestrator'
import { OptionalResearchProvider, TavilyResearchProvider } from '../research/tavily'
import { StoredTelemetrySource } from '../telemetry/stored'
import { safeMessage } from '../telemetry/retention'
import {
  SimulatedPaymentExecutor,
  TrustLineManager,
  XrplClient,
  XrplPaymentExecutor,
  XrplWallet,
  TransactionVerifier,
} from '../xrpl/executor'

const runAgentCycle: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const resourceId = String(params.resourceId ?? '')
  return executeAgentCycle(tools, env, resourceId, String(params.idempotencyKey ?? crypto.randomUUID()), params.research === true, userId)
}

export async function executeAgentCycle(tools: ActionTools, env: Env, resourceId: string, idempotencyKey: string = crypto.randomUUID(), research = false, actor = 'scheduled-agent') {
  if (!/^avmos-node-\d{2}$/.test(resourceId)) return { success: false as const, error: 'Requested resource ID is invalid.' }
  const requestTag = `live:${research ? 'research' : 'no-research'}`
  const namespace = env.RECORD_ROOMS
  const stub = namespace.get(namespace.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
  const lookup = await stub.fetch(new Request('https://internal/internal/avmos/lookup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idempotencyKey, requestHash: await operationRequestHash(resourceId, requestTag) }),
  }))
  if (!lookup.ok) return { success: false as const, error: 'Operation idempotency service is unavailable.' }
  const existing = await lookup.json() as { code: 'NEW' | 'REPLAY' | 'IDEMPOTENCY_CONFLICT'; operationId?: string }
  if (existing.code === 'IDEMPOTENCY_CONFLICT') return { success: false as const, code: 'IDEMPOTENCY_CONFLICT', error: 'Idempotency key conflicts with a different request.' }
  if (existing.code === 'REPLAY') {
    const action = existing.operationId ? await new DeepSpaceOperationsStore(tools, env).getAction(existing.operationId) : null
    if (!action) return { success: false as const, error: 'Original operation is still in progress.' }
    return { success: true as const, data: { actionId: action.id, decision: action.policyDecision.decision, executionStatus: action.executionStatus, transactionHash: action.execution?.transactionHash, simulation: action.execution?.mode === 'SIMULATED' } }
  }
  try {
  const telemetry = new StoredTelemetrySource(tools)
  const resource = await telemetry.getResource(resourceId)
  if (resource.telemetryStatus !== 'LIVE') return { success: true as const, data: await recordResolutionDenial(tools, env, resourceId, actor, 'RESOURCE_TELEMETRY_STALE') }
  const resolution = await resolvePolicy(tools, env, resourceId)
  if (!resolution.policy) return { success: true as const, data: await recordResolutionDenial(tools, env, resourceId, actor, resolution.reason) }
  const policy = resolution.policy
  if (!env.XRPL_VENDOR_DESTINATION || !isValidClassicAddress(env.XRPL_VENDOR_DESTINATION)) return { success: false as const, error: 'XRPL vendor destination is not configured with a valid classic address.' }
  if (!env.GROK_API_KEY) return { success: false as const, error: 'Grok configuration is incomplete.' }
  if (env.XRPL_EXECUTION_MODE && !['live', 'simulated'].includes(env.XRPL_EXECUTION_MODE)) return { success: false as const, error: 'XRPL execution mode is invalid.' }
  if (env.XRPL_EXECUTION_MODE === 'live' && (!env.XRPL_WALLET_SECRET || !env.XRPL_RLUSD_ISSUER || !env.XRPL_RLUSD_CURRENCY || !env.XRPL_TESTNET_URL)) return { success: false as const, error: 'Live XRPL execution configuration is incomplete.' }
  const destinations = { 'approved-storage-vendor': env.XRPL_VENDOR_DESTINATION }
  const model = new GrokAgentModel({
    apiKey: env.GROK_API_KEY!, model: env.GROK_MODEL, baseUrl: env.GROK_BASE_URL,
  })
  const research = new OptionalResearchProvider(
    env.TAVILY_API_KEY ? new TavilyResearchProvider(env.TAVILY_API_KEY) : undefined,
  )
  const executor =
    env.XRPL_EXECUTION_MODE === 'live'
      ? new XrplPaymentExecutor({
          testnetUrl: env.XRPL_TESTNET_URL!,
          walletSecret: env.XRPL_WALLET_SECRET!,
          issuer: env.XRPL_RLUSD_ISSUER!,
          currency: env.XRPL_RLUSD_CURRENCY!,
          vendorDestinations: destinations,
        })
      : new SimulatedPaymentExecutor()

  const orchestrator = new OperationsOrchestrator(
    telemetry,
    new AgentRuntime(model, research),
    policy,
    executor,
    new DeepSpaceOperationsStore(tools, env),
    destinations,
    false,
  )
    const result = await orchestrator.run(resourceId, idempotencyKey, AbortSignal.timeout(60_000), requestTag, research ? 'current storage capacity remediation options and vendor documentation for a cloud server' : undefined)
    return {
      success: true as const,
      data: {
        actionId: result.action.id,
        decision: result.action.policyDecision.decision,
        executionStatus: result.action.executionStatus,
        reason: result.action.policyDecision.reason,
        transactionHash: result.action.execution?.transactionHash,
        simulation: executor instanceof SimulatedPaymentExecutor,
      },
    }
  } catch (error) {
    return {
      success: false as const,
      error: safeMessage(error),
    }
  }
}

const askOperator: ActionHandler<Env> = async ({ params, tools }) => {
  const question = typeof params.question === 'string' ? params.question.trim() : ''
  if (!question || question.length > 500) {
    return { success: false, error: 'Question must contain 1-500 characters.' }
  }
  const [resources, actions, audits] = await Promise.all([
    tools.query('resources', { limit: 50 }),
    tools.query('actions', { orderBy: 'createdAt', orderDir: 'desc', limit: 50 }),
    tools.query('audit-events', { orderBy: 'timestamp', orderDir: 'desc', limit: 100 }),
  ])
  if (!resources.success || !actions.success || !audits.success) {
    return { success: false, error: 'Application state is temporarily unavailable.' }
  }
  return {
    success: true,
    data: {
      answer: answerFromState(question, {
        resources: extractData(resources.data),
        actions: extractData(actions.data),
        audits: extractData(audits.data),
      }),
    },
  }
}

const setupXrplTrustLine: ActionHandler<Env> = async ({ userId, env }) => {
  if (userId !== env.OWNER_USER_ID) return { success: false, error: 'Forbidden: owner only' }
  if (
    !env.XRPL_TESTNET_URL ||
    !env.XRPL_WALLET_SECRET ||
    !env.XRPL_RLUSD_ISSUER ||
    !env.XRPL_RLUSD_CURRENCY
  ) {
    return { success: false, error: 'XRPL Testnet and RLUSD secrets are incomplete.' }
  }
  try {
    const client = new XrplClient(env.XRPL_TESTNET_URL)
    const wallet = new XrplWallet(env.XRPL_WALLET_SECRET)
    const manager = new TrustLineManager(client, wallet, {
      issuer: env.XRPL_RLUSD_ISSUER,
      currency: env.XRPL_RLUSD_CURRENCY,
    })
    const transactionHash = await manager.establish()
    const balance = await manager.balance()
    return {
      success: true,
      data: { address: wallet.address, transactionHash, balance, network: 'XRPL Testnet' },
    }
  } catch (error) {
    return { success: false, error: safeMessage(error) }
  }
}

const reconcileXrplOperation: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  if (userId !== env.OWNER_USER_ID) return { success: false, error: 'Forbidden: owner only' }
  if (!env.XRPL_TESTNET_URL || !env.XRPL_WALLET_SECRET || !env.XRPL_RLUSD_ISSUER) return { success: false, error: 'XRPL verification configuration is incomplete.' }
  const store = new DeepSpaceOperationsStore(tools, env)
  const operationId = String(params.operationId)
  const action = await store.getAction(operationId)
  if (!action || action.executionStatus !== 'RECONCILIATION_REQUIRED' || !action.execution?.transactionHash) {
    return { success: false, error: 'A reconciliation-required operation with a transaction hash is required.' }
  }
  const intent = action.actionIntent
  const expected = {
    actionId: operationId,
    resourceId: action.resourceId,
    vendor: String(intent.vendor),
    destination: action.execution.destination,
    amount: action.execution.amount,
    currency: 'RLUSD' as const,
    policyVersion: action.policyDecision.policyVersion,
    policyApprovedAt: action.policyDecision.timestamp,
    providerId: action.providerId ?? 'xrpl-testnet',
    authorizationScope: 'infrastructure:purchase',
  }
  try {
    const client = new XrplClient(env.XRPL_TESTNET_URL)
    const wallet = new XrplWallet(env.XRPL_WALLET_SECRET)
    const result = await new TransactionVerifier(client).verify(action.execution.transactionHash, expected, wallet.address, env.XRPL_RLUSD_ISSUER)
    if (!result.validated) return { success: false, error: 'Ledger transaction is not yet validated or does not match the approved payment.' }
    if (result.ledgerResult !== 'tesSUCCESS' && !result.ledgerResult.startsWith('tec')) return { success: false, error: 'Ledger outcome remains uncertain.' }
    const state = result.ledgerResult === 'tesSUCCESS' ? 'SUCCEEDED' : 'FAILED'
    await store.transition(operationId, state)
    action.executionStatus = state
    action.execution = { ...action.execution, status: state, ledgerResult: result.ledgerResult }
    action.auditStatus = 'PENDING'
    await store.recordAction(action)
    await store.appendAudit({
      id: `audit-${crypto.randomUUID()}`, timestamp: new Date().toISOString(), actor: 'xrpl-reconciler',
      eventType: state === 'SUCCEEDED' ? 'EXECUTION_SUCCEEDED' : 'EXECUTION_FAILED',
      actionId: operationId, resourceId: action.resourceId, policyVersion: action.policyDecision.policyVersion,
      transactionHash: action.execution.transactionHash, details: { reconciled: true, ledgerResult: result.ledgerResult },
    })
    action.auditStatus = 'COMPLETE'
    await store.recordAction(action)
    return { success: true, data: { actionId: operationId, executionStatus: state, transactionHash: action.execution.transactionHash } }
  } catch {
    return { success: false, error: 'XRPL reconciliation could not confirm the transaction.' }
  }
}

export const actions: Record<string, ActionHandler<Env>> = {
  runAgentCycle,
  askOperator,
  setupXrplTrustLine,
  reconcileXrplOperation,
}

export type PolicyResolution = { policy: Policy; reason: 'SELECTED' } | { policy: null; reason: 'NO_APPLICABLE_POLICY' | 'AMBIGUOUS_POLICY' }
export async function resolvePolicy(tools: ActionTools, env: Env, resourceId: string): Promise<PolicyResolution> {
  const result = await tools.query('policies', { limit: 500 })
  if (!result.success) throw new Error(result.error)
  const records = (result.data as { records?: Array<{ data?: unknown }> }).records ?? []
  const active = records.flatMap((record) => {
    const parsed = policySchema.safeParse(record.data)
    return parsed.success && parsed.data.enabled ? [parsed.data] : []
  })
  const applicable = active.filter((policy) => policy.allowedResources.includes(resourceId) && policy.allowedActions.includes('purchase_storage') && policy.allowedAgents.includes('infrastructure-agent') && policy.allowedProviders.includes('xrpl-testnet') && policy.allowedVendors.includes('approved-storage-vendor'))
  if (env.ACTIVE_POLICY_ID) {
    const selected = applicable.find((policy) => policy.id === env.ACTIVE_POLICY_ID)
    return selected ? { policy: selected, reason: 'SELECTED' } : { policy: null, reason: 'NO_APPLICABLE_POLICY' }
  }
  if (applicable.length === 1) return { policy: applicable[0], reason: 'SELECTED' }
  return applicable.length === 0 ? { policy: null, reason: 'NO_APPLICABLE_POLICY' } : { policy: null, reason: 'AMBIGUOUS_POLICY' }
}

async function recordResolutionDenial(tools: ActionTools, env: Env, resourceId: string, actor: string, reason: 'NO_APPLICABLE_POLICY' | 'AMBIGUOUS_POLICY' | 'RESOURCE_TELEMETRY_STALE') {
  const now = new Date().toISOString(); const id = `action-${crypto.randomUUID()}`
  const decision: PolicyDecision = { decision: 'DENIED', policyVersion: 'UNRESOLVED', reason, checks: [{ name: 'policy_resolution', passed: false, detail: reason }], timestamp: now, dailyRemaining: 0 }
  const store = new DeepSpaceOperationsStore(tools, env)
  const action = { id, agentId: 'infrastructure-agent', resourceId, actionIntent: { resourceId, actionType: 'purchase_storage' }, reasoning: '', decisionSummary: `Evaluation stopped: ${reason}.`, policyDecision: decision, executionStatus: 'POLICY_DENIED' as const, auditStatus: 'COMPLETE' as const, createdAt: now }
  await store.recordPolicyDecision(action); await store.recordAction(action)
  await store.appendAudit({ id: `audit-${crypto.randomUUID()}`, timestamp: now, actor, eventType: 'POLICY_DENIED', actionId: id, resourceId, details: { reason } })
  return { actionId: id, decision: 'DENIED', executionStatus: 'POLICY_DENIED', reason, simulation: env.XRPL_EXECUTION_MODE !== 'live' }
}

function extractData(value: unknown): unknown[] {
  if (!isObject(value) || !Array.isArray(value.records)) return []
  return value.records.flatMap((record) =>
    isObject(record) && isObject(record.data) ? [record.data] : [],
  )
}

function answerFromState(
  question: string,
  state: { resources: unknown[]; actions: unknown[]; audits: unknown[] },
): string {
  const normalized = question.toLowerCase()
  const latestAction = state.actions.find(isObject)
  const latestResource = state.resources.find(isObject)
  if (normalized.includes('denied') || normalized.includes('deny')) {
    const denied = state.actions.find(
      (item) =>
        isObject(item) &&
        isObject(item.policyDecision) &&
        item.policyDecision.decision === 'DENIED',
    )
    return isObject(denied) && isObject(denied.policyDecision)
      ? `The payment was denied because ${String(denied.policyDecision.reason)} No XRPL execution occurred.`
      : 'No denied action is recorded.'
  }
  if (normalized.includes('spend') || normalized.includes('payment') || normalized.includes('money')) {
    if (!latestAction || !isObject(latestAction.actionIntent)) return 'No financial action is recorded.'
    return `The agent proposed ${String(latestAction.actionIntent.amount)} ${String(latestAction.actionIntent.currency)} for ${String(latestAction.actionIntent.vendor)}. Policy result: ${isObject(latestAction.policyDecision) ? String(latestAction.policyDecision.decision) : 'unknown'}; execution: ${String(latestAction.executionStatus)}.`
  }
  if (normalized.includes('avmos') || normalized.includes('resource')) {
    if (!latestResource || !isObject(latestResource.metrics)) return 'No resource telemetry is recorded.'
    return `avmos is ${String(latestResource.status)} with ${String(latestResource.metrics.storageUtilization ?? 'unavailable')}% storage utilization.`
  }
  return `AVMOS currently has ${state.resources.length} resource(s), ${state.actions.length} action(s), and ${state.audits.length} audit event(s).`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
