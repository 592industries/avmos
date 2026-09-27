import { describe, expect, it } from 'vitest'
import { listWorkspaceAccess, requireWorkspaceAccess, WorkspaceAccessError, workspaceIdFromRequest } from './workspaces'
import type { ActionTools } from 'deepspace/worker'

function tools(records: Array<{ teamId: string; userId: string; role: string; status: string }>): ActionTools {
  return {
    query: async (_collection: string, options?: { where?: Record<string, string> }) => ({
      success: true,
      data: {
        records: records
          .filter((data) => !options?.where || Object.entries(options.where).every(([key, value]) => data[key as keyof typeof data] === value))
          .map((data, index) => ({ recordId: String(index), data })),
      },
    }),
  } as unknown as ActionTools
}

describe('workspace authorization', () => {
  it('lists only active memberships for the caller', async () => {
    await expect(listWorkspaceAccess(tools([
      { teamId: 'workspace-a', userId: 'user-a', role: 'admin', status: 'active' },
      { teamId: 'workspace-b', userId: 'user-a', role: 'member', status: 'invited' },
    ]), 'user-a')).resolves.toEqual([{ workspaceId: 'workspace-a', role: 'admin' }])
  })

  it('refuses a foreign workspace and non-admin policy mutations', async () => {
    const access = tools([{ teamId: 'workspace-a', userId: 'user-a', role: 'member', status: 'active' }])
    await expect(requireWorkspaceAccess(access, 'user-a', 'workspace-b')).rejects.toBeInstanceOf(WorkspaceAccessError)
    await expect(requireWorkspaceAccess(access, 'user-a', 'workspace-a', true)).rejects.toMatchObject({ status: 403 })
    await expect(requireWorkspaceAccess(access, 'user-a', 'workspace-a')).resolves.toEqual({ workspaceId: 'workspace-a', role: 'member' })
  })

  it('accepts only canonical workspace request headers', () => {
    expect(workspaceIdFromRequest(new Request('https://app.test', { headers: { 'X-Workspace-Id': 'workspace-a' } }))).toBe('workspace-a')
    expect(workspaceIdFromRequest(new Request('https://app.test', { headers: { 'X-Workspace-Id': 'other-tenant' } }))).toBeUndefined()
  })
})
