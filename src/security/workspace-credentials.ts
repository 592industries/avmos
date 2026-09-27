const PREFIX = 'avmos:workspace-credential:'
const APP_DERIVED_PREFIX = 'avmos-workspace-credential-v1:'

type StoredCredential = {
  version: 1
  iv: string
  ciphertext: string
  updatedAt: string
}

/** Prefer an explicit secret; otherwise derive a stable app-scoped root from DEEPSPACE_APP_ID. */
export function resolveWorkspaceCredentialKey(env: {
  WORKSPACE_CREDENTIAL_KEY?: string
  DEEPSPACE_APP_ID: string
}): string {
  const configured = env.WORKSPACE_CREDENTIAL_KEY?.trim()
  if (configured && configured.length >= 24) return configured
  const derived = `${APP_DERIVED_PREFIX}${env.DEEPSPACE_APP_ID}`
  if (derived.length < 24) throw new Error('Workspace credential encryption is not configured.')
  return derived
}

export async function storeWorkspaceCredential(
  storage: DurableObjectStorage,
  encryptionSecret: string,
  workspaceId: string,
  providerId: string,
  secrets: Record<string, string>,
): Promise<void> {
  validateScope(workspaceId, providerId)
  const entries = Object.entries(secrets).filter(([, value]) => value.length > 0)
  if (!entries.length) return
  const prior = await readWorkspaceCredential(storage, encryptionSecret, workspaceId, providerId)
  const plaintext = new TextEncoder().encode(JSON.stringify({ ...prior, ...Object.fromEntries(entries) }))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(encryptionSecret)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  await storage.put<StoredCredential>(keyName(workspaceId, providerId), {
    version: 1,
    iv: encode(iv),
    ciphertext: encode(new Uint8Array(ciphertext)),
    updatedAt: new Date().toISOString(),
  })
}

export async function readWorkspaceCredential(
  storage: DurableObjectStorage,
  encryptionSecret: string,
  workspaceId: string,
  providerId: string,
): Promise<Record<string, string> | null> {
  validateScope(workspaceId, providerId)
  const stored = await storage.get<StoredCredential>(keyName(workspaceId, providerId))
  if (!stored) return null
  const key = await deriveKey(encryptionSecret)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(decode(stored.iv)) },
    key,
    toArrayBuffer(decode(stored.ciphertext)),
  )
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Stored workspace credential is invalid.')
  }
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

export async function deleteWorkspaceCredential(
  storage: DurableObjectStorage,
  workspaceId: string,
  providerId: string,
): Promise<void> {
  validateScope(workspaceId, providerId)
  await storage.delete(keyName(workspaceId, providerId))
}

function keyName(workspaceId: string, providerId: string): string {
  return `${PREFIX}${workspaceId}:${providerId}`
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 24) throw new Error('Workspace credential encryption is not configured.')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

function validateScope(workspaceId: string, providerId: string): void {
  if (!/^workspace-[a-zA-Z0-9-]{1,100}$/.test(workspaceId)) throw new Error('Invalid workspace credential scope.')
  if (!/^[a-z0-9_-]{2,40}$/.test(providerId)) throw new Error('Invalid provider credential scope.')
}

function encode(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decode(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
}
