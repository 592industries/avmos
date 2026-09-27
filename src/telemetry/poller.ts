import type { Env } from '../../worker'
import { DeepSpaceOperationsStore } from '../operations/deepspace-store'
import { createActionTools } from '../server/action-routes'
import { canonicalResourceId, type InfrastructureResource, type TelemetryObservation } from '../domain/operations'
import { readCredential } from '../security/credential-store'
import { ensureOwnerWorkspace } from '../workspaces'
import { NewRelicTelemetryAdapter } from './newrelic'
import { logOperation } from './retention'

/** One CronRoom schedule feeds the shared RecordRoom; browsers never call New Relic. */
export async function pollInfrastructure(env: Env): Promise<void> {
  const room = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
  const token = crypto.randomUUID()
  const lease = (action: 'acquire' | 'release') => room.fetch(new Request('https://internal/internal/avmos/poll-lease', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, token }),
  }))
  const claimed = await lease('acquire')
  if (!claimed.ok || !(await claimed.json() as { acquired?: boolean }).acquired) return
  const tools = createActionTools(env, env.OWNER_USER_ID, env.APP_OWNER_JWT)
  try {
    const saved = await tools.query<IntegrationConfig>('integration-config', {
      where: { providerId: 'newrelic' },
      limit: 500,
    })
    if (!saved.success) throw new Error(saved.error)
    let configurations = saved.data.records.map((row) => ({ recordId: row.recordId, ...row.data }))
    if (!configurations.length && env.NEW_RELIC_USER_KEY && env.NEW_RELIC_ACCOUNT_ID) {
      const ownerWorkspace = await ensureOwnerWorkspace(tools, env.OWNER_USER_ID)
      const now = new Date().toISOString()
      const recordId = integrationId(ownerWorkspace.workspaceId)
      const fallback: IntegrationConfig & { recordId: string } = {
        recordId,
        workspaceId: ownerWorkspace.workspaceId,
        providerId: 'newrelic',
        publicConfig: {
          accountId: env.NEW_RELIC_ACCOUNT_ID,
          region: env.NEW_RELIC_REGION ?? 'US',
        },
        verificationStatus: 'CONNECTED',
        discoveryStatus: 'NEVER_RUN',
        discoveryCount: 0,
        updatedAt: now,
        updatedBy: env.OWNER_USER_ID,
      }
      const created = await tools.create('integration-config', fallback, recordId)
      if (!created.success) throw new Error(created.error)
      configurations = [fallback]
    }
    for (const configuration of configurations) {
      await pollWorkspace(tools, env, configuration)
    }
  } catch (error) {
    await logOperation(tools, env, 'workspace-default', 'poll-infrastructure', 'ERROR', error instanceof Error ? error.message : String(error))
  } finally {
    await lease('release')
  }
}

export async function pollWorkspaceIntegration(
  tools: ReturnType<typeof createActionTools>,
  env: Env,
  integrationRecordId: string,
): Promise<void> {
  const result = await tools.get<IntegrationConfig>('integration-config', integrationRecordId)
  if (!result.success) throw new Error('New Relic integration configuration is unavailable.')
  await pollWorkspace(tools, env, { recordId: integrationRecordId, ...result.data.record.data })
  const completed = await tools.get<IntegrationConfig & { lastError?: string }>('integration-config', integrationRecordId)
  if (!completed.success || completed.data.record.data.discoveryStatus !== 'DISCOVERY_COMPLETE') {
    throw new Error(completed.success ? completed.data.record.data.lastError ?? 'Fleet discovery failed.' : 'Fleet discovery status is unavailable.')
  }
}

