import { Navigate } from 'react-router-dom'

/** Keep old bookmarks working without mounting a second dashboard. */
export default function LegacyHome() {
  return <Navigate to="/" replace />
}
