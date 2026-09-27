/**
 * App Worker — explicit assembly for DeepSpace app routes and Durable Objects.
 *
 * Route implementations live under src/server. Keep their registration order
 * here: specific API and WebSocket handlers must precede the SPA fallback.
 */

import { Hono } from 'hono'
import {
  armCronRoom,
  CanvasRoom,
  CronRoom,
  JobRoom,
  PresenceRoom,
  RecordRoom,
  resolveAppRole,
  workerErrorHandler,
  YjsRoom,
} from 'deepspace/worker'
import type { DOBindings, DOManifest, Job, JobContext } from 'deepspace/worker'
import { AI_CHATS_SCHEMA } from 'deepspace/schema'
import { registerAgent } from './src/ai/agent.js'
import { buildTools } from './src/ai/tools.js'
import { tasks as cronTasks, runTask as runCronTask } from './src/cron.js'
import { runJob } from './src/jobs.js'
import { schemas } from './src/schemas.js'
import { registerActionRoutes } from './src/server/action-routes.js'
import {
  registerAuthAndIntegrationRoutes,
  registerPlatformProxyRoutes,
  registerStaticRoutes,
  resolveAuth,
} from './src/server/http-routes.js'
import { registerRealtimeRoutes } from './src/server/realtime-routes.js'
import { acquirePollLease, allowRequest, lookupOperation, releasePollLease, reserveOperation, transitionOperation } from './src/operations/guard.js'

// Dynamic deploy reads this manifest to create the app's DO bindings.
export const __DO_MANIFEST__ = [
  { binding: 'RECORD_ROOMS', className: 'AppRecordRoom', sqlite: true },
  { binding: 'YJS_ROOMS', className: 'AppYjsRoom', sqlite: true },
  { binding: 'CANVAS_ROOMS', className: 'AppCanvasRoom', sqlite: true },
  { binding: 'PRESENCE_ROOMS', className: 'AppPresenceRoom', sqlite: true },
  { binding: 'CRON_ROOMS', className: 'AppCronRoom', sqlite: true },
  { binding: 'JOB_ROOMS', className: 'AppJobRoom', sqlite: true },
] as const satisfies DOManifest

export class AppRecordRoom extends RecordRoom<Env> {
  constructor(private readonly operationState: DurableObjectState, env: Env) {
    super(operationState, env, schemas, { ownerUserId: env.OWNER_USER_ID })
  }

  override async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path === '/internal/avmos/reserve' && request.method === 'POST') {
      try { return Response.json(await reserveOperation(this.operationState.storage, await request.json())) }
      catch { return Response.json({ error: 'Invalid operation reservation.' }, { status: 400 }) }
    }
    if (path === '/internal/avmos/transition' && request.method === 'POST') {
      try {
        const body = await request.json() as { operationId: string; state: 'RESERVED' | 'EXECUTING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' }
        await transitionOperation(this.operationState.storage, body.operationId, body.state)
        return Response.json({ ok: true })
      } catch { return Response.json({ error: 'Invalid operation transition.' }, { status: 400 }) }
    }
    if (path === '/internal/avmos/rate' && request.method === 'POST') {
      try {
        const body = await request.json() as { key: string; limit: number }
        if (!body.key || body.key.length > 200 || !Number.isInteger(body.limit) || body.limit < 1 || body.limit > 1000) throw new Error('Invalid rate limit.')
        return Response.json({ allowed: await allowRequest(this.operationState.storage, body.key, body.limit) })
      } catch { return Response.json({ error: 'Invalid rate request.' }, { status: 400 }) }
    }
    if (path === '/internal/avmos/poll-lease' && request.method === 'POST') {
      try {
        const body = await request.json() as { token: string; action: 'acquire' | 'release' }
        if (!body.token || body.token.length > 100) throw new Error('Invalid poll token.')
        if (body.action === 'acquire') return Response.json({ acquired: await acquirePollLease(this.operationState.storage, body.token) })
        if (body.action === 'release') {
          await releasePollLease(this.operationState.storage, body.token)
          return Response.json({ released: true })
        }
        throw new Error('Invalid poll action.')
      } catch { return Response.json({ error: 'Invalid poll lease request.' }, { status: 400 }) }
    }
    if (path === '/internal/avmos/lookup' && request.method === 'POST') {
      try {
        const body = await request.json() as { idempotencyKey: string; requestHash: string }
        if (!body.idempotencyKey || !body.requestHash) throw new Error('Invalid lookup.')
        return Response.json(await lookupOperation(this.operationState.storage, body.idempotencyKey, body.requestHash))
      } catch { return Response.json({ error: 'Invalid lookup.' }, { status: 400 }) }
    }
    return super.fetch(request)
  }
}

export class AppYjsRoom extends YjsRoom<Env> {}
export class AppCanvasRoom extends CanvasRoom<Env> {}
export class AppPresenceRoom extends PresenceRoom<Env> {}

/** Runs the scheduled tasks defined in src/cron.ts. */
export class AppCronRoom extends CronRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, { tasks: cronTasks })
  }

  protected async onTask(taskName: string): Promise<void> {
    await runCronTask(taskName, this.env)
  }
}

/** Runs durable background work defined in src/jobs.ts. */
export class AppJobRoom extends JobRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, {
      authorizeWrite: async (user) => {
        if (user.userId.startsWith('anon-')) return false
        const role = await resolveAppRole(env, user.userId)
        return role === 'member' || role === 'admin'
      },
    })
  }

  protected async onJob(job: Job, context: JobContext): Promise<unknown> {
    return await runJob(job, context, this.env)
  }
}

