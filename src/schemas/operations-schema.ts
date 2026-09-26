import type { CollectionSchema } from 'deepspace/schema'

const readOnlyPermissions: CollectionSchema['permissions'] = {
  viewer: { read: true, create: false, update: false, delete: false },
  member: { read: true, create: false, update: false, delete: false },
  admin: { read: true, create: false, update: false, delete: false },
}

export const agentsSchema: CollectionSchema = {
  name: 'agents',
  columns: [
    { name: 'name', storage: 'text', interpretation: 'plain', required: true },
    { name: 'status', storage: 'text', interpretation: 'plain', required: true },
    { name: 'modelProvider', storage: 'text', interpretation: 'plain', required: true },
    { name: 'model', storage: 'text', interpretation: 'plain', required: true },
    { name: 'lastRunAt', storage: 'text', interpretation: { kind: 'datetime' } },
  ],
  permissions: readOnlyPermissions,
}

export const resourcesSchema: CollectionSchema = {
  name: 'resources',
  columns: [
    { name: 'hostname', storage: 'text', interpretation: 'plain', required: true },
    { name: 'type', storage: 'text', interpretation: 'plain', required: true },
    { name: 'status', storage: 'text', interpretation: 'plain', required: true },
    { name: 'telemetryStatus', storage: 'text', interpretation: 'plain', required: true },
    { name: 'storageUtilization', storage: 'number', interpretation: { kind: 'percent', decimals: 0 } },
    { name: 'metrics', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'alerts', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'lastObservedAt', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
  ],
  permissions: readOnlyPermissions,
}

export const policiesSchema: CollectionSchema = {
  name: 'policies',
  columns: [
    { name: 'id', storage: 'text', interpretation: 'plain', required: true },
    { name: 'version', storage: 'text', interpretation: 'plain', required: true },
    { name: 'enabled', storage: 'number', interpretation: { kind: 'boolean' }, required: true },
    {
      name: 'maxTransactionAmount',
      storage: 'number',
      interpretation: { kind: 'currency', symbol: 'RLUSD', decimals: 2 },
      required: true,
    },
    {
      name: 'dailyBudget',
      storage: 'number',
      interpretation: { kind: 'currency', symbol: 'RLUSD', decimals: 2 },
      required: true,
    },
    { name: 'allowedActions', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'allowedVendors', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'allowedResources', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'allowedAgents', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'currency', storage: 'text', interpretation: 'plain', required: true },
    { name: 'requireEvidence', storage: 'number', interpretation: { kind: 'boolean' }, required: true },
    { name: 'updatedAt', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
  ],
  permissions: {
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: false },
  },
}

export const actionsSchema: CollectionSchema = {
  name: 'actions',
  columns: [
    { name: 'agentId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'resourceId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'actionIntent', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'reasoning', storage: 'text', interpretation: 'plain', required: true },
    { name: 'policyDecision', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'executionStatus', storage: 'text', interpretation: 'plain', required: true },
    { name: 'execution', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'createdAt', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
  ],
  permissions: readOnlyPermissions,
}

export const auditEventsSchema: CollectionSchema = {
  name: 'audit-events',
  columns: [
    { name: 'timestamp', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
    { name: 'actor', storage: 'text', interpretation: 'plain', required: true },
    { name: 'eventType', storage: 'text', interpretation: 'plain', required: true },
    { name: 'actionId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'resourceId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'policyVersion', storage: 'text', interpretation: 'plain' },
    { name: 'details', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'transactionHash', storage: 'text', interpretation: 'plain' },
  ],
  permissions: readOnlyPermissions,
}
