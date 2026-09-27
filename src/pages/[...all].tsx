import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center text-center px-4">
      <Link to="/" aria-label="AVMOS home" className="absolute left-4 top-4 w-36 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"><img src="/avmos-logo.png" alt="AVMOS" className="w-full" /></Link>
      <h1 className="text-4xl font-bold text-foreground mb-2">404</h1>
      <p className="text-muted-foreground mb-6">Page not found</p>
      <Link
        to="/"
        className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
      >
        Go home
      </Link>
    </div>
  )
}
