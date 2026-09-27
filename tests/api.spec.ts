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

  test('tenant fleet status is not exposed publicly', async ({ request }) => {
    const res = await request.get('/api/public/status')
    expect(res.status()).toBe(404)
  })

  test('workspace and resource mutations reject anonymous callers', async ({ request }) => {
    expect((await request.get('/api/avmos/workspaces')).status()).toBe(401)
    expect((await request.post('/api/avmos/workspaces', { data: { name: 'Other' } })).status()).toBe(401)
    expect((await request.post('/api/avmos/resources/resource-web-01/controls', { data: { monitoringEnabled: true } })).status()).toBe(401)
    expect((await request.post('/api/actions/runAgentCycle', { data: { workspaceId: 'workspace-a', resourceId: 'resource-web-01' } })).status()).toBe(401)
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
