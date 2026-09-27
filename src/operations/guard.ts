/** The RecordRoom's private endpoint serializes these decisions in one Durable Object. */
export type ReserveRequest = {
  operationId: string
  idempotencyKey: string
  requestHash: string
  fingerprint: string
  amount: number
  dailyBudget: number
  currency: 'RLUSD'
}

type Reservation = ReserveRequest & {
  day: string
  state: 'RESERVED' | 'EXECUTING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'
  createdAt: number
  expiresAt: number | null
}

export type ReserveResult =
  | { allowed: true; operationId: string }
  | { allowed: false; code: 'REPLAY' | 'IDEMPOTENCY_CONFLICT' | 'DUPLICATE_OPERATION' | 'BUDGET_EXCEEDED'; operationId?: string }

const PREFIX = 'avmos:reservation:'
const KEY_PREFIX = 'avmos:idempotency:'
const DAY_MS = 86_400_000
const POLL_LEASE_KEY = 'avmos:telemetry-poll-lease'

export async function acquirePollLease(storage: DurableObjectStorage, token: string, now = Date.now()): Promise<boolean> {
  if (!token) throw new Error('Poll token required.')
  return storage.transaction(async (tx) => {
    const current = await tx.get<{ token: string; expiresAt: number; nextAt: number }>(POLL_LEASE_KEY)
    if (current && (current.expiresAt > now || current.nextAt > now)) return false
    await tx.put(POLL_LEASE_KEY, { token, expiresAt: now + 90_000, nextAt: now + 60_000 })
    return true
  })
}

export async function releasePollLease(storage: DurableObjectStorage, token: string, now = Date.now()): Promise<void> {
  await storage.transaction(async (tx) => {
    const current = await tx.get<{ token: string; expiresAt: number; nextAt: number }>(POLL_LEASE_KEY)
    if (current?.token === token) await tx.put(POLL_LEASE_KEY, { ...current, expiresAt: now })
  })
}

export async function operationRequestHash(resourceId: string, requestTag: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ resourceId, requestTag }))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function lookupOperation(storage: DurableObjectStorage, idempotencyKey: string, requestHash: string): Promise<{ code: 'NEW' | 'REPLAY' | 'IDEMPOTENCY_CONFLICT'; operationId?: string }> {
  const existing = await storage.get<{ operationId: string; requestHash: string }>(KEY_PREFIX + idempotencyKey)
  if (!existing) return { code: 'NEW' }
  return existing.requestHash === requestHash
    ? { code: 'REPLAY', operationId: existing.operationId }
    : { code: 'IDEMPOTENCY_CONFLICT' }
}

export async function allowRequest(storage: DurableObjectStorage, key: string, limit: number, now = Date.now()): Promise<boolean> {
  return storage.transaction(async (tx) => {
    const storageKey = `avmos:rate:${key}:${Math.floor(now / 60_000)}`
    const count = await tx.get<number>(storageKey) ?? 0
    if (count >= limit) return false
    await tx.put(storageKey, count + 1)
    return true
  })
}

export async function reserveOperation(storage: DurableObjectStorage, request: ReserveRequest, now = Date.now()): Promise<ReserveResult> {
  if (!request.operationId || !request.idempotencyKey || !request.fingerprint || !request.requestHash || !Number.isFinite(request.amount) || request.amount <= 0 || !Number.isFinite(request.dailyBudget) || request.dailyBudget <= 0 || request.currency !== 'RLUSD') {
    throw new Error('Invalid operation reservation.')
  }
  return storage.transaction(async (tx) => {
    const existingKey = await tx.get<{ operationId: string; requestHash: string }>(KEY_PREFIX + request.idempotencyKey)
    if (existingKey) {
      return existingKey.requestHash === request.requestHash
        ? { allowed: false, code: 'REPLAY', operationId: existingKey.operationId }
        : { allowed: false, code: 'IDEMPOTENCY_CONFLICT' }
    }
    const day = new Date(now).toISOString().slice(0, 10)
    const records = await tx.list<Reservation>({ prefix: PREFIX })
    let reservedToday = 0
    for (const reservation of records.values()) {
      if (reservation.fingerprint === request.fingerprint && (reservation.expiresAt === null || reservation.expiresAt > now) && reservation.state !== 'FAILED') {
        return { allowed: false, code: 'DUPLICATE_OPERATION', operationId: reservation.operationId }
      }
      if (reservation.day === day && reservation.state !== 'FAILED') reservedToday += reservation.amount
    }
    if (reservedToday + request.amount > request.dailyBudget) return { allowed: false, code: 'BUDGET_EXCEEDED' }
    const row: Reservation = { ...request, day, state: 'RESERVED', createdAt: now, expiresAt: now + DAY_MS }
    await tx.put(PREFIX + request.operationId, row)
    await tx.put(KEY_PREFIX + request.idempotencyKey, { operationId: request.operationId, requestHash: request.requestHash })
    return { allowed: true, operationId: request.operationId }
  })
}

export async function transitionOperation(storage: DurableObjectStorage, operationId: string, state: Reservation['state'], now = Date.now()): Promise<void> {
  await storage.transaction(async (tx) => {
    const key = PREFIX + operationId
    const row = await tx.get<Reservation>(key)
    if (!row) throw new Error('Operation reservation not found.')
    const allowed: Record<Reservation['state'], Reservation['state'][]> = {
      RESERVED: ['EXECUTING', 'FAILED'],
      EXECUTING: ['SUCCEEDED', 'FAILED', 'UNKNOWN'],
      UNKNOWN: ['SUCCEEDED', 'FAILED'],
      SUCCEEDED: [],
      FAILED: [],
    }
    if (!allowed[row.state].includes(state)) throw new Error(`Illegal execution transition: ${row.state} to ${state}.`)
    await tx.put(key, { ...row, state, expiresAt: state === 'UNKNOWN' || state === 'EXECUTING' ? null : state === 'FAILED' ? now : state === 'SUCCEEDED' ? now + DAY_MS : row.expiresAt })
  })
}
