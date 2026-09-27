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
})
