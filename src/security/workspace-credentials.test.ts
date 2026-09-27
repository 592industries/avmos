import { describe, expect, it } from 'vitest'
import { deleteWorkspaceCredential, readWorkspaceCredential, resolveWorkspaceCredentialKey, storeWorkspaceCredential } from './workspace-credentials'

function memoryStorage(): DurableObjectStorage {
  const data = new Map<string, unknown>()
  return {
    get: async (key: string) => data.get(key),
    put: async (key: string, value: unknown) => { data.set(key, value) },
    delete: async (key: string) => data.delete(key),
  } as unknown as DurableObjectStorage
}

describe('workspace credential store', () => {
  it('encrypts workspace secrets and never stores plaintext', async () => {
    const storage = memoryStorage()
    await storeWorkspaceCredential(storage, 'workspace-credential-root-secret', 'workspace-a', 'newrelic', { userKey: 'NRAK-SECRET' })
    const stored = await (storage as unknown as { get: (key: string) => Promise<{ ciphertext?: string }> }).get('avmos:workspace-credential:workspace-a:newrelic')
    expect(JSON.stringify(stored)).not.toContain('NRAK-SECRET')
    expect(await readWorkspaceCredential(storage, 'workspace-credential-root-secret', 'workspace-a', 'newrelic')).toEqual({ userKey: 'NRAK-SECRET' })
    expect(await readWorkspaceCredential(storage, 'workspace-credential-root-secret', 'workspace-b', 'newrelic')).toBeNull()
  })

  it('does not leak one workspace credential to another workspace', async () => {
    const storage = memoryStorage()
    await storeWorkspaceCredential(storage, 'workspace-credential-root-secret', 'workspace-a', 'newrelic', { userKey: 'tenant-a' })
    await storeWorkspaceCredential(storage, 'workspace-credential-root-secret', 'workspace-b', 'newrelic', { userKey: 'tenant-b' })
    expect(await readWorkspaceCredential(storage, 'workspace-credential-root-secret', 'workspace-a', 'newrelic')).toEqual({ userKey: 'tenant-a' })
    expect(await readWorkspaceCredential(storage, 'workspace-credential-root-secret', 'workspace-b', 'newrelic')).toEqual({ userKey: 'tenant-b' })
    await deleteWorkspaceCredential(storage, 'workspace-a', 'newrelic')
    expect(await readWorkspaceCredential(storage, 'workspace-credential-root-secret', 'workspace-a', 'newrelic')).toBeNull()
    expect(await readWorkspaceCredential(storage, 'workspace-credential-root-secret', 'workspace-b', 'newrelic')).toEqual({ userKey: 'tenant-b' })
  })

  it('derives a stable app-scoped key when WORKSPACE_CREDENTIAL_KEY is unset', async () => {
    expect(resolveWorkspaceCredentialKey({ DEEPSPACE_APP_ID: 'app_01M3FSEF0RC4H3BFSYABBGAGRP' })).toMatch(/^avmos-workspace-credential-v1:app_/)
    expect(resolveWorkspaceCredentialKey({
      WORKSPACE_CREDENTIAL_KEY: 'explicit-workspace-credential-root',
      DEEPSPACE_APP_ID: 'app_01M3FSEF0RC4H3BFSYABBGAGRP',
    })).toBe('explicit-workspace-credential-root')
  })
})