async function pollWorkspace(
  tools: ReturnType<typeof createActionTools>,
  env: Env,
  configuration: IntegrationConfig & { recordId: string },
): Promise<void> {
  const started = Date.now()
  const now = new Date().toISOString()
  const store = new DeepSpaceOperationsStore(tools, env, configuration.workspaceId)
  await tools.update('integration-config', configuration.recordId, {
    discoveryStatus: 'DISCOVERING',
    lastError: '',
    updatedAt: now,
  })
  try {
    const stored = env.WORKSPACE_CREDENTIAL_KEY
      ? await readCredential(env, configuration.workspaceId, 'newrelic')
      : null
    const resolved = resolveNewRelicPollCredentials(configuration, stored, env)
    const userKey = resolved.userKey
    const accountId = resolved.accountId
    if (!userKey || !Number.isSafeInteger(accountId) || accountId <= 0) {
      throw new Error('New Relic account configuration is incomplete.')
    }
    const region = String(configuration.publicConfig.region ?? (configuration.workspaceId === 'workspace-default' ? env.NEW_RELIC_REGION : undefined) ?? 'US')
    if (!['US', 'EU', 'JP'].includes(region)) throw new Error('New Relic region is invalid.')
    const prefix = String(configuration.publicConfig.fleetPrefix ?? '').trim() || undefined
    const adapter = new NewRelicTelemetryAdapter({
      userKey,
      accountId,
      region: region as 'US' | 'EU' | 'JP',
      ...(prefix ? { fleetPrefix: prefix } : {}),
    })
    const snapshots = await adapter.getFleetSnapshots(AbortSignal.timeout(20_000))
    const existing = await tools.query<{ workspaceId: string; provider: string }>('resources', {
      where: { workspaceId: configuration.workspaceId, provider: 'new_relic' },
      limit: 500,
    })
    if (!existing.success) throw new Error(existing.error)
    const observed = new Set<string>()
    let observations = 0
    let lastTelemetryAt: string | undefined
    for (const snapshot of snapshots) {
      const externalId = snapshot.resource.sourceEntityId ?? snapshot.resource.hostname
      const resourceId = canonicalResourceId(configuration.workspaceId, 'new_relic', externalId)
      observed.add(resourceId)
      const resource: InfrastructureResource = {
        ...snapshot.resource,
        id: resourceId,
        workspaceId: configuration.workspaceId,
        provider: 'new_relic',
        externalId,
      }
      const scopedObservations: TelemetryObservation[] = snapshot.observations.map((item) => ({
        ...item,
        resourceId,
      }))
      await store.recordTelemetrySnapshot(resource, scopedObservations)
      observations += scopedObservations.length
      const newest = scopedObservations.map((item) => item.observedAt).sort().at(-1)
      if (newest && (!lastTelemetryAt || newest > lastTelemetryAt)) lastTelemetryAt = newest
    }
    for (const row of existing.data.records) {
      if (!observed.has(row.recordId)) await store.recordTelemetryFailure(row.recordId, 'UNAVAILABLE')
    }
    const completedAt = new Date().toISOString()
    await tools.update('integration-config', configuration.recordId, {
      verificationStatus: 'CONNECTED',
      credentialSource: resolved.source,
      discoveryStatus: 'DISCOVERY_COMPLETE',
      discoveryCount: snapshots.length,
      lastDiscoveryAt: completedAt,
      lastPollAt: completedAt,
      lastPollDurationMs: Date.now() - started,
      ...(lastTelemetryAt ? { lastTelemetryAt } : {}),
      nextPollAt: new Date(Date.now() + 60_000).toISOString(),
      lastError: '',
      updatedAt: completedAt,
    })
    await logOperation(tools, env, configuration.workspaceId, 'poll-infrastructure', 'SUCCESS', `Stored ${snapshots.length} New Relic resources and ${observations} observations.`)
  } catch (error) {
    await markWorkspace(tools, store, configuration.workspaceId, 'ERROR')
    const failedAt = new Date().toISOString()
    const message = error instanceof Error ? error.message : String(error)
    await tools.update('integration-config', configuration.recordId, {
      discoveryStatus: 'DISCOVERY_ERROR',
      lastPollAt: failedAt,
      lastPollDurationMs: Date.now() - started,
      nextPollAt: new Date(Date.now() + 60_000).toISOString(),
      lastError: message,
      updatedAt: failedAt,
    })
    await logOperation(tools, env, configuration.workspaceId, 'poll-infrastructure', 'ERROR', message)
  }
}

async function markWorkspace(tools: ReturnType<typeof createActionTools>, store: DeepSpaceOperationsStore, workspaceId: string, status: 'UNAVAILABLE' | 'ERROR') {
  const existing = await tools.query('resources', { where: { workspaceId }, limit: 500 })
  if (!existing.success) return
  for (const row of existing.data.records) await store.recordTelemetryFailure(row.recordId, status)
}

type IntegrationConfig = {
  workspaceId: string
  providerId: string
  publicConfig: Record<string, string | number | boolean>
  verificationStatus: string
  discoveryStatus: string
  discoveryCount: number
  updatedAt: string
  updatedBy: string
}

export function resolveNewRelicPollCredentials(
  configuration: Pick<IntegrationConfig, 'workspaceId' | 'publicConfig'>,
  stored: Record<string, string> | null,
  env: Pick<Env, 'NEW_RELIC_USER_KEY' | 'NEW_RELIC_ACCOUNT_ID'>,
): { userKey?: string; accountId: number; source: 'workspace credential' | 'environment fallback' | 'none' } {
  const allowEnvironment = configuration.workspaceId === 'workspace-default'
  const userKey = stored?.userKey ?? (allowEnvironment ? env.NEW_RELIC_USER_KEY : undefined)
  const accountId = Number(configuration.publicConfig.accountId ?? (allowEnvironment ? env.NEW_RELIC_ACCOUNT_ID : undefined))
  return {
    userKey,
    accountId,
    source: stored?.userKey ? 'workspace credential' : userKey ? 'environment fallback' : 'none',
  }
}

function integrationId(workspaceId: string): string {
  return `integration:${workspaceId}:newrelic`
}
