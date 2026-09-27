import type { Hono } from 'hono'
import { resolveAppMembership, type ActionTools, type VerifyResult } from 'deepspace/worker'
import { z } from 'zod/v4'
import type { AppContext, Env } from '../../worker'
import { policySchema, type AuditEventType, type Policy } from '../domain/operations'
import { providerConfigurationInput, providerDefinition, providerRegistry, safeProviderStatus, validProviderValues, type ProviderId } from '../providers/registry'
import { expiry, retentionDays, safeMessage } from '../telemetry/retention'
import { createActionTools } from './action-routes'

type ResolveAuth = (req: Request, env: Env) => Promise<VerifyResult | null>
type DiagnosticAction = { createdAt?:string;executionStatus?:string;providerId?:string;policyDecision?:{decision?:string;reason?:string};execution?:{error?:string} }
const policyInput = z.object({
  name: z.string().trim().min(2).max(100), enabled: z.boolean(),
  maxTransactionAmount: z.number().positive().max(1_000_000), dailyBudget: z.number().positive().max(10_000_000),
  maxTelemetryAgeSeconds: z.number().int().min(30).max(3600), requireEvidence: z.boolean(),
  allowedActions: z.array(z.literal('purchase_storage')).min(1).max(1),
  allowedResources: z.array(z.string().regex(/^avmos-node-\d{2}$/)).min(1).max(100),
  allowedAgents: z.array(z.literal('infrastructure-agent')).min(1).max(1),
  allowedProviders: z.array(z.literal('xrpl-testnet')).min(1).max(1),
  allowedVendors: z.array(z.literal('approved-storage-vendor')).min(1).max(1),
  currency: z.literal('RLUSD'),
}).strict()

