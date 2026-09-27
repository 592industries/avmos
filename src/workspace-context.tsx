import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getAuthToken } from 'deepspace'

export type WorkspaceSummary = {
  id: string
  name: string
  slug: string
  role: 'member' | 'admin'
  createdAt?: string | null
}

type WorkspaceContextValue = {
  workspaceId: string
  workspace?: WorkspaceSummary
  workspaces: WorkspaceSummary[]
  selectWorkspace: (workspaceId: string) => void
  createWorkspace: (name: string) => Promise<void>
  headers: () => Promise<Record<string, string>>
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [loading, setLoading] = useState(true)

  async function authenticatedHeaders(): Promise<Record<string, string>> {
    const token = await getAuthToken()
    if (!token) throw new Error('Authentication is required.')
    return { Authorization: `Bearer ${token}` }
  }

  async function load(): Promise<void> {
    const headers = await authenticatedHeaders()
    let response = await fetch('/api/avmos/workspaces', { headers })
    if (!response.ok) throw new Error('Workspaces could not be loaded.')
    let rows = (await response.json() as { workspaces: WorkspaceSummary[] }).workspaces
    if (!rows.length) {
      response = await fetch('/api/avmos/workspaces', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Workspace' }),
      })
      if (!response.ok) throw new Error('Your first workspace could not be created.')
      const created = await response.json() as { workspace: { workspaceId: string } }
      response = await fetch('/api/avmos/workspaces', { headers })
      rows = (await response.json() as { workspaces: WorkspaceSummary[] }).workspaces
      setWorkspaceId(created.workspace.workspaceId)
    }
    setWorkspaces(rows)
    setWorkspaceId((current) => {
      if (rows.some((row) => row.id === current)) return current
      const remembered = localStorage.getItem('avmos.workspaceId')
      return rows.find((row) => row.id === remembered)?.id ?? rows[0]?.id ?? ''
    })
  }

  useEffect(() => {
    let active = true
    void load().catch(() => undefined).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (workspaceId) localStorage.setItem('avmos.workspaceId', workspaceId)
  }, [workspaceId])

  async function create(name: string): Promise<void> {
    const auth = await authenticatedHeaders()
    const response = await fetch('/api/avmos/workspaces', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!response.ok) throw new Error('Workspace could not be created.')
    const result = await response.json() as { workspace: { workspaceId: string } }
    await load()
    setWorkspaceId(result.workspace.workspaceId)
  }

  const value = useMemo<WorkspaceContextValue>(() => ({
    workspaceId,
    workspace: workspaces.find((item) => item.id === workspaceId),
    workspaces,
    selectWorkspace: setWorkspaceId,
    createWorkspace: create,
    headers: async () => ({ ...(await authenticatedHeaders()), 'X-Workspace-Id': workspaceId }),
  }), [workspaceId, workspaces])

  if (loading) return <main className="console-page"><p>Loading workspace…</p></main>
  if (!workspaceId) return <main className="console-page"><p>Workspace setup is unavailable.</p></main>
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider.')
  return value
}
