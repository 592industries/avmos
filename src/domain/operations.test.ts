import { describe, expect, it } from 'vitest'
import { canonicalResourceId } from './operations'

describe('canonical resource identity', () => {
  it('scopes the same hostname to different workspaces', () => {
    const first = canonicalResourceId('workspace-a', 'new_relic', 'web-01.prod')
    const second = canonicalResourceId('workspace-b', 'new_relic', 'web-01.prod')
    expect(first).not.toBe(second)
    expect(first).toContain('web-01.prod')
  })
})