export function registerAdminRoutes(app: Hono<AppContext>, resolveAuth: ResolveAuth): void {
  app.get('/api/public/status', async (c) => {
    const tools = createActionTools(c.env, c.env.OWNER_USER_ID, c.env.APP_OWNER_JWT)
    const [resources, alerts, agents] = await Promise.all([tools.query('resources', { limit: 100 }), tools.query('alerts', { where: { status: 'ACTIVE' }, limit: 100 }), tools.query('agents', { limit: 20 })])
    const fleet = resources.success ? resources.data.records.filter((row) => /^avmos-node-\d{2}$/.test(row.recordId)) : []
    return c.json({ resources: fleet.length, healthy: fleet.filter((row) => row.data.status === 'online').length, attention: alerts.success ? alerts.data.records.length : 0, agent: agents.success && agents.data.records.some((row) => row.data.status === 'ONLINE') ? 'ONLINE' : 'IDLE', telemetry: fleet.some((row) => row.data.telemetryStatus === 'LIVE') ? 'LIVE' : fleet.length ? 'DEGRADED' : 'UNAVAILABLE', updatedAt: new Date().toISOString() })
  })
  app.get('/api/avmos/integrations', async (c) => {
    const access = await authorize(c.req.raw, c.env, resolveAuth, false)
    if (access instanceof Response) return access
    const tools = createActionTools(c.env, access.auth.userId, c.env.APP_OWNER_JWT)
    const [saved, resources, agents, audits] = await Promise.all([
      tools.query<Record<string, unknown>>('integration-config', { limit: 20 }),
      tools.query<{telemetryStatus?:string}>('resources', { limit: 100 }),
      tools.query<{modelProvider?:string}>('agents', { limit: 20 }),
      tools.query<{eventType?:string}>('audit-events', { orderBy: 'timestamp', orderDir: 'desc', limit: 100 }),
    ])
    const records = saved.success ? saved.data.records : []
    return c.json({ providers: providerRegistry.map((provider) => {
      const configuration = records.find((row) => row.recordId === provider.id)?.data ?? null
      const configured = safeProviderStatus(provider.id, c.env)
      const verified = typeof configuration?.verificationStatus === 'string' ? configuration.verificationStatus : null
      const status = provider.id === 'newrelic' && resources.success && resources.data.records.some((row) => row.data.telemetryStatus === 'LIVE') ? 'LIVE'
        : provider.id === 'grok' && agents.success && agents.data.records.some((row) => row.data.modelProvider === 'xai') ? 'VERIFIED'
        : provider.id === 'tavily' && audits.success && audits.data.records.some((row) => row.data.eventType === 'RESEARCH_COMPLETE') ? 'VERIFIED'
        : provider.id === 'xrpl' && configured.status === 'SIMULATED' ? 'SIMULATED'
        : verified ?? configured.status
      return { ...provider, ...configured, status, configuration }
    }), role: access.membership.role })
  })

  app.get('/api/avmos/integrations/:provider', async (c) => {
    const access = await authorize(c.req.raw, c.env, resolveAuth, true)
    if (access instanceof Response) return access
    const provider = providerDefinition(c.req.param('provider'))
    if (!provider) return apiError('UNKNOWN_PROVIDER', 'Unknown provider.', 404)
    const tools = createActionTools(c.env, access.auth.userId, c.env.APP_OWNER_JWT)
    const stored = await tools.get<Record<string, unknown>>('integration-config', provider.id)
    return c.json({ provider: { ...provider, ...safeProviderStatus(provider.id, c.env) }, configuration: stored.success ? stored.data.record.data : null })
  })

  app.post('/api/avmos/integrations/:provider/configure', async (c) => {
    const access = await authorize(c.req.raw, c.env, resolveAuth, true)
    if (access instanceof Response) return access
    const provider = providerDefinition(c.req.param('provider'))
    if (!provider) return apiError('UNKNOWN_PROVIDER', 'Unknown provider.', 404)
    if (!provider.isImplemented) return apiError('NOT_IMPLEMENTED', 'This provider adapter is not implemented.', 409)
    const parsed = providerConfigurationInput.safeParse(await safeJson(c.req.raw))
    if (!parsed.success) return apiError('VALIDATION_ERROR', 'Invalid provider configuration.', 400)
    const unknownFields = Object.keys(parsed.data.values).filter((key) => !provider.publicFields.includes(key))
    const unknownSecrets = Object.keys(parsed.data.secrets).filter((key) => !provider.requiresSecrets.includes(key))
    if (unknownFields.length || unknownSecrets.length || !validProviderValues(provider.id, parsed.data.values)) return apiError('VALIDATION_ERROR', 'Configuration includes unsupported or invalid fields.', 400)
    const tools = createActionTools(c.env, access.auth.userId, c.env.APP_OWNER_JWT)
    const now = new Date().toISOString()
    const prior = await tools.get<Record<string, unknown>>('integration-config', provider.id)
    const result = await tools.create('integration-config', { providerId: provider.id, publicConfig: parsed.data.values, verificationStatus: prior.success ? prior.data.record.data.verificationStatus ?? 'NOT_VERIFIED' : 'NOT_VERIFIED', updatedAt: now, updatedBy: access.auth.userId }, provider.id)
    if (!result.success) return apiError('STORE_ERROR', 'Configuration could not be saved.', 503)
    await audit(tools, c.env, access.auth.userId, 'INTEGRATION_CONFIG_UPDATED', `integration:${provider.id}`, { providerId: provider.id, fields: Object.keys(parsed.data.values), secretFieldsReceived: Object.keys(parsed.data.secrets), secretsPersisted: false })
    return c.json({ success: true, message: Object.keys(parsed.data.secrets).length ? 'Public configuration saved. Production secrets remain managed by DeepSpace secrets.' : 'Configuration saved.', secretConfigured: safeProviderStatus(provider.id, c.env).configured })
  })

  app.post('/api/avmos/integrations/:provider/test', async (c) => {
    const access = await authorize(c.req.raw, c.env, resolveAuth, true)
    if (access instanceof Response) return access
    const provider = providerDefinition(c.req.param('provider'))
    if (!provider) return apiError('UNKNOWN_PROVIDER', 'Unknown provider.', 404)
    if (!provider.supportsTest) return apiError('NOT_IMPLEMENTED', 'Connection testing is unavailable for this provider.', 409)
    const parsed = providerConfigurationInput.safeParse(await safeJson(c.req.raw))
    if (!parsed.success) return apiError('VALIDATION_ERROR', 'Invalid provider configuration.', 400)
    const unknownSecrets = Object.keys(parsed.data.secrets).filter((key) => !provider.requiresSecrets.includes(key))
    if (unknownSecrets.length || !validProviderValues(provider.id, parsed.data.values)) return apiError('VALIDATION_ERROR', 'Configuration includes unsupported or invalid fields.', 400)
    const tools = createActionTools(c.env, access.auth.userId, c.env.APP_OWNER_JWT)
    await audit(tools, c.env, access.auth.userId, 'INTEGRATION_TEST_STARTED', `integration:${provider.id}`, { providerId: provider.id })
    const testedAt = new Date().toISOString()
    try {
      const outcome = await testProvider(provider.id, c.env, parsed.data.values, parsed.data.secrets)
      await tools.create('integration-config', { providerId: provider.id, publicConfig: parsed.data.values, verificationStatus: outcome.status, lastVerifiedAt: testedAt, updatedAt: testedAt, updatedBy: access.auth.userId }, provider.id)
      await audit(tools, c.env, access.auth.userId, 'INTEGRATION_VERIFIED', `integration:${provider.id}`, { providerId: provider.id, status: outcome.status })
      return c.json({ success: true, status: outcome.status, verifiedAt: testedAt, message: outcome.message })
    } catch (cause) {
      const message = safeMessage(cause)
      await tools.create('integration-config', { providerId: provider.id, publicConfig: parsed.data.values, verificationStatus: 'ERROR', lastError: message, updatedAt: testedAt, updatedBy: access.auth.userId }, provider.id)
      await audit(tools, c.env, access.auth.userId, 'INTEGRATION_TEST_FAILED', `integration:${provider.id}`, { providerId: provider.id, message })
      return apiError('CONNECTION_FAILED', message, 422)
    }
  })

  app.post('/api/avmos/integrations/:provider/clear', async (c) => {
    const access = await authorize(c.req.raw, c.env, resolveAuth, true)
    if (access instanceof Response) return access
    const provider = providerDefinition(c.req.param('provider'))
    if (!provider) return apiError('UNKNOWN_PROVIDER', 'Unknown provider.', 404)
    const tools = createActionTools(c.env, access.auth.userId, c.env.APP_OWNER_JWT)
    const removed = await tools.remove('integration-config', provider.id)
    if (!removed.success && removed.code !== 'not_found') return apiError('STORE_ERROR', 'Configuration could not be cleared.', 503)
    await audit(tools, c.env, access.auth.userId, 'INTEGRATION_CONFIG_CLEARED', `integration:${provider.id}`, { providerId: provider.id, environmentSecretsUnchanged: true })
    return c.json({ success: true, message: 'Stored public configuration cleared. DeepSpace environment secrets are unchanged.' })
  })

  app.post('/api/policies', async (c) => mutatePolicy(c.req.raw, c.env, resolveAuth, undefined))
  app.patch('/api/policies/:id', async (c) => mutatePolicy(c.req.raw, c.env, resolveAuth, c.req.param('id')))
  app.post('/api/policies/:id/enable', async (c) => togglePolicy(c.req.raw, c.env, resolveAuth, c.req.param('id'), true))
  app.post('/api/policies/:id/disable', async (c) => togglePolicy(c.req.raw, c.env, resolveAuth, c.req.param('id'), false))

  app.get('/api/admin/diagnostics', async (c) => {
    const access = await authorize(c.req.raw, c.env, resolveAuth, true)
    if (access instanceof Response) return access
    const tools = createActionTools(c.env, access.auth.userId, c.env.APP_OWNER_JWT)
    const [resources, actions, policies, logs, retention, users] = await Promise.all([
      tools.query('resources', { orderBy: 'lastQueryAt', orderDir: 'desc', limit: 100 }), tools.query<DiagnosticAction>('actions', { orderBy: 'createdAt', orderDir: 'desc', limit: 1 }),
      tools.query<Policy>('policies', { limit: 100 }), tools.query('operations-log', { orderBy: 'timestamp', orderDir: 'desc', limit: 10 }),
      tools.query('retention-status', { limit: 20 }), tools.query('users', { limit: 100 }),
    ])
    const claims = access.auth.claims
    const provider = String(claims.provider ?? claims.idp ?? claims.azp ?? claims.iss ?? 'Unknown')
    const fleet = resources.success ? resources.data.records.filter((row) => /^avmos-node-\d{2}$/.test(row.recordId)) : []
    const lastAction = actions.success ? actions.data.records[0]?.data : undefined
    const lastPoll = logs.success ? logs.data.records.find((row) => row.data.task === 'poll-infrastructure')?.data : undefined
    const cleanupRows = retention.success ? retention.data.records : []
    const lastCleanup = cleanupRows.map((row) => row.data.lastRunAt).filter((value): value is string => typeof value === 'string').sort().at(-1) ?? null
    return c.json({
      identity: { userId: access.auth.userId, displayName: claims.name ?? null, email: claims.email ?? null, provider, providerSubjectId: claims.sub, workspace: c.env.APP_NAME, role: access.membership.role, roleSource: access.auth.userId === c.env.OWNER_USER_ID ? 'Workspace ownership' : 'Workspace membership', authenticatedSince: claims.iat ? new Date(claims.iat * 1000).toISOString() : null },
      application: { version: '0.0.1', environment: c.env.DEEPSPACE_APP_ID, build: 'HEALTHY' },
      auth: { status: 'AUTHENTICATED', role: access.membership.role, workspace: c.env.APP_NAME, provider },
      telemetry: { status: fleet.some((row) => row.data.telemetryStatus === 'LIVE') ? 'LIVE' : fleet.some((row) => row.data.telemetryStatus === 'ERROR') ? 'ERROR' : 'DEGRADED', fleetSize: fleet.length, lastPoll: lastPoll?.timestamp ?? null, lastPollStatus: lastPoll?.status ?? 'NOT_RUN', lastObservation: fleet.map((row) => row.data.lastObservedAt).filter(Boolean).sort().at(-1) ?? null },
      agent: { status: lastAction?.executionStatus ?? 'IDLE', lastEvaluation: lastAction ?? null, lastEvaluationAt: lastAction?.createdAt ?? null, lastDecision: lastAction?.policyDecision?.decision ?? null, lastError: lastAction?.execution?.error ?? null },
      policy: { active: policies.success ? policies.data.records.filter((row) => row.data.enabled).length : 0, lastResolution: lastAction?.policyDecision?.decision ?? null, lastDenialReason: lastAction?.policyDecision?.decision === 'DENIED' ? lastAction.policyDecision.reason : null },
      execution: { provider: lastAction?.providerId ?? 'xrpl-testnet', mode: c.env.XRPL_EXECUTION_MODE === 'live' ? 'TESTNET' : 'SIMULATED', lastState: lastAction?.executionStatus ?? null, lastReconciliation: lastAction?.executionStatus === 'RECONCILIATION_REQUIRED' ? lastAction.createdAt : null },
      database: { status: cleanupRows.some((row) => row.data.status === 'ERROR') ? 'ERROR' : cleanupRows.some((row) => row.data.status === 'BACKLOG') ? 'BACKLOG' : 'HEALTHY', backlog: cleanupRows.filter((row) => row.data.status === 'BACKLOG').length, lastCleanup, retention: cleanupRows.map((row) => row.data) },
      team: users.success ? users.data.records.map((row) => ({ userId: row.recordId, name: row.data.name, email: row.data.email, role: row.data.role })) : [],
    })
  })
}

