import type { Env } from '../../worker'

export async function writeCredential(
  env: Env,
  workspaceId: string,
  providerId: string,
  secrets: Record<string, string>,
): Promise<void> {
  const response = await request(env, { action: 'store', workspaceId, providerId, secrets })
  if (!response.ok) throw new Error('Secure credential storage is unavailable.')
}

export async function readCredential(
  env: Env,
  workspaceId: string,
  providerId: string,
): Promise<Record<string, string> | null> {
  const response = await request(env, { action: 'read', workspaceId, providerId })
  if (!response.ok) throw new Error('Secure credential storage is unavailable.')
  return (await response.json() as { secrets?: Record<string, string> | null }).secrets ?? null
}

export async function removeCredential(
  env: Env,
  workspaceId: string,
  providerId: string,
): Promise<void> {
  const response = await request(env, { action: 'delete', workspaceId, providerId })
  if (!response.ok) throw new Error('Secure credential storage is unavailable.')
}

function request(env: Env, body: Record<string, unknown>): Promise<Response> {
  const namespace = env.RECORD_ROOMS
  const stub = namespace.get(namespace.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
  return stub.fetch(new Request('https://internal/internal/avmos/credential', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}
