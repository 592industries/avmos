import {
  actionIntentSchema,
  type ActionIntent,
  type InfrastructureResource,
  type TelemetryTrend,
} from '../domain/operations'
import type { ResearchProvider, ResearchResult } from '../research/tavily'
import { forecastStorage, type TrendForecast } from '../telemetry/trend'
import { z } from 'zod/v4'

export type AgentObservation = {
  resource: InfrastructureResource
  trend: TelemetryTrend
  forecast: TrendForecast
  research?: ResearchResult
}

export type AgentProposal = {
  summary: {
    summary: string
    action: 'purchase_storage'
    evidence: string[]
  }
  intent: ActionIntent
  research?: ResearchResult
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
    researchQuery?: string,
    onResearch?: (result: ResearchResult) => Promise<void>,
  ): Promise<AgentProposal> {
    let research: ResearchResult | undefined
    if (researchQuery && this.research) {
      research = await this.research.search(researchQuery, signal)
      await onResearch?.(research)
    }

    const raw = await this.model.propose({
      resource,
      trend,
      forecast: forecastStorage(trend),
      ...(research?.status === 'RESEARCH_COMPLETE' ? { research } : {}),
    }, signal)
    const candidate = normalizeProposal(raw)
    const intent = actionIntentSchema.parse(candidate.intent)
    return { summary: candidate.summary, intent, research }
  }
}

const summarySchema = z.object({
  summary: z.string().trim().min(10).max(500),
  action: z.literal('purchase_storage'),
  evidence: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
}).strict()

function normalizeProposal(raw: unknown): { summary: z.infer<typeof summarySchema>; intent: unknown } {
  const parsed = typeof raw === 'string' ? parseJson(raw) : raw
  if (!isObject(parsed) || !('summary' in parsed) || !('intent' in parsed)) {
    throw new Error('Model response did not contain a valid summary and intent envelope.')
  }
  return { summary: summarySchema.parse(parsed.summary), intent: parsed.intent }
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
      summary: {
        summary: this.attack
          ? 'The model proposed an amount above the configured transaction ceiling.'
          : 'Storage exceeded the configured remediation threshold and continues to increase.',
        action: 'purchase_storage',
        evidence: ['storage_utilization'],
      },
      intent: {
        id: `intent-${crypto.randomUUID()}`,
        agentId: 'infrastructure-agent',
        resourceId: resource.id,
        actionType: 'purchase_storage',
        vendor: 'approved-storage-vendor',
        amount: this.attack ? 700 : 129,
        currency: 'RLUSD',
        reason: this.attack
          ? 'A 700 RLUSD request exceeds the 250 RLUSD transaction limit; policy must reject this.'
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