async function authorize(req: Request, env: Env, resolveAuth: ResolveAuth, admin: boolean) {
  const auth = await resolveAuth(req, env)
  if (!auth) return apiError('AUTH_REQUIRED', 'Authentication is required.', 401)
  const membership = await resolveAppMembership(env, auth.userId)
  if (!membership?.member) return apiError('FORBIDDEN', 'Workspace membership is required.', 403)
  if (admin && membership.role !== 'admin') return apiError('FORBIDDEN', 'Administrator access is required.', 403)
  return { auth, membership }
}

async function mutatePolicy(req: Request, env: Env, resolveAuth: ResolveAuth, id?: string): Promise<Response> {
  const access = await authorize(req, env, resolveAuth, true)
  if (access instanceof Response) return access
  const parsed = policyInput.safeParse(await safeJson(req))
  if (!parsed.success) return apiError('VALIDATION_ERROR', 'Invalid policy fields.', 400)
  const tools = createActionTools(env, access.auth.userId, env.APP_OWNER_JWT)
  const resources = await tools.query('resources', { limit: 500 })
  const known = new Set(resources.success ? resources.data.records.map((row) => row.recordId) : [])
  if (parsed.data.allowedResources.some((resource) => !known.has(resource))) return apiError('UNKNOWN_RESOURCE', 'Policy references an unknown AVMOS resource.', 400)
  const existing = id ? await tools.get<Policy & { name?: string; createdAt?: string; createdBy?: string }>('policies', id) : null
  if (id && !existing?.success) return apiError('NOT_FOUND', 'Policy not found.', 404)
  const now = new Date().toISOString(); const nextId = id ?? `policy-${slug(parsed.data.name)}-${crypto.randomUUID().slice(0, 8)}`
  const before = existing?.success ? existing.data.record.data : undefined
  const version = before ? incrementVersion(before.version) : 'P-001'
  const policy = policySchema.parse({ id: nextId, version, ...parsed.data, authorizationScopes: ['infrastructure:purchase'], updatedAt: now })
  const stored = { ...policy, name: parsed.data.name, createdAt: before?.createdAt ?? now, createdBy: before?.createdBy ?? access.auth.userId, updatedBy: access.auth.userId }
  const result = await tools.create('policies', stored, nextId)
  if (!result.success) return apiError('STORE_ERROR', 'Policy could not be saved.', 503)
  await audit(tools, env, access.auth.userId, before ? 'POLICY_UPDATED' : 'POLICY_CREATED', nextId, { policyId: nextId, before: before ?? null, after: stored })
  return Response.json({ success: true, policy: stored })
}

