import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { AuthOverlay, useAuthStatus } from 'deepspace'
import { Button } from '@/components/ui'
const allowed = ['/dashboard','/resources','/alerts','/activity','/integrations','/policies','/settings']
export default function SignInPage() { const { isLoaded, isSignedIn } = useAuthStatus(); const [params] = useSearchParams(); const [open,setOpen] = useState(false); const requested = params.get('next') ?? '/dashboard'; const next = allowed.some((path) => requested === path || requested.startsWith(`${path}/`)) ? requested : '/dashboard'; useEffect(() => { if (isLoaded && !isSignedIn) setOpen(true) }, [isLoaded,isSignedIn]); if (isLoaded && isSignedIn) return <Navigate to={next} replace/>; return <main className="signin-page"><section><p className="landing-section-label">AVMOS CONSOLE</p><h1>Sign in to continue</h1><p>Operational telemetry, policies, execution state, and audit records are available only to authenticated AVMOS members.</p><Button onClick={() => setOpen(true)}>Sign in</Button></section>{open && <AuthOverlay onClose={() => setOpen(false)}/>}</main> }
