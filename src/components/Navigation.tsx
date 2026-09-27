import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { signOut, useAuthUser } from 'deepspace'
import { ChevronDown, LogOut, Menu, X } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui'
const consoleLinks = [['/dashboard', 'Overview'], ['/resources', 'Resources'], ['/alerts', 'Alerts'], ['/activity', 'Activity'], ['/integrations', 'Integrations'], ['/policies', 'Policies'], ['/settings', 'Settings']] as const
export default function Navigation() {
  const { isLoaded, isSignedIn, user } = useAuthUser(); const location = useLocation(); const [open, setOpen] = useState(false)
  const inConsole = !['/', '/sign-in', '/home'].includes(location.pathname)
  useEffect(() => setOpen(false), [location.pathname])
  const links: ReadonlyArray<readonly [string, string]> = inConsole && isSignedIn ? consoleLinks : [[isSignedIn ? '/dashboard' : '/sign-in?next=/dashboard', 'Console'], ...(isSignedIn ? [['/settings', 'Settings'] as const] : [])]
  return <nav data-testid="app-navigation" className="avmos-nav"><div className="avmos-nav-inner">
    <Link to="/" aria-label="AVMOS home" className="avmos-brand"><span><img src="/avmos-logo.png" alt="AVMOS" /></span></Link>
    <div className="avmos-nav-links">{links.map(([path, label]) => <Link key={path} to={path} className={location.pathname === path ? 'active' : ''}>{label}</Link>)}</div><div className="avmos-nav-spacer" />
    {isLoaded && isSignedIn && user ? <DropdownMenu><DropdownMenuTrigger render={<button aria-label="Account menu" className="avmos-account"><Avatar className="h-7 w-7"><AvatarImage src={user.imageUrl ?? undefined}/><AvatarFallback>{(user.fullName?.[0] ?? user.primaryEmailAddress?.emailAddress?.[0] ?? '?').toUpperCase()}</AvatarFallback></Avatar><span data-testid="nav-user-name">{user.fullName || user.primaryEmailAddress?.emailAddress}</span><ChevronDown size={14}/></button>}/><DropdownMenuContent align="end"><DropdownMenuLabel><span data-testid="nav-user-email">{user.primaryEmailAddress?.emailAddress}</span></DropdownMenuLabel><DropdownMenuSeparator/><DropdownMenuItem onClick={() => signOut()}><LogOut/>Sign out</DropdownMenuItem></DropdownMenuContent></DropdownMenu> : null}
    <button className="avmos-menu" aria-label="Toggle menu" onClick={() => setOpen(!open)}>{open ? <X/> : <Menu/>}</button>
  </div>{open && <div className="avmos-mobile-links">{links.map(([path,label]) => <Link key={path} to={path}>{label}</Link>)}</div>}</nav>
}
