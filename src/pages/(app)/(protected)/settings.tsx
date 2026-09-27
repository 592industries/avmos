/**
 * Example gated page. Reached at /settings — no auth logic lives here
 * because (protected)/_layout.tsx already wraps the subtree in <AuthGate>.
 */

import { useEffect, useState } from 'react'
import { getAuthToken, signOut, useUser } from 'deepspace'
import { Button } from '@/components/ui'

export default function SettingsPage() {
  const { user } = useUser()
  const [health, setHealth] = useState<{ status: string; services: Record<string, boolean>; modes: { autonomous: boolean; demo: boolean; settlement: string } } | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      const token = await getAuthToken()
      if (!token) return
      const response = await fetch('/api/health', { headers: { Authorization: `Bearer ${token}` } })
      if (response.ok && active) setHealth(await response.json())
    })()
    return () => { active = false }
  }, [])

  return (
    // No background on page wrappers — pages render into whatever the app's
    // (app)/_layout provides (a plain background, or a raised panel), so they
    // stay transparent and inherit it.
    <div className="min-h-full text-foreground">
      <div className="mx-auto max-w-2xl px-6 py-20">
        <h1 className="mb-12 text-4xl font-bold tracking-tight">AVMOS settings</h1>

        <section className="mb-6 rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-lg font-semibold">Service configuration</h2>
          {health ? <dl className="space-y-3 text-sm">
            <div className="flex justify-between"><dt>Readiness</dt><dd>{health.status}</dd></div>
            {Object.entries(health.services).map(([name, configured]) => <div key={name} className="flex justify-between"><dt>{name}</dt><dd>{configured ? 'CONFIGURED' : 'MISSING'}</dd></div>)}
            <div className="flex justify-between"><dt>Autonomous runs</dt><dd>{health.modes.autonomous ? 'ENABLED' : 'DISABLED'}</dd></div>
            <div className="flex justify-between"><dt>Demo mode</dt><dd>{health.modes.demo ? 'ENABLED' : 'DISABLED'}</dd></div>
            <div className="flex justify-between"><dt>Settlement</dt><dd>{health.modes.settlement}</dd></div>
          </dl> : <p className="text-sm text-muted-foreground">Configuration status unavailable.</p>}
          <p className="mt-5 text-xs text-muted-foreground">Secrets are configured through DeepSpace and are never displayed here.</p>
        </section>

        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-lg font-semibold">Your account</h2>

          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Name</dt>
              <dd className="text-foreground">{user?.name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="text-foreground">{user?.email ?? '—'}</dd>
            </div>
          </dl>

          <Button variant="secondary" className="mt-6" onClick={() => signOut()}>
            Sign out
          </Button>
        </section>
      </div>
    </div>
  )
}
