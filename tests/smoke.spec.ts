import { test, expect } from '@playwright/test'
import { captureConsoleErrors } from './helpers/errors'

test.describe('AVMOS routing and signed-out shell', () => {
  test('root loads the public AVMOS product page without console errors', async ({ page }) => {
    const errors = captureConsoleErrors(page)
    await page.goto('/')
    await expect(page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: /Autonomous operations for critical infrastructure/i })).toBeVisible()
    await expect(page.getByText('Detection is only the beginning.')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('logo returns home and old /home URL redirects', async ({ page }) => {
    await page.goto('/home')
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('link', { name: 'AVMOS home' })).toHaveAttribute('href', '/')
    await expect(page.getByRole('link', { name: 'AVMOS home' }).locator('img')).toHaveAttribute('src', '/avmos-logo.png')
  })

  test('signed-out Console routes through sign-in and preserves dashboard target', async ({ page }) => {
    await page.goto('/')
    const console = page.getByRole('link', { name: 'Console' }).first()
    await expect(console).toHaveAttribute('href', '/sign-in?next=/dashboard')
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard/)
    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible()
  })

  test('unknown route shows 404 with a home link', async ({ page }) => {
    await page.goto('/nonexistent-page-xyz')
    await expect(page.locator('text=404')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/')
  })
})
