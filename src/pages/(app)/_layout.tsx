/**
 * Dynamic app boundary — the auth + realtime data layer.
 *
 * `(app)` is a Generouted route group: the parentheses mean it does NOT appear
 * in the URL, so (app)/index.tsx is served at /. Every page under this
 * folder is wrapped in the DeepSpace providers below, so it may call `useAuth`,
 * `useQuery`, `useMutations`, presence/Yjs hooks, etc.
 *
 * Pages OUTSIDE this folder (top level of src/pages/) get none of this. Require
 * sign-in on top of the data layer by nesting under (app)/(protected)/.
 *
 * This is where the app chrome (Navigation) lives.
 */

import { Suspense, useState, type ReactNode } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { AuthOverlay, DeepSpaceAuthProvider, useAuthStatus } from 'deepspace'
import { RecordProvider, RecordScope } from 'deepspace'
import Navigation from '../../components/Navigation'
import { useToast } from '@/components/ui'
import { SCOPE_ID } from '../../constants'
import { schemas } from '../../schemas'

export default function AppLayout() {
  return (
    <DeepSpaceAuthProvider>
      <AuthBoot>
        <div className="flex h-screen flex-col bg-background overflow-hidden">
          <Navigation />
          <main className="flex-1 overflow-y-auto min-h-0">
            <Suspense fallback={<div className="flex items-center justify-center h-full text-muted-foreground">Loading...</div>}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </AuthBoot>
    </DeepSpaceAuthProvider>
  )
}

/**
 * Waits for auth to resolve, then mounts the data layer. Distinct from the SDK's `AuthGate`.
 *
 * While the initial session check is in flight, renders a fixed full-viewport
 * panel in the theme background — visually identical to the pre-JS page
 * (index.html primes <html> with the same color), so a cold load shows a
 * steady theme-colored screen until the shell appears. No spinner text: the
 * check is one round-trip, and in-flow placeholders read as a layout jump.
 */
function AuthBoot({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuthStatus()
  const location = useLocation()
  const [showAuthModal, setShowAuthModal] = useState(false)
  // Record writes (`create`/`put`/`remove`) are fire-and-forget — they resolve
  // before the server answers, so a denied or invalid write only surfaces
  // through onWriteError. Route rejections to toasts so they're never a
  // silent no-op. Keep this wiring when customizing the layout.
  const { error, warning } = useToast()

  if (!isLoaded || !isSignedIn) {
    const pending = !isLoaded
    return <div className="min-h-screen bg-background text-foreground" aria-busy={pending || undefined}>
      <nav data-testid="app-navigation" className="flex h-16 items-center gap-4 border-b border-border px-5">
        <Link to="/" aria-label="AVMOS home" className="w-36 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"><img src="/avmos-logo.png" alt="AVMOS" className="w-full" /></Link>
        <span className="flex-1" />
        {pending ? <a data-testid="nav-sign-in-button" href="/api/auth/social-redirect?provider=google" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">Sign in</a> : <button data-testid="nav-sign-in-button" onClick={() => setShowAuthModal(true)} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">Sign in</button>}
      </nav>
      {location.pathname === '/' ? <main className="mx-auto max-w-7xl px-6 py-10" data-testid="public-dashboard">
        <p className="text-xs font-semibold tracking-[.18em] text-cyan-300">AUTONOMOUS VERIFICATION, MONITORING &amp; OPERATIONS SYSTEM</p>
        <h1 className="mt-3 text-6xl font-bold tracking-tight">AVMOS<span className="text-cyan-300">/</span></h1>
        <p className="mt-3 text-muted-foreground">{pending ? 'Connecting to the control plane…' : 'Sign in to view live infrastructure and operation records.'}</p>
        <section className="mt-8 grid gap-3 border border-border p-5 sm:grid-cols-2 lg:grid-cols-4" aria-label="AVMOS status">
          <PublicStatus label="TARGET / SOURCE" value="avmos / NEW RELIC" />
          <PublicStatus label="STORAGE / THRESHOLD" value="NO CURRENT DATA / 80%" />
          <PublicStatus label="TREND" value="HISTORICAL TELEMETRY UNAVAILABLE" />
          <PublicStatus label="AGENT / AUTHORIZATION" value="OBSERVE / SIGN IN REQUIRED" />
        </section>
        <p className="mt-6 text-sm text-muted-foreground">XRPL settlement stays simulated by default. No operation runs from this public view.</p>
      </main> : <main className="mx-auto max-w-xl px-6 py-20 text-center"><h1 className="text-2xl font-semibold">Sign in to continue</h1><p className="mt-2 text-sm text-muted-foreground">This page requires an authenticated AVMOS session.</p><Link to="/" className="mt-5 inline-block text-sm underline">Back to home</Link></main>}
      {showAuthModal && <AuthOverlay onClose={() => setShowAuthModal(false)} />}
    </div>
  }

  return (
    <RecordProvider
      onWriteError={(e) =>
        e.kind === 'permission' ? warning(e.title, e.detail) : error(e.title, e.detail)
      }
    >
      <RecordScope roomId={SCOPE_ID} schemas={schemas}>
        {children}
      </RecordScope>
    </RecordProvider>
  )
}

function PublicStatus({ label, value }: { label: string; value: string }) {
  return <div className="min-h-20 border-b border-border py-3 sm:border-b-0 sm:border-r sm:px-3"><span className="block text-[10px] font-semibold tracking-widest text-muted-foreground">{label}</span><strong className="mt-2 block text-sm">{value}</strong></div>
}