async function togglePolicy(req: Request, env: Env, resolveAuth: ResolveAuth, id: string, enabled: boolean): Promise<Response> {
  const access = await authorize(req, env, resolveAuth, true)
  if (access instanceof Response) return access
  const tools = createActionTools(env, access.auth.userId, env.APP_OWNER_JWT); const existing = await tools.get<Policy & { name?: string }>('policies', id)
  if (!existing.success) return apiError('NOT_FOUND', 'Policy not found.', 404)
  const before = existing.data.record.data; const after = { ...before, enabled, version: incrementVersion(before.version), updatedAt: new Date().toISOString(), updatedBy: access.auth.userId }
  const result = await tools.create('policies', after, id); if (!result.success) return apiError('STORE_ERROR', 'Policy could not be updated.', 503)
  await audit(tools, env, access.auth.userId, enabled ? 'POLICY_ENABLED' : 'POLICY_DISABLED', id, { policyId: id, before, after })
  return Response.json({ success: true, policy: after })
}

async function audit(tools: ActionTools, env: Env, actor: string, eventType: AuditEventType, actionId: string, details: Record<string, unknown>) {
  const now = new Date(); await tools.create('audit-events', { timestamp: now.toISOString(), actor, eventType, actionId, resourceId: 'system', details, ...expiry(retentionDays(env).audit, now) }, `audit-${crypto.randomUUID()}`)
}

