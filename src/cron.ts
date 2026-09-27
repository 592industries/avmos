/**
 * Cron task definitions — registered into the AppCronRoom DO at construction
 * time (worker.ts). The DO alarm fires `runTask(name, env)` on the schedule
 * declared here; the DO itself records executions, tracks history, and
 * pushes status to admin clients via the `/ws/cron/:roomId` WebSocket.
 *
 * Each task declares EITHER `intervalMinutes` (run every N minutes) OR
 * `schedule` + `timezone` (5-field cron expression). CronRoom validates
 * the config at construction time and throws on ambiguous declarations.
 *
 * Example:
 *
 *   import type { CronTask } from 'deepspace/worker'
 *   import { buildCronContext } from 'deepspace/worker'
 *
 *   export const tasks: CronTask[] = [
 *     { name: 'heartbeat', intervalMinutes: 1 },
 *     { name: 'daily-report', schedule: '0 9 * * *', timezone: 'America/New_York' },
 *   ]
 *
 *   export async function runTask(name: string, env: Env): Promise<void> {
 *     const ctx = buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`)
 *     if (name === 'heartbeat') {
 *       // …
 *     }
 *   }
 */

import type { CronTask } from 'deepspace/worker'
import type { Env } from '../worker'
import { executeAgentCycle } from './actions'
import { createActionTools } from './server/action-routes'
import { pollInfrastructure } from './telemetry/poller'

export const tasks: CronTask[] = [
  { name: 'poll-infrastructure', intervalMinutes: 1 },
  { name: 'operate-infrastructure', intervalMinutes: 15 },
]

export async function runTask(name: string, env: Env): Promise<void> {
  if (name === 'poll-infrastructure') {
    await pollInfrastructure(env)
    return
  }
  if (name !== 'operate-infrastructure') throw new Error(`Unknown cron task: ${name}`)
  if (env.AUTONOMOUS_RUNS_ENABLED !== 'true') return
  const tools = createActionTools(env, env.OWNER_USER_ID, env.APP_OWNER_JWT)
  const slot = Math.floor(Date.now() / (15 * 60_000))
  const result = await executeAgentCycle(tools, env, 'live', `cron-${env.NEW_RELIC_RESOURCE_ID ?? 'avmos'}-${slot}`)
  if (!result.success) throw new Error(result.error)
}
