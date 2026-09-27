import { describe, expect, it } from 'vitest'
import type { Env } from '../../worker'
import { expiry, hourBucket, retentionDays, safeMessage } from './retention'

describe('telemetry retention helpers', () => {
  it('uses bounded defaults and exact UTC expiration buckets', () => {
    const env = { TELEMETRY_RAW_RETENTION_DAYS: '0', RETENTION_DELETE_BATCH_SIZE: '500' } as Env
    expect(retentionDays(env).observations).toBe(7)
    expect(expiry(7, new Date('2026-09-20T12:00:00.000Z'))).toEqual({
      expiresAt: '2026-09-27T12:00:00.000Z',
      expiresOn: '2026-09-27',
    })
    expect(hourBucket('2026-09-27T12:45:22.000Z')).toBe('2026-09-27T12:00:00.000Z')
  })

  it('redacts provider secrets from operational errors', () => {
    expect(safeMessage('api_key=abc token:xyz wallet=seed')).toBe(
      'api_key=[REDACTED] token=[REDACTED] wallet=[REDACTED]',
    )
  })
})
