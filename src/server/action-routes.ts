/**
 * Authenticated server actions and the tools they use to reach app records
 * and integrations.
 *
 * Trust model — read before adding an action:
 *
 * This worker is the only authorization boundary. `resolveAuth` establishes
 * *who* is calling; everything after it runs with that identity and no further
 * checks. The tools handed to an action (`createActionTools`) reach the record
 * room with `X-App-Action: 'true'`, which turns **per-record RBAC off**: the
 * `userId` they carry is the identity they act *as*, not a permission the room
 * enforces. `tools.query`/`tools.update`/`tools.remove`/`tools.deleteWhere`
 * will therefore read and write any collection, including other users' rows.
 *
 * So an action that takes a record id from `params` and passes it to `tools.*`
 * has authorized nothing. Check ownership yourself — load the record and
 * compare it against `userId` before writing (`chat-history.ts`'s `getChat` is
 * the SDK's worked example) — or the action is an open door with a login page
 * in front of it.
 *
 * `tools.deleteWhere(collection, where, limit?)` is the batch delete behind
 * cascades: it removes at most `limit` matching records (default 100, max 500)
 * and answers `{ deleted }`, so a drain loop repeats the same call until
 * `deleted` is below the limit. `where` must be non-empty and every key must
 * name a real field, so it can never truncate a collection by accident — but
 * with RBAC off it does not care who owns the rows, so scope `where` to the
 * caller yourself.
 */

import type { Hono } from 'hono'
import { apiWorkerFetch, normalizeApiError, resolveAppRole } from 'deepspace/worker'
import { z } from 'zod/v4'
import type { ActionResult, ActionTools, VerifyResult } from 'deepspace/worker'
import { actions } from '../actions/index.js'
import { integrations } from '../integrations.js'
import type { AppContext, Env } from '../../worker.js'

type ResolveAuth = (req: Request, env: Env) => Promise<VerifyResult | null>

const ACTION_POLICY = {
  runAgentCycle: { schema: z.object({ mode: z.enum(['live', 'demo-approved', 'demo-denied']).optional(), research: z.boolean().optional() }).strict(), ownerOnly: true, roles: ['admin'], perMinute: 4, idempotencyRequired: true },
  askOperator: { schema: z.object({ question: z.string().trim().min(1).max(500) }).strict(), ownerOnly: false, roles: ['admin', 'member'], perMinute: 20, idempotencyRequired: false },
  setupXrplTrustLine: { schema: z.object({}).strict(), ownerOnly: true, roles: ['admin'], perMinute: 1, idempotencyRequired: true },
  reconcileXrplOperation: { schema: z.object({ operationId: z.string().min(1).max(100) }).strict(), ownerOnly: true, roles: ['admin'], perMinute: 4, idempotencyRequired: true },
} as const

function error(code: string, message: string, requestId: string, status: number): Response {
  return Response.json({ error: { code, message, requestId } }, { status })
}

