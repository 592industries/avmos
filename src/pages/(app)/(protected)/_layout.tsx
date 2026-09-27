import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { AuthGate, RecordProvider, RecordScope } from 'deepspace'
import { useToast } from '@/components/ui'
import { SCOPE_ID } from '../../../constants'
import { schemas } from '../../../schemas'
import { ConsoleRefreshProvider } from '../../../components/console-refresh'
import { WorkspaceProvider } from '../../../workspace-context'
export default function ProtectedLayout() { const location = useLocation(); const { error, warning } = useToast(); const next = encodeURIComponent(location.pathname + location.search); return <AuthGate fallback={<Navigate to={`/sign-in?next=${next}`} replace/>}><WorkspaceProvider><RecordProvider onWriteError={(e) => e.kind === 'permission' ? warning(e.title, e.detail) : error(e.title, e.detail)}><RecordScope roomId={SCOPE_ID} schemas={schemas}><ConsoleRefreshProvider><Outlet/></ConsoleRefreshProvider></RecordScope></RecordProvider></WorkspaceProvider></AuthGate> }
