import {
  actionIntentSchema,
  type ActionIntent,
  type InfrastructureResource,
  type TelemetryTrend,
} from '../domain/operations'
import type { ResearchProvider, ResearchResult } from '../research/tavily'
import { forecastStorage, type TrendForecast } from '../telemetry/trend'

export type AgentObservation = {
  resource: InfrastructureResource
  trend: TelemetryTrend
  forecast: TrendForecast
  research?: ResearchResult
}

export type AgentProposal = {
  reasoning: string
  intent: ActionIntent
}

export interface AgentModel {
  readonly provider: string
  readonly model: string
  propose(observation: AgentObservation, signal?: AbortSignal): Promise<unknown>
}

export class AgentRuntime {
  constructor(
    private readonly model: AgentModel,
    private readonly research?: ResearchProvider,
  ) {}

  get identity(): { provider: string; model: string } {
    return { provider: this.model.provider, model: this.model.model }
  }

  async reason(
    resource: InfrastructureResource,
    trend: TelemetryTrend,
    signal?: AbortSignal,
  ): Promise<AgentProposal> {
    let research: ResearchResult | undefined
    if (resource.metrics.storageUtilization >= 95 && this.research) {
      research = await this.research.search(
        `operational guidance for storage utilization on ${resource.type}`,
        signal,
      )
    }

    const raw = await this.model.propose({ resource, trend, forecast: forecastStorage(trend), research }, signal)
    const candidate = normalizeProposal(raw)
    const intent = actionIntentSchema.parse(candidate.intent)
    return { reasoning: candidate.reasoning, intent }
  }
}

function normalizeProposal(raw: unknown): { reasoning: string; intent: unknown } {
  const parsed = typeof raw === 'string' ? parseJson(raw) : raw
  if (!isObject(parsed) || typeof parsed.reasoning !== 'string' || !('intent' in parsed)) {
    throw new Error('Model response did not contain a valid reasoning and intent envelope.')
  }
  if (parsed.reasoning.length > 4000) throw new Error('Model reasoning exceeds the allowed length.')
  return { reasoning: parsed.reasoning, intent: parsed.intent }
}

function parseJson(value: string): unknown {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(trimmed)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class DemoAgentModel implements AgentModel {
  readonly provider = 'demo'
  readonly model = 'deterministic-storage-v1'

  constructor(private readonly attack = false) {}

  async propose(observation: AgentObservation): Promise<unknown> {
    const { resource, trend } = observation
    const values = trend.points.map((point) => point.value)
    return {
      reasoning: this.attack
        ? 'This intentionally malicious proposal demonstrates that model output has no authority.'
        : `Storage utilization increased from ${values[0]}% to ${values.at(-1)}%; bounded capacity procurement is warranted.`,
      intent: {
        id: `intent-${crypto.randomUUID()}`,
        agentId: 'infrastructure-agent',
        resourceId: resource.id,
        actionType: 'purchase_storage',
        vendor: this.attack ? 'unknown-vendor' : 'approved-storage-vendor',
        amount: this.attack ? 4_700 : 129,
        currency: 'RLUSD',
        reason: this.attack
          ? 'Untrusted vendor metadata requested an excessive payment; policy must reject this.'
          : 'Projected storage exhaustion within approximately four days.',
        evidence: [
          `Current utilization: ${resource.metrics.storageUtilization}%`,
          `Trend: ${values.join('% → ')}%`,
        ],
        requestedAt: new Date().toISOString(),
        confidence: 0.94,
        metadata: { telemetrySource: resource.source, trendSource: trend.source },
      },
    }
  }
}