export function registerActionRoutes(app: Hono<AppContext>, resolveAuth: ResolveAuth): void {
  app.get('/api/health', async (c) => {
    const requestId = crypto.randomUUID()
    const auth = await resolveAuth(c.req.raw, c.env)
    if (!auth) return error('AUTH_REQUIRED', 'Authentication is required.', requestId, 401)
    const role = await resolveAppRole(c.env, auth.userId)
    if (!role) return error('FORBIDDEN', 'Application membership is required.', requestId, 403)
    const telemetryConfigured = Boolean(c.env.NEW_RELIC_USER_KEY && c.env.NEW_RELIC_ACCOUNT_ID && c.env.NEW_RELIC_ENTITY_GUID)
    const reasoningConfigured = Boolean(c.env.GROK_API_KEY)
    const destinationConfigured = Boolean(c.env.XRPL_VENDOR_DESTINATION)
    return c.json({ requestId, status: telemetryConfigured && reasoningConfigured && destinationConfigured ? 'CONFIGURED' : 'SETUP_REQUIRED', services: { newRelic: telemetryConfigured, grok: reasoningConfigured, xrplDestination: destinationConfigured }, modes: { autonomous: c.env.AUTONOMOUS_RUNS_ENABLED === 'true', demo: c.env.DEMO_MODE === 'true', settlement: c.env.XRPL_EXECUTION_MODE === 'live' ? 'TESTNET' : 'SIMULATED' }, retention: { rawTelemetryDays: Number(c.env.TELEMETRY_RAW_RETENTION_DAYS) || 7, aggregateTelemetryDays: Number(c.env.TELEMETRY_AGGREGATE_RETENTION_DAYS) || 30, operationsLogDays: Number(c.env.OPERATIONS_LOG_RETENTION_DAYS) || 7, actionsDays: Number(c.env.ACTION_RETENTION_DAYS) || 30, policyDecisionDays: Number(c.env.POLICY_DECISION_RETENTION_DAYS) || 90, alertsDays: Number(c.env.ALERT_RETENTION_DAYS) || 30, auditDays: Number(c.env.AUDIT_RETENTION_DAYS) || 180 } })
  })
  app.post('/api/actions/:name', async (c) => {
    const requestId = crypto.randomUUID()
    if (c.req.header('Origin') && c.req.header('Origin') !== new URL(c.req.url).origin) {
      return error('FORBIDDEN', 'Cross-origin actions are not allowed.', requestId, 403)
    }
    const auth = await resolveAuth(c.req.raw, c.env)
    if (!auth) return error('AUTH_REQUIRED', 'Authentication is required.', requestId, 401)
    // `resolveAuth` may accept a cookie session, which carries no bearer token
    // — and `VerifyResult` exposes the claims, not the raw JWT. Actions need
    // the token itself (user-billed integrations forward it), so a call
    // without one is refused as an auth failure, next to the check above,
    // rather than crashing on a missing header further down.
    const authHeader = c.req.header('Authorization') ?? ''
    const callerJwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!callerJwt) return error('AUTH_REQUIRED', 'A bearer token is required.', requestId, 401)
    // Who called: actions run RBAC-off and can bill the owner, and the
    // platform's request log carries no user — this line is the attribution.
    // The name is a decoded path segment, so it is quoted, never interpolated raw.
    const name = c.req.param('name')
    if (!(name in ACTION_POLICY)) return error('VALIDATION_ERROR', 'Action not found.', requestId, 404)
    const policy = ACTION_POLICY[name as keyof typeof ACTION_POLICY]
    const role = await resolveAppRole(c.env, auth.userId)
    if (!role || !(policy.roles as readonly string[]).includes(role) || (policy.ownerOnly && auth.userId !== c.env.OWNER_USER_ID)) {
      return error('FORBIDDEN', 'You cannot run this action.', requestId, 403)
    }
    if (!c.req.header('Content-Type')?.toLowerCase().startsWith('application/json')) {
      return error('VALIDATION_ERROR', 'JSON content type is required.', requestId, 415)
    }
    const raw = await c.req.text()
    if (raw.length > 8192) return error('VALIDATION_ERROR', 'Request body is too large.', requestId, 413)
    let body: unknown
    try { body = JSON.parse(raw) } catch { return error('VALIDATION_ERROR', 'Malformed JSON.', requestId, 400) }
    const parsed = policy.schema.safeParse(body)
    if (!parsed.success) return error('VALIDATION_ERROR', 'Invalid action parameters.', requestId, 400)
    const idempotencyKey = c.req.header('Idempotency-Key')
    if (policy.idempotencyRequired && (!idempotencyKey || !z.uuid().safeParse(idempotencyKey).success)) {
      return error('VALIDATION_ERROR', 'A UUID Idempotency-Key header is required.', requestId, 400)
    }
    const namespace = c.env.RECORD_ROOMS
    const stub = namespace.get(namespace.idFromName(`app:${c.env.DEEPSPACE_APP_ID}`))
    const rate = await stub.fetch(new Request('https://internal/internal/avmos/rate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: `${auth.userId}:${name}`, limit: policy.perMinute }),
    }))
    if (!rate.ok || !(await rate.json() as { allowed: boolean }).allowed) {
      return error('RATE_LIMITED', 'Action rate limit exceeded.', requestId, 429)
    }
    console.info(JSON.stringify({ event: 'action.received', requestId, action: name, userId: auth.userId }))
    const action = actions[name]
    const params = { ...parsed.data, ...(idempotencyKey ? { idempotencyKey } : {}) }
    const tools = createActionTools(c.env, auth.userId, callerJwt)
    const result = await action({ userId: auth.userId, params, tools, env: c.env, callerJwt })
    if ((result as { code?: string }).code === 'IDEMPOTENCY_CONFLICT') {
      return error('IDEMPOTENCY_CONFLICT', 'This key belongs to a different request.', requestId, 409)
    }
    return c.json(result as unknown as Record<string, unknown>)
  })
}

export function createActionTools(env: Env, userId: string, callerJwt: string): ActionTools {
  const stub = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))

  // The DO returns ActionResult<unknown>; callers below supply the precise
  // operation result type fixed by the SDK tools-api wire contract.
  async function execTool<TData>(
    tool: string,
    params: Record<string, unknown>,
  ): Promise<ActionResult<TData>> {
    const res = await stub.fetch(
      new Request('https://internal/api/tools/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
          'X-App-Action': 'true',
        },
        body: JSON.stringify({ tool, params }),
      }),
    )
    return res.json() as Promise<ActionResult<TData>>
  }

  async function callIntegration<T>(endpoint: string, data?: unknown): Promise<ActionResult<T>> {
    const integrationName = endpoint.split('/')[0]
    const billingMode = integrations[integrationName]?.billing ?? 'developer'

    // The api-worker bills the JWT subject: owner for developer mode, caller
    // for user mode. It does not accept a client-supplied billing override.
    const jwt = billingMode === 'developer' ? env.APP_OWNER_JWT : callerJwt

    const res = await apiWorkerFetch(env, `/api/integrations/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify(data ?? {}),
    })
    const payload = (await res.json()) as Record<string, unknown>
    if (!res.ok || payload.success === false) {
      return { success: false, ...normalizeApiError(res.status, payload) }
    }
    return payload as ActionResult<T>
  }

  return {
    create: (collection, data, recordId) =>
      execTool('records.create', { collection, data, recordId }),
    update: (collection, recordId, data) =>
      execTool('records.update', { collection, recordId, data }),
    remove: (collection, recordId) => execTool('records.delete', { collection, recordId }),
    deleteWhere: (collection, where, limit) =>
      execTool('records.deleteWhere', { collection, where, limit }),
    get: (collection, recordId) => execTool('records.get', { collection, recordId }),
    query: (collection, options) => execTool('records.query', { collection, ...options }),
    integration: callIntegration,
    registerUser: (options) => execTool('users.register', { ...options }),
  }
}
