import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import { DeepSpaceAuthProvider } from 'deepspace'
import Navigation from '../../components/Navigation'
export default function AppLayout() { return <DeepSpaceAuthProvider><div className="min-h-screen bg-background text-foreground"><Navigation/><Suspense fallback={<main className="avmos-loading">Loading AVMOS…</main>}><Outlet/></Suspense></div></DeepSpaceAuthProvider> }
