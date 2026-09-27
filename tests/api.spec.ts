import { test, expect } from '@playwright/test'

test.describe('API tests', () => {
  test('auth proxy forwards to auth worker', async ({ request }) => {
    const res = await request.get('/api/auth/ok')
    expect(res.ok()).toBeTruthy()
  })

  test('records WebSocket route rejects unauthenticated requests', async ({ request }) => {
    const res = await request.get('/ws/app:unauthorized')
    expect(res.status()).toBe(401)
  })

  test('public fleet status is sanitized and available without authentication', async ({ request }) => {
    const res = await request.get('/api/public/status')
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body).toEqual(expect.objectContaining({ telemetry: expect.any(String), resources: expect.any(Number) }))
    expect(JSON.stringify(body)).not.toMatch(/apiKey|token|secret|wallet|jwt/i)
  })

  for (const route of [
    '/api/policies',
    '/api/avmos/integrations/newrelic/test',
    '/api/avmos/integrations/newrelic/configure',
    '/api/avmos/integrations/newrelic/clear',
  ]) {
    test(`${route} rejects unauthenticated mutation`, async ({ request }) => {
      const res = await request.post(route, { data: {} })
      expect(res.status()).toBe(401)
    })
  }

  test('administrator diagnostics reject unauthenticated requests', async ({ request }) => {
    const res = await request.get('/api/admin/diagnostics')
    expect(res.status()).toBe(401)
  })
})
