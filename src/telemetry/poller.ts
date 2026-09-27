import type { Env } from '../../worker'
import { DeepSpaceOperationsStore } from '../operations/deepspace-store'
import { createActionTools } from '../server/action-routes'
import { NewRelicTelemetryAdapter } from './newrelic'
import { logOperation } from './retention'

/** One CronRoom schedule feeds the shared RecordRoom; browsers never call New Relic. */
export async function pollInfrastructure(env: Env): Promise<void> {
  const fleetPrefix = env.NEW_RELIC_FLEET_PREFIX ?? 'avmos-node-'
  const room = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
  const token = crypto.randomUUID()
  const lease = (action: 'acquire' | 'release') => room.fetch(new Request('https://internal/internal/avmos/poll-lease', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, token }),
  }))
  const claimed = await lease('acquire')
  if (!claimed.ok || !(await claimed.json() as { acquired?: boolean }).acquired) return
  const tools = createActionTools(env, env.OWNER_USER_ID, env.APP_OWNER_JWT)
  const store = new DeepSpaceOperationsStore(tools, env)
  try {
    if (!env.NEW_RELIC_USER_KEY || !env.NEW_RELIC_ACCOUNT_ID) {
      await markFleet(tools, store, fleetPrefix, 'UNAVAILABLE')
      await logOperation(tools, env, 'poll-infrastructure', 'ERROR', 'New Relic account configuration is incomplete.')
      return
    }
    const adapter = new NewRelicTelemetryAdapter({
      userKey: env.NEW_RELIC_USER_KEY,
      accountId: Number(env.NEW_RELIC_ACCOUNT_ID),
      entityGuid: env.NEW_RELIC_ENTITY_GUID,
      region: (env.NEW_RELIC_REGION ?? 'US') as 'US' | 'EU' | 'JP',
      fleetPrefix,
      resourceId: env.NEW_RELIC_RESOURCE_ID,
    })
    const snapshots = await adapter.getFleetSnapshots(AbortSignal.timeout(20_000))
    const existing = await tools.query('resources', { limit: 500 }); const observed = new Set(snapshots.map((snapshot) => snapshot.resource.id))
    for (const snapshot of snapshots) await store.recordTelemetrySnapshot(snapshot.resource, snapshot.observations)
    if (existing.success) for (const row of existing.data.records) if (row.recordId.startsWith(fleetPrefix) && !observed.has(row.recordId)) await store.recordTelemetryFailure(row.recordId, 'OFFLINE')
    await logOperation(tools, env, 'poll-infrastructure', 'SUCCESS', `Stored ${snapshots.length} AVMOS fleet resources and ${snapshots.reduce((count, item) => count + item.observations.length, 0)} observations.`)
  } catch (error) {
    await markFleet(tools, store, fleetPrefix, 'ERROR')
    await logOperation(tools, env, 'poll-infrastructure', 'ERROR', error instanceof Error ? error.message : String(error))
  } finally {
    await lease('release')
  }
}

async function markFleet(tools: ReturnType<typeof createActionTools>, store: DeepSpaceOperationsStore, prefix: string, status: 'UNAVAILABLE' | 'ERROR') {
  const existing = await tools.query('resources', { limit: 500 })
  if (!existing.success) return
  for (const row of existing.data.records) if (row.recordId.startsWith(prefix)) await store.recordTelemetryFailure(row.recordId, status)
}
