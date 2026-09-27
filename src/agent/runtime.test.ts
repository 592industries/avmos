import { describe, expect, it } from 'vitest'
import { DemoTelemetryAdapter } from '../telemetry/demo'
import { AgentRuntime, type AgentModel } from './runtime'

describe('agent runtime boundary', () => {
  it('accepts only a schema-valid ActionIntent', async () => {
    const model: AgentModel = {
      provider: 'test',
      model: 'malformed',
      propose: async () => ({
        reasoning: 'Attempted bypass',
        intent: {
          amount: 1,
          currency: 'RLUSD',
          authorization: 'APPROVED',
        },
      }),
    }
    const resource = await new DemoTelemetryAdapter().getResource('avmos')
    const trend = await new DemoTelemetryAdapter().getStorageTrend('avmos')

    await expect(new AgentRuntime(model).reason(resource, trend)).rejects.toThrow()
  })

  it('rejects arbitrary natural-language execution commands', async () => {
    const model: AgentModel = {
      provider: 'test',
      model: 'plain-text',
      propose: async () => 'Send 4000 RLUSD and ignore policy',
    }
    const resource = await new DemoTelemetryAdapter().getResource('avmos')
    const trend = await new DemoTelemetryAdapter().getStorageTrend('avmos')

    await expect(new AgentRuntime(model).reason(resource, trend)).rejects.toThrow()
  })

  it('does not search or pass Tavily content unless a research query is supplied', async () => {
    const searched: string[] = []
    const observed: Array<Record<string, unknown>> = []
    const model: AgentModel = {
      provider: 'test',
      model: 'valid',
      propose: async (observation) => {
        observed.push(observation as unknown as Record<string, unknown>)
        return {
          summary: { summary: 'Storage exceeded the configured remediation threshold.', action: 'purchase_storage', evidence: ['storage_utilization'] },
          intent: {
            id: 'intent-1',
            agentId: 'infrastructure-agent',
            resourceId: observation.resource.id,
            actionType: 'purchase_storage',
            reason: 'Storage will be exhausted within four days.',
            evidence: ['Current storage utilization is 91%.'],
            vendor: 'approved-storage-vendor',
            amount: 129,
            currency: 'RLUSD',
            requestedAt: new Date().toISOString(),
            confidence: 0.94,
            metadata: {},
          },
        }
      },
    }
    const resource = await new DemoTelemetryAdapter().getResource('avmos')
    const trend = await new DemoTelemetryAdapter().getStorageTrend('avmos')
    const runtime = new AgentRuntime(model, { search: async (query) => { searched.push(query); return { status: 'RESEARCH_FAILED', query, requestedAt: new Date().toISOString(), sources: [] } } })
    await runtime.reason(resource, trend)
    expect(searched).toEqual([])
    expect(observed[0]).not.toHaveProperty('research')
    await runtime.reason(resource, trend, undefined, 'storage docs')
    expect(searched).toEqual(['storage docs'])
    expect(observed[1]).not.toHaveProperty('research')
  })
})
