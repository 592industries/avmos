import { describe, expect, it } from 'vitest'
import { acquirePollLease, lookupOperation, releasePollLease, reserveOperation, transitionOperation, type ReserveRequest } from './guard'

function memoryStorage(): DurableObjectStorage {
  const data = new Map<string, unknown>()
  let tail = Promise.resolve()
  const tx = {
    get: async (key: string) => data.get(key),
    put: async (key: string, value: unknown) => { data.set(key, value) },
    list: async ({ prefix }: { prefix: string }) => new Map([...data].filter(([key]) => key.startsWith(prefix))),
  }
  return {
    get: tx.get,
    transaction: async <T>(fn: (value: typeof tx) => Promise<T>) => {
      const previous = tail
      let release!: () => void
      tail = new Promise<void>((resolve) => { release = resolve })
      await previous
      try { return await fn(tx) } finally { release() }
    },
  } as unknown as DurableObjectStorage
}

function request(operationId: string, fingerprint = operationId, amount = 129): ReserveRequest {
  return { operationId, idempotencyKey: operationId, requestHash: `hash-${operationId}`, fingerprint, amount, dailyBudget: 200, currency: 'RLUSD' }
}

describe('durable operation guard', () => {
  it('serializes concurrent reservations against the same daily budget', async () => {
    const storage = memoryStorage()
    const results = await Promise.all([reserveOperation(storage, request('a')), reserveOperation(storage, request('b'))])
    expect(results.filter((result) => result.allowed)).toHaveLength(1)
    expect(results.filter((result) => !result.allowed)).toEqual([{ allowed: false, code: 'BUDGET_EXCEEDED' }])
  })

  it('blocks equivalent remediation across keys and preserves unknown state', async () => {
    const storage = memoryStorage()
    expect((await reserveOperation(storage, request('a', 'same'))).allowed).toBe(true)
    await transitionOperation(storage, 'a', 'EXECUTING')
    await transitionOperation(storage, 'a', 'UNKNOWN')
    expect(await reserveOperation(storage, request('b', 'same'), Date.now() + 86_400_000 * 2)).toEqual({ allowed: false, code: 'DUPLICATE_OPERATION', operationId: 'a' })
    await expect(transitionOperation(storage, 'a', 'EXECUTING')).rejects.toThrow('Illegal execution transition')
  })

  it('detects a changed request under one idempotency key', async () => {
    const storage = memoryStorage()
    await reserveOperation(storage, request('a'))
    expect(await lookupOperation(storage, 'a', 'hash-a')).toEqual({ code: 'REPLAY', operationId: 'a' })
    expect(await lookupOperation(storage, 'a', 'changed')).toEqual({ code: 'IDEMPOTENCY_CONFLICT' })
    expect(await reserveOperation(storage, { ...request('b'), idempotencyKey: 'a', requestHash: 'changed' })).toEqual({ allowed: false, code: 'IDEMPOTENCY_CONFLICT' })
  })

  it('allows only one shared telemetry poll per minute', async () => {
    const storage = memoryStorage()
    const now = Date.now()
    expect(await Promise.all([acquirePollLease(storage, 'a', now), acquirePollLease(storage, 'b', now)])).toEqual([true, false])
    await releasePollLease(storage, 'a', now + 1000)
    expect(await acquirePollLease(storage, 'b', now + 1000)).toBe(false)
    expect(await acquirePollLease(storage, 'b', now + 60_001)).toBe(true)
  })
})
