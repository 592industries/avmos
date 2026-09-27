import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'

export const retentionDays = (env: Env) => ({
  observations: days(env.TELEMETRY_RAW_RETENTION_DAYS, 7), aggregates: days(env.TELEMETRY_AGGREGATE_RETENTION_DAYS, 30),
  logs: days(env.OPERATIONS_LOG_RETENTION_DAYS, 7), actions: days(env.ACTION_RETENTION_DAYS, 30),
  decisions: days(env.POLICY_DECISION_RETENTION_DAYS, 90), alerts: days(env.ALERT_RETENTION_DAYS, 30), audit: days(env.AUDIT_RETENTION_DAYS, 180),
})
export function expiry(daysToKeep: number, from = new Date()) { const value = new Date(from.getTime() + daysToKeep * 86_400_000); return { expiresAt: value.toISOString(), expiresOn: value.toISOString().slice(0, 10) } }
export function hourBucket(value: string | Date) { const date = new Date(value); date.setUTCMinutes(0, 0, 0); return date.toISOString() }
export function safeMessage(value: unknown) { return (value instanceof Error ? value.message : String(value)).replace(/(api[-_ ]?key|token|secret|authorization|wallet|private[-_ ]?key)\s*[:=]\s*\S+/gi, '$1=[REDACTED]').slice(0, 240) }
export async function logOperation(tools: ActionTools, env: Env, task: string, status: 'SUCCESS' | 'ERROR', message: string) { const timestamp = new Date(); await tools.create('operations-log', { task, status, message: safeMessage(message), timestamp: timestamp.toISOString(), ...expiry(retentionDays(env).logs, timestamp) }) }
function days(value: string | undefined, fallback: number) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 && parsed <= 3650 ? parsed : fallback }
