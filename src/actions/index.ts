import type { ActionHandler, ActionTools } from 'deepspace/worker'
import { isValidClassicAddress } from 'xrpl'
import type { Env } from '../../worker'
import { AgentRuntime, DemoAgentModel } from '../agent/runtime'
import { GrokAgentModel } from '../agent/grok'
import { defaultPolicy, policySchema, type Policy } from '../domain/operations'
import { DeepSpaceOperationsStore } from '../operations/deepspace-store'
import { operationRequestHash } from '../operations/guard'
import { OperationsOrchestrator } from '../operations/orchestrator'
import { OptionalResearchProvider, TavilyResearchProvider } from '../research/tavily'
import { DemoTelemetryAdapter } from '../telemetry/demo'
import { NewRelicTelemetryAdapter } from '../telemetry/newrelic'
import {
  SimulatedPaymentExecutor,
  TrustLineManager,
  XrplClient,
  XrplPaymentExecutor,
  XrplWallet,
  TransactionVerifier,
} from '../xrpl/executor'

type CycleMode = 'live' | 'demo-approved' | 'demo-denied'

const runAgentCycle: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  if (userId !== env.OWNER_USER_ID) return { success: false, error: 'Forbidden: owner only' }
  const mode: CycleMode = params.mode === 'demo-denied' ? 'demo-denied' : params.mode === 'demo-approved' ? 'demo-approved' : 'live'
  if (mode !== 'live' && env.DEMO_MODE !== 'true') return { success: false, error: 'Demo mode is disabled.' }
  return executeAgentCycle(tools, env, mode, String(params.idempotencyKey ?? crypto.randomUUID()))
}

