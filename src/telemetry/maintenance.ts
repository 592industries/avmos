import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { expiry, hourBucket, logOperation, retentionDays, safeMessage } from './retention'

type Envelope<T> = { recordId: string; data: T }
export async function aggregateTelemetry(tools: ActionTools, env: Env, now = new Date()) {
  const completed = new Date(now); completed.setUTCMinutes(0, 0, 0); completed.setUTCHours(completed.getUTCHours() - 1)
  const bucket = completed.toISOString()
  const groups = new Map<string, Array<Envelope<{ workspaceId: string; resourceId: string; metric: string; unit: string; value?: number; status: string }>>>()
  const resources = await tools.query('resources', { limit: 500 })
  if (!resources.success) throw new Error(resources.error)
  const metrics = ['cpu_utilization', 'memory_utilization', 'storage_utilization', 'network_receive_bytes_per_second', 'network_transmit_bytes_per_second']
  for (const resource of resources.data.records) {
    const workspaceId = String(resource.data.workspaceId ?? '')
    if (!workspaceId) continue
    for (const metric of metrics) {
      const result = await tools.query<{ workspaceId: string; resourceId: string; metric: string; unit: string; value?: number; status: string }>('telemetry-observations', { where: { workspaceId, hourBucket: bucket, resourceId: resource.recordId, metric }, limit: 500 })
      if (!result.success) throw new Error(result.error)
      const live = result.data.records.filter((row) => row.data.value !== undefined && row.data.status === 'LIVE')
      if (live.length) groups.set(`${workspaceId}|${resource.recordId}|${metric}`, live)
    }
  }
  const workspaceCounts = new Map<string, number>()
  for (const rows of groups.values()) { const first = rows[0].data; const values = rows.map((row) => row.data.value!); const end = new Date(completed.getTime() + 3_600_000); await tools.create('telemetry-aggregates', { workspaceId: first.workspaceId, resourceId: first.resourceId, metric: first.metric, unit: first.unit, bucketStart: bucket, bucketEnd: end.toISOString(), minimum: Math.min(...values), maximum: Math.max(...values), average: values.reduce((a, b) => a + b, 0) / values.length, sampleCount: values.length, status: 'LIVE', ...expiry(retentionDays(env).aggregates, end) }, `aggregate:${first.workspaceId}:${first.resourceId}:${first.metric}:${bucket}`); workspaceCounts.set(first.workspaceId, (workspaceCounts.get(first.workspaceId) ?? 0) + 1) }
  for (const [workspaceId, count] of workspaceCounts) await logOperation(tools, env, workspaceId, 'aggregate-telemetry', 'SUCCESS', `Aggregated ${count} metric groups for ${bucket}.`)
}

const RETAINED = ['telemetry-observations', 'telemetry-aggregates', 'operations-log', 'actions', 'policy-decisions', 'alerts', 'audit-events'] as const
export async function cleanupRetention(tools: ActionTools, env: Env, now = new Date()) {
  const configured = Math.min(500, Math.max(1, Number(env.RETENTION_DELETE_BATCH_SIZE) || 500))
  const deadline = Date.now() + 20_000
  const workspaces = await tools.query('workspaces', { limit: 500 })
  if (!workspaces.success) throw new Error(workspaces.error)
  for (const workspace of workspaces.data.records) for (const collection of RETAINED) {
    let deleted = 0; let status = 'CURRENT'; let error: string | undefined
    const statusId = `${workspace.recordId}:${collection}`
    const previous = await tools.get<{ cursorDate?: string }>('retention-status', statusId)
    let cursorDate = previous.success && previous.data.record?.data.cursorDate ? previous.data.record.data.cursorDate : await oldestExpiryDate(tools, collection, workspace.recordId)
    try {
      for (let page = 0; page < 12 && Date.now() < deadline; page += 1) {
        if (!cursorDate || cursorDate > now.toISOString().slice(0, 10)) break
        const removal = await tools.deleteWhere(collection, { workspaceId: workspace.recordId, expiresOn: cursorDate }, configured)
        if (!removal.success) throw new Error(removal.error)
        deleted += removal.data.deleted
        if (removal.data.deleted < configured) cursorDate = await oldestExpiryDate(tools, collection, workspace.recordId)
      }
      status = cursorDate && cursorDate <= now.toISOString().slice(0, 10) ? 'BACKLOG' : 'CURRENT'
    } catch (cause) { status = 'ERROR'; error = safeMessage(cause) }
    await tools.create('retention-status', { workspaceId: workspace.recordId, collection, status, deleted, ...(cursorDate ? { cursorDate, oldestExpiresAt: `${cursorDate}T00:00:00.000Z` } : {}), lastRunAt: now.toISOString(), ...(error ? { error } : {}) }, statusId)
  }
  for (const workspace of workspaces.data.records) await logOperation(tools, env, workspace.recordId, 'cleanup-retention', 'SUCCESS', 'Retention cleanup completed.')
}

async function oldestExpiryDate(tools: ActionTools, collection: string, workspaceId: string): Promise<string | undefined> {
  const oldest = await tools.query<{ expiresOn?: string }>(collection, { where: { workspaceId }, orderBy: 'expiresAt', orderDir: 'asc', limit: 500 })
  if (!oldest.success) throw new Error(oldest.error)
  return oldest.data.records.map((row) => row.data.expiresOn).find((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
}

export { hourBucket }
