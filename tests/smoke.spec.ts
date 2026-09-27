import { test, expect } from '@playwright/test'
import { captureConsoleErrors } from './helpers/errors'

test.describe('AVMOS routing and signed-out shell', () => {
  test('root loads the mission-control dashboard without console errors', async ({ page }) => {
    const errors = captureConsoleErrors(page)
    await page.goto('/')
    await expect(page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: /AVMOS/ })).toBeVisible()
    await expect(page.getByText('TARGET / SOURCE')).toBeVisible()
    await expect(page.getByText('STORAGE / THRESHOLD')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('logo returns home and old /home URL redirects', async ({ page }) => {
    await page.goto('/home')
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('link', { name: 'AVMOS home' })).toHaveAttribute('href', '/')
    await expect(page.getByRole('link', { name: 'AVMOS home' }).locator('img')).toHaveAttribute('src', '/avmos-logo.png')
  })

  test('signed-out user has a sign-in action', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('nav-sign-in-button')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('nav-user-name')).toHaveCount(0)
  })

  test('unknown route shows 404 with a home link', async ({ page }) => {
    await page.goto('/nonexistent-page-xyz')
    await expect(page.locator('text=404')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/')
  })
})
