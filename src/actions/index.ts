import type { ActionHandler, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { AgentRuntime, DemoAgentModel } from '../agent/runtime'
import { GrokAgentModel } from '../agent/grok'
import { defaultPolicy, policySchema, type Policy } from '../domain/operations'
import { DeepSpaceOperationsStore } from '../operations/deepspace-store'
import { OperationsOrchestrator } from '../operations/orchestrator'
import { OptionalResearchProvider, TavilyResearchProvider } from '../research/tavily'
import { DemoHistoricalTelemetry, TimescaleTelemetryBridge } from '../telemetry/historical'
import { DemoTelemetryAdapter, LibreNmsAdapter } from '../telemetry/librenms'
import {
  SimulatedPaymentExecutor,
  TrustLineManager,
  XrplClient,
  XrplPaymentExecutor,
  XrplWallet,
} from '../xrpl/executor'

type DemoMode = 'happy' | 'denial'

const runAgentCycle: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  if (userId !== env.OWNER_USER_ID) return { success: false, error: 'Forbidden: owner only' }
  const mode: DemoMode = params.mode === 'denial' ? 'denial' : 'happy'
  return executeAgentCycle(tools, env, mode)
}

export async function executeAgentCycle(tools: ActionTools, env: Env, mode: DemoMode) {
  const policy = await resolvePolicy(tools)
  const destinations = {
    'approved-storage-vendor':
      env.XRPL_VENDOR_DESTINATION ?? 'rDemoApprovedStorageVendorTestnetDestination',
  }
  const telemetry =
    env.LIBRENMS_URL && env.LIBRENMS_API_KEY
      ? new LibreNmsAdapter({ baseUrl: env.LIBRENMS_URL, apiKey: env.LIBRENMS_API_KEY })
      : new DemoTelemetryAdapter()
  const historical = env.TIMESCALEDB_URL
    ? new TimescaleTelemetryBridge(env.TIMESCALEDB_URL, env.TIMESCALEDB_BRIDGE_TOKEN)
    : new DemoHistoricalTelemetry()
  const model =
    mode === 'happy' && env.GROK_API_KEY
      ? new GrokAgentModel({
          apiKey: env.GROK_API_KEY,
          model: env.GROK_MODEL,
          baseUrl: env.GROK_BASE_URL,
        })
      : new DemoAgentModel(mode === 'denial')
  const research = new OptionalResearchProvider(
    env.TAVILY_API_KEY ? new TavilyResearchProvider(env.TAVILY_API_KEY) : undefined,
  )
  const executor =
    env.XRPL_EXECUTION_MODE === 'live' &&
    env.XRPL_WALLET_SECRET &&
    env.XRPL_RLUSD_ISSUER &&
    env.XRPL_RLUSD_CURRENCY &&
    env.XRPL_TESTNET_URL &&
    env.XRPL_VENDOR_DESTINATION
      ? new XrplPaymentExecutor({
          testnetUrl: env.XRPL_TESTNET_URL,
          walletSecret: env.XRPL_WALLET_SECRET,
          issuer: env.XRPL_RLUSD_ISSUER,
          currency: env.XRPL_RLUSD_CURRENCY,
          vendorDestinations: destinations,
        })
      : new SimulatedPaymentExecutor()

  const orchestrator = new OperationsOrchestrator(
    telemetry,
    historical,
    new AgentRuntime(model, research),
    policy,
    executor,
    new DeepSpaceOperationsStore(tools),
    destinations,
  )
  try {
    const result = await orchestrator.run('server1')
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

const askPhoton: ActionHandler<Env> = async ({ params, tools }) => {
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

export const actions: Record<string, ActionHandler<Env>> = {
  runAgentCycle,
  askPhoton,
  setupXrplTrustLine,
}

async function resolvePolicy(tools: ActionTools): Promise<Policy> {
  const result = await tools.query('policies', { limit: 10 })
  if (!result.success) throw new Error(result.error)
  const records = (result.data as { records?: Array<{ data?: unknown }> }).records ?? []
  for (const record of records) {
    const parsed = policySchema.safeParse(record.data)
    if (parsed.success && parsed.data.enabled) return parsed.data
  }
  const policy = defaultPolicy()
  const created = await tools.create('policies', policy, policy.id)
  if (!created.success) throw new Error(created.error)
  return policy
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
  return `Agent-Monitor currently has ${state.resources.length} resource(s), ${state.actions.length} action(s), and ${state.audits.length} audit event(s).`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
