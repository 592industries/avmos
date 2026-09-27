import type { Env } from '../../worker'
import { DeepSpaceOperationsStore } from '../operations/deepspace-store'
import { createActionTools } from '../server/action-routes'
import { NewRelicTelemetryAdapter } from './newrelic'

/** One CronRoom schedule feeds the shared RecordRoom; browsers never call New Relic. */
export async function pollInfrastructure(env: Env): Promise<void> {
  const resourceId = env.NEW_RELIC_RESOURCE_ID ?? 'avmos'
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
    if (!env.NEW_RELIC_USER_KEY || !env.NEW_RELIC_ACCOUNT_ID || !env.NEW_RELIC_ENTITY_GUID) {
      await store.recordTelemetryFailure(resourceId, 'UNAVAILABLE')
      return
    }
    const adapter = new NewRelicTelemetryAdapter({
      userKey: env.NEW_RELIC_USER_KEY,
      accountId: Number(env.NEW_RELIC_ACCOUNT_ID),
      entityGuid: env.NEW_RELIC_ENTITY_GUID,
      region: (env.NEW_RELIC_REGION ?? 'US') as 'US' | 'EU' | 'JP',
      resourceId,
    })
    const signal = AbortSignal.timeout(20_000)
    const resource = await adapter.getResource(resourceId, signal)
    let trend: Awaited<ReturnType<NewRelicTelemetryAdapter['getStorageTrend']>> | undefined
    let trendStatus: 'LIVE' | 'UNAVAILABLE' | 'ERROR' = 'LIVE'
    let trendError: string | undefined
    try {
      trend = await adapter.getStorageTrend(resourceId, signal)
    } catch (error) {
      trendError = error instanceof Error ? error.message : String(error)
      trendStatus = /insufficient historical|trend is stale/i.test(trendError) ? 'UNAVAILABLE' : 'ERROR'
    }
    await store.recordResource(resource, trend, trendStatus, trendError)
  } catch (error) {
    await store.recordTelemetryFailure(resourceId, 'ERROR')
    throw error
  } finally {
    await lease('release')
  }
}
