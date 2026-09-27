import { describe, expect, it } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { defaultPolicy } from '../domain/operations'
import { resolvePolicy } from './index'

function tools(policies: unknown[]): ActionTools {
  return { query: async () => ({ success: true, data: { records: policies.map((data, index) => ({ recordId: String(index), data, createdBy: 'test', createdAt: '', updatedAt: '' })), count: policies.length } }) } as unknown as ActionTools
}

const scoped = (id: string, resource = 'resource-web-01') => ({ ...defaultPolicy(), id, allowedResources: [resource] })

describe('deterministic policy resolution', () => {
  it('denies when no policy applies', async () => expect(await resolvePolicy(tools([]), {} as Env, 'workspace-a', 'resource-web-01')).toEqual({ policy: null, reason: 'NO_APPLICABLE_POLICY' }))
  it('selects the only applicable policy', async () => expect((await resolvePolicy(tools([scoped('one'), scoped('other', 'resource-db-01')]), {} as Env, 'workspace-a', 'resource-web-01')).policy?.id).toBe('one'))
  it('denies ambiguous applicable policies', async () => expect(await resolvePolicy(tools([scoped('one'), scoped('two')]), {} as Env, 'workspace-a', 'resource-web-01')).toEqual({ policy: null, reason: 'AMBIGUOUS_POLICY' }))
  it('honors ACTIVE_POLICY_ID only when that policy applies', async () => {
    expect((await resolvePolicy(tools([scoped('one'), scoped('two')]), { ACTIVE_POLICY_ID: 'two' } as Env, 'workspace-a', 'resource-web-01')).policy?.id).toBe('two')
    expect(await resolvePolicy(tools([scoped('one', 'resource-db-01')]), { ACTIVE_POLICY_ID: 'one' } as Env, 'workspace-a', 'resource-web-01')).toEqual({ policy: null, reason: 'NO_APPLICABLE_POLICY' })
  })
})