async function testProvider(id: ProviderId, env: Env, values: Record<string, string | number | boolean>, secrets: Record<string, string>) {
  if (id === 'xrpl') return { status: env.XRPL_EXECUTION_MODE === 'live' ? 'VERIFIED' : 'SIMULATED', message: env.XRPL_EXECUTION_MODE === 'live' ? 'XRPL configuration is ready for Testnet verification.' : 'XRPL remains in simulated mode.' }
  if (id === 'newrelic') {
    const key = secrets.userKey ?? env.NEW_RELIC_USER_KEY; const account = Number(values.accountId ?? env.NEW_RELIC_ACCOUNT_ID)
    if (!key || !Number.isSafeInteger(account)) throw new Error('New Relic credentials are incomplete.')
    const region = String(values.region ?? env.NEW_RELIC_REGION ?? 'US'); const endpoint = region === 'EU' ? 'https://api.eu.newrelic.com/graphql' : region === 'JP' ? 'https://api.jp.newrelic.com/graphql' : 'https://api.newrelic.com/graphql'
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'API-Key': key }, body: JSON.stringify({ query: `{ actor { account(id: ${account}) { name } } }` }), signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`New Relic connection failed (${response.status}).`)
    return { status: 'VERIFIED', message: 'New Relic connection verified.' }
  }
  if (id === 'grok') {
    const key = secrets.apiKey ?? env.GROK_API_KEY; if (!key) throw new Error('Grok API key is not configured.')
    const base = String(values.baseUrl ?? env.GROK_BASE_URL ?? 'https://api.x.ai/v1').replace(/\/$/, ''); const response = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`Grok connection failed (${response.status}).`); return { status: 'VERIFIED', message: 'Grok connection verified.' }
  }
  if (id === 'tavily') {
    const key = secrets.apiKey ?? env.TAVILY_API_KEY; if (!key) throw new Error('Tavily API key is not configured.')
    const response = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: key, query: 'AVMOS connectivity test', max_results: 1 }), signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`Tavily connection failed (${response.status}).`); return { status: 'VERIFIED', message: 'Tavily connection verified.' }
  }
  throw new Error('Provider adapter is not implemented.')
}

async function safeJson(req: Request) { try { return await req.json() } catch { return null } }
function apiError(code: string, message: string, status: number) { return Response.json({ error: { code, message } }, { status }) }
function slug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'policy' }
function incrementVersion(value: string) { const match = /^(.*?)(\d+)$/.exec(value); return match ? `${match[1]}${String(Number(match[2]) + 1).padStart(match[2].length, '0')}` : `${value}-2` }
