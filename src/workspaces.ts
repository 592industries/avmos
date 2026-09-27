import type { ActionTools } from 'deepspace/worker'

export type WorkspaceRole = 'member' | 'admin'
export type WorkspaceAccess = {
  workspaceId: string
  role: WorkspaceRole
}

type MembershipData = {
  teamId: string
  userId: string
  status: string
  role: string
}

export async function listWorkspaceAccess(
  tools: ActionTools,
  userId: string,
): Promise<WorkspaceAccess[]> {
  const result = await tools.query<MembershipData>('team_members', {
    where: { userId, status: 'active' },
    limit: 100,
  })
  if (!result.success) throw new Error(result.error)
  return result.data.records.flatMap((row) =>
    row.data.role === 'admin' || row.data.role === 'member'
      ? [{ workspaceId: row.data.teamId, role: row.data.role }]
      : [],
  )
}

export async function requireWorkspaceAccess(
  tools: ActionTools,
  userId: string,
  workspaceId: string | undefined,
  requireAdmin = false,
): Promise<WorkspaceAccess> {
  const memberships = await listWorkspaceAccess(tools, userId)
  const selected = workspaceId
    ? memberships.find((item) => item.workspaceId === workspaceId)
    : memberships[0]
  if (!selected) throw new WorkspaceAccessError('Workspace membership is required.', 403)
  if (requireAdmin && selected.role !== 'admin') {
    throw new WorkspaceAccessError('Workspace administrator access is required.', 403)
  }
  return selected
}

export async function createWorkspace(
  tools: ActionTools,
  userId: string,
  name: string,
  requestedId?: string,
): Promise<WorkspaceAccess> {
  const now = new Date().toISOString()
  const workspaceId = requestedId ?? `workspace-${crypto.randomUUID()}`
  const cleanName = name.trim().slice(0, 100)
  if (cleanName.length < 2) throw new WorkspaceAccessError('Workspace name is invalid.', 400)
  const workspace = await tools.create('workspaces', {
    name: cleanName,
    slug: slug(cleanName),
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  }, workspaceId)
  if (!workspace.success) throw new Error(workspace.error)
  const membership = await tools.create('team_members', {
    teamId: workspaceId,
    userId,
    status: 'active',
    role: 'admin',
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  }, membershipId(workspaceId, userId))
  if (!membership.success) throw new Error(membership.error)
  return { workspaceId, role: 'admin' }
}

export async function ensureOwnerWorkspace(
  tools: ActionTools,
  ownerUserId: string,
): Promise<WorkspaceAccess> {
  const existing = await listWorkspaceAccess(tools, ownerUserId)
  if (existing.length) return existing[0]
  return createWorkspace(tools, ownerUserId, 'AVMOS', 'workspace-default')
}

export function workspaceIdFromRequest(request: Request): string | undefined {
  const value = request.headers.get('X-Workspace-Id')?.trim()
  return value && /^workspace-[a-zA-Z0-9-]{1,100}$/.test(value) ? value : undefined
}

export class WorkspaceAccessError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

function membershipId(workspaceId: string, userId: string): string {
  return `membership:${workspaceId}:${userId}`
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'workspace'
}