export async function executeAgentCycle(tools: ActionTools, env: Env, mode: CycleMode, idempotencyKey: string = crypto.randomUUID()) {
  const resourceId = env.NEW_RELIC_RESOURCE_ID ?? 'server1'
  const namespace = env.RECORD_ROOMS
  const stub = namespace.get(namespace.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
  const lookup = await stub.fetch(new Request('https://internal/internal/avmos/lookup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idempotencyKey, requestHash: await operationRequestHash(resourceId, mode) }),
  }))
  if (!lookup.ok) return { success: false as const, error: 'Operation idempotency service is unavailable.' }
  const existing = await lookup.json() as { code: 'NEW' | 'REPLAY' | 'IDEMPOTENCY_CONFLICT'; operationId?: string }
  if (existing.code === 'IDEMPOTENCY_CONFLICT') return { success: false as const, code: 'IDEMPOTENCY_CONFLICT', error: 'Idempotency key conflicts with a different request.' }
  if (existing.code === 'REPLAY') {
    const action = existing.operationId ? await new DeepSpaceOperationsStore(tools, env).getAction(existing.operationId) : null
    if (!action) return { success: false as const, error: 'Original operation is still in progress.' }
    return { success: true as const, data: { actionId: action.id, decision: action.policyDecision.decision, executionStatus: action.executionStatus, transactionHash: action.execution?.transactionHash, simulation: action.execution?.mode === 'SIMULATED' } }
  }
  const demo = mode !== 'live'
  if (demo && env.DEMO_MODE !== 'true') return { success: false as const, error: 'Demo mode is disabled.' }
  if (!env.XRPL_VENDOR_DESTINATION || !isValidClassicAddress(env.XRPL_VENDOR_DESTINATION)) return { success: false as const, error: 'XRPL vendor destination is not configured with a valid classic address.' }
  if (!demo && (!env.NEW_RELIC_USER_KEY || !env.NEW_RELIC_ACCOUNT_ID || !env.NEW_RELIC_ENTITY_GUID || !env.GROK_API_KEY)) {
    return { success: false as const, error: 'Live New Relic and Grok configuration is incomplete.' }
  }
  if (env.XRPL_EXECUTION_MODE === 'live' && demo) return { success: false as const, error: 'Demo evidence cannot authorize live settlement.' }
  if (env.XRPL_EXECUTION_MODE && !['live', 'simulated'].includes(env.XRPL_EXECUTION_MODE)) return { success: false as const, error: 'XRPL execution mode is invalid.' }
  if (env.XRPL_EXECUTION_MODE === 'live' && (!env.XRPL_WALLET_SECRET || !env.XRPL_RLUSD_ISSUER || !env.XRPL_RLUSD_CURRENCY || !env.XRPL_TESTNET_URL)) {
    return { success: false as const, error: 'Live XRPL execution configuration is incomplete.' }
  }
  try {
  const policy = await resolvePolicy(tools, env, demo)
  const destinations = { 'approved-storage-vendor': env.XRPL_VENDOR_DESTINATION }
  const telemetry = demo ? new DemoTelemetryAdapter() : new NewRelicTelemetryAdapter({
    userKey: env.NEW_RELIC_USER_KEY!, accountId: Number(env.NEW_RELIC_ACCOUNT_ID),
    entityGuid: env.NEW_RELIC_ENTITY_GUID!, region: (env.NEW_RELIC_REGION ?? 'US') as 'US' | 'EU' | 'JP',
    resourceId: env.NEW_RELIC_RESOURCE_ID ?? 'server1',
  })
  const model = demo ? new DemoAgentModel(mode === 'demo-denied') : new GrokAgentModel({
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
    demo,
  )
    const result = await orchestrator.run(resourceId, idempotencyKey, undefined, mode)
    return {
      success: true as const,
      data: {
        actionId: result.action.id,
        decision: result.action.policyDecision.decision,
        executionStatus: result.action.executionStatus,
        transactionHash: result.action.execution?.transactionHash,
        simulation: executor instanceof SimulatedPaymentExecutor,
      },
    }
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : String(error),
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
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const reconcileXrplOperation: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  if (userId !== env.OWNER_USER_ID) return { success: false, error: 'Forbidden: owner only' }
  if (!env.XRPL_TESTNET_URL || !env.XRPL_WALLET_SECRET || !env.XRPL_RLUSD_ISSUER) return { success: false, error: 'XRPL verification configuration is incomplete.' }
  const store = new DeepSpaceOperationsStore(tools, env)
  const operationId = String(params.operationId)
  const action = await store.getAction(operationId)
  if (!action || action.executionStatus !== 'UNKNOWN' || !action.execution?.transactionHash) {
    return { success: false, error: 'An UNKNOWN operation with a transaction hash is required.' }
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

async function resolvePolicy(tools: ActionTools, env: Env, demo: boolean): Promise<Policy> {
  const result = await tools.query('policies', { limit: 10 })
  if (!result.success) throw new Error(result.error)
  const records = (result.data as { records?: Array<{ data?: unknown }> }).records ?? []
  const active = records.flatMap((record) => {
    const parsed = policySchema.safeParse(record.data)
    return parsed.success && parsed.data.enabled ? [parsed.data] : []
  })
  if (env.ACTIVE_POLICY_ID) {
    const selected = active.find((policy) => policy.id === env.ACTIVE_POLICY_ID)
    if (!selected) throw new Error('Selected authorization policy is unavailable.')
    return selected
  }
  if (active.length === 1) return active[0]
  if (active.length === 0 && demo) return defaultPolicy()
  throw new Error('Exactly one active authorization policy is required.')
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
  if (normalized.includes('server1') || normalized.includes('resource')) {
    if (!latestResource || !isObject(latestResource.metrics)) return 'No resource telemetry is recorded.'
    return `server1 is ${String(latestResource.status)} with ${String(latestResource.metrics.storageUtilization)}% storage utilization.`
  }
  return `AVMOS currently has ${state.resources.length} resource(s), ${state.actions.length} action(s), and ${state.audits.length} audit event(s).`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
