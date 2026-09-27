import { z } from 'zod/v4'
import type { Env } from '../../worker'

export const providerIds = ['newrelic', 'grok', 'tavily', 'xrpl', 'stripe', 'capital_one'] as const
export type ProviderId = (typeof providerIds)[number]

const publicField = z.union([z.string().trim().max(500), z.number(), z.boolean()])
export const providerConfigurationInput = z.object({
  values: z.record(z.string(), publicField).default({}),
  secrets: z.record(z.string(), z.string().min(1).max(4096)).default({}),
}).strict()

const providerValueSchemas: Record<ProviderId, z.ZodType> = {
  newrelic: z.object({ accountId: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]), region: z.enum(['US','EU','JP']), fleetPrefix: z.string().regex(/^[a-zA-Z0-9-]{2,40}$/) }).partial().strict(),
  grok: z.object({ model: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/), baseUrl: z.literal('https://api.x.ai/v1') }).partial().strict(),
  tavily: z.object({}).strict(),
  xrpl: z.object({ testnetUrl: z.literal('wss://s.altnet.rippletest.net:51233'), vendorDestination: z.string().regex(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/), executionMode: z.enum(['simulated','live']), issuer: z.string().regex(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/), currency: z.literal('RLUSD') }).partial().strict(),
  stripe: z.object({}).strict(),
  capital_one: z.object({}).strict(),
}

export function validProviderValues(id: ProviderId, values: Record<string, string | number | boolean>): boolean {
  return providerValueSchemas[id].safeParse(values).success
}

export type ProviderDefinition = {
  id: ProviderId
  displayName: string
  category: 'telemetry' | 'reasoning' | 'research' | 'settlement' | 'future'
  capabilities: string[]
  isImplemented: boolean
  requiresSecrets: string[]
  publicFields: string[]
  supportsTest: boolean
}

export const providerRegistry: ProviderDefinition[] = [
  { id: 'newrelic', displayName: 'New Relic', category: 'telemetry', capabilities: ['infrastructure-telemetry', 'fleet-discovery'], isImplemented: true, requiresSecrets: ['userKey'], publicFields: ['accountId', 'region'], supportsTest: true },
  { id: 'grok', displayName: 'xAI / Grok', category: 'reasoning', capabilities: ['constrained-reasoning'], isImplemented: true, requiresSecrets: ['apiKey'], publicFields: ['model', 'baseUrl'], supportsTest: true },
  { id: 'tavily', displayName: 'Tavily', category: 'research', capabilities: ['remediation-research'], isImplemented: true, requiresSecrets: ['apiKey'], publicFields: [], supportsTest: true },
  { id: 'xrpl', displayName: 'XRPL Testnet', category: 'settlement', capabilities: ['RLUSD', 'purchase_storage'], isImplemented: true, requiresSecrets: ['walletSecret'], publicFields: ['testnetUrl', 'vendorDestination', 'executionMode', 'issuer', 'currency'], supportsTest: true },
  { id: 'stripe', displayName: 'Stripe', category: 'future', capabilities: [], isImplemented: false, requiresSecrets: [], publicFields: [], supportsTest: false },
  { id: 'capital_one', displayName: 'Capital One', category: 'future', capabilities: [], isImplemented: false, requiresSecrets: [], publicFields: [], supportsTest: false },
]

export function providerDefinition(id: string) { return providerRegistry.find((item) => item.id === id) }

export function configuredFromEnv(id: ProviderId, env: Env): boolean {
  if (id === 'newrelic') return Boolean(env.NEW_RELIC_USER_KEY && env.NEW_RELIC_ACCOUNT_ID)
  if (id === 'grok') return Boolean(env.GROK_API_KEY)
  if (id === 'tavily') return Boolean(env.TAVILY_API_KEY)
  if (id === 'xrpl') return Boolean(env.XRPL_VENDOR_DESTINATION && (env.XRPL_EXECUTION_MODE !== 'live' || (env.XRPL_WALLET_SECRET && env.XRPL_RLUSD_ISSUER)))
  return false
}

export function safeProviderStatus(id: ProviderId, env: Env) {
  const configured = configuredFromEnv(id, env)
  return { configured, status: id === 'xrpl' && env.XRPL_EXECUTION_MODE !== 'live' ? 'SIMULATED' : configured ? 'CONFIGURED' : 'NOT_CONFIGURED' }
}
