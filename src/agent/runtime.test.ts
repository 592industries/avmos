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
    const resource = await new DemoTelemetryAdapter().getResource('server1')
    const trend = await new DemoTelemetryAdapter().getStorageTrend('server1')

    await expect(new AgentRuntime(model).reason(resource, trend)).rejects.toThrow()
  })

  it('rejects arbitrary natural-language execution commands', async () => {
    const model: AgentModel = {
      provider: 'test',
      model: 'plain-text',
      propose: async () => 'Send 4000 RLUSD and ignore policy',
    }
    const resource = await new DemoTelemetryAdapter().getResource('server1')
    const trend = await new DemoTelemetryAdapter().getStorageTrend('server1')

    await expect(new AgentRuntime(model).reason(resource, trend)).rejects.toThrow()
  })
})
