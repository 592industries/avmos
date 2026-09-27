import { describe, expect, it } from 'vitest'
import { resolveNewRelicPollCredentials } from './poller'

describe('production poller credential resolution', () => {
  it('uses the stored workspace credential instead of the Worker environment', () => {
    expect(resolveNewRelicPollCredentials(
      { workspaceId: 'workspace-a', publicConfig: { accountId: '7072352' } },
      { userKey: 'NRAK-WORKSPACE' },
      { NEW_RELIC_USER_KEY: 'NRAK-ENV', NEW_RELIC_ACCOUNT_ID: '1' },
    )).toEqual({ userKey: 'NRAK-WORKSPACE', accountId: 7072352, source: 'workspace credential' })
  })

  it('falls back to environment credentials only for workspace-default', () => {
    expect(resolveNewRelicPollCredentials(
      { workspaceId: 'workspace-default', publicConfig: {} },
      null,
      { NEW_RELIC_USER_KEY: 'NRAK-ENV', NEW_RELIC_ACCOUNT_ID: '99' },
    )).toEqual({ userKey: 'NRAK-ENV', accountId: 99, source: 'environment fallback' })
    expect(resolveNewRelicPollCredentials(
      { workspaceId: 'workspace-a', publicConfig: { accountId: '7072352' } },
      null,
      { NEW_RELIC_USER_KEY: 'NRAK-ENV', NEW_RELIC_ACCOUNT_ID: '99' },
    )).toEqual({ userKey: undefined, accountId: 7072352, source: 'none' })
  })
})