export interface Env extends DOBindings<typeof __DO_MANIFEST__> {
  ASSETS: Fetcher
  /**
   * Platform service binding in production; deepspace dev supplies the URL
   * fallback. Standard app files use the platform's shared, app-scoped R2
   * bucket rather than a local binding.
   */
  PLATFORM_WORKER?: Fetcher
  PLATFORM_WORKER_URL?: string
  /**
   * HMAC app credential minted on first deploy. Proxy routes omit identity
   * headers when it is absent so upstream services fail closed.
   */
  APP_IDENTITY_TOKEN?: string
  /** API service binding in production with a deepspace-dev URL fallback. */
  API_WORKER?: Fetcher
  API_WORKER_URL?: string
  AUTH_JWT_PUBLIC_KEY: string
  AUTH_JWT_ISSUER: string
  AUTH_WORKER_URL: string
  APP_NAME: string
  /** Immutable record-scope and platform identity. */
  DEEPSPACE_APP_ID: string
  OWNER_USER_ID: string
  /**
   * Long-lived owner JWT used for developer-billed server calls. User-billed
   * calls always forward the signed-in caller's JWT instead.
   */
  APP_OWNER_JWT: string
  /** External service credentials are injected by the DeepSpace secrets store. */
  GROK_API_KEY?: string
  GROK_MODEL?: string
  GROK_BASE_URL?: string
  NEW_RELIC_USER_KEY?: string
  NEW_RELIC_ACCOUNT_ID?: string
  NEW_RELIC_ENTITY_GUID?: string
  NEW_RELIC_REGION?: string
  NEW_RELIC_RESOURCE_ID?: string
  DEMO_MODE?: string
  ACTIVE_POLICY_ID?: string
  TAVILY_API_KEY?: string
  XRPL_TESTNET_URL?: string
  XRPL_WALLET_SECRET?: string
  XRPL_RLUSD_ISSUER?: string
  XRPL_RLUSD_CURRENCY?: string
  XRPL_VENDOR_DESTINATION?: string
  /** Must be exactly "live"; every other value uses the explicit simulator. */
  XRPL_EXECUTION_MODE?: string
  /** Scheduled autonomous runs remain disabled unless explicitly enabled. */
  AUTONOMOUS_RUNS_ENABLED?: string
  /**
   * Enables /api/debug/* only when exactly "true". The route still requires
   * an authenticated app owner/admin. deepspace dev/test set it locally.
   */
  ALLOW_DEBUG_ROUTES?: string
}

export type AppContext = { Bindings: Env }

const app = new Hono<AppContext>()
async function rateLimitRequest(c: { env: Env; req: { header(name: string): string | undefined; path: string } }, limit: number): Promise<boolean> {
  const namespace = c.env.RECORD_ROOMS
  const stub = namespace.get(namespace.idFromName(`app:${c.env.DEEPSPACE_APP_ID}`))
  const response = await stub.fetch(new Request('https://internal/internal/avmos/rate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: `${c.req.path}:${c.req.header('CF-Connecting-IP') ?? 'unknown'}`.slice(0, 200), limit }),
  }))
  return response.ok && (await response.json() as { allowed: boolean }).allowed
}
app.use('/api/ai/*', async (c, next) => {
  if (!(await rateLimitRequest(c, 30))) return c.json({ error: { code: 'RATE_LIMITED', message: 'Too many AI requests.', requestId: crypto.randomUUID() } }, 429)
  await next()
})
app.use('/api/integrations/*', async (c, next) => {
  if (!(await rateLimitRequest(c, 60))) return c.json({ error: { code: 'RATE_LIMITED', message: 'Too many integration requests.', requestId: crypto.randomUUID() } }, 429)
  await next()
})
app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  c.header('Content-Security-Policy', "object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
})
// A Durable Object exists only once something fetches it, and the CronRoom
// arms its alarm in that first fetch — so wake it from the request path, or a
// deployed schedule waits for a visitor. Once per isolate; no-op without tasks.
app.use('*', async (c, next) => {
  armCronRoom(c.executionCtx, c.env.CRON_ROOMS, `app:${c.env.DEEPSPACE_APP_ID}`, cronTasks)
  await next()
})

// Registration order is part of the worker contract. The wildcard auth route
// follows its special cases, AI precedes platform proxies, and static is last.
registerAuthAndIntegrationRoutes(app)
registerRealtimeRoutes(app)
registerActionRoutes(app, resolveAuth)
// The in-app assistant stores chat history in `ai-chats` / `ai-messages`,
// which only the copilot overlay declares. When present, registerAgent enables
// both that website AI and the user's local Codex/Claude/etc. assistant.
if (schemas.some((schema) => schema.name === AI_CHATS_SCHEMA.name)) {
  registerAgent(app, { tools: buildTools })
}
registerPlatformProxyRoutes(app)
registerStaticRoutes(app)

// Hono registers ONE error handler (last onError wins), and its default is
// `console.error(err)` — whose message Workers Logs drops, keeping only the
// stack frames. workerErrorHandler logs the string form instead (message
// first, frames and bounded cause chain, method + path for context), keeps a
// response-bearing error's (HTTPException — auth 401s, upload 413s) own
// answer, and returns a generic 500 for the rest.
app.onError(workerErrorHandler('error'))

export default app
