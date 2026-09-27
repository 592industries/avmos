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
    { name: 'telemetrySource', storage: 'text', interpretation: 'plain', required: true },
    { name: 'historicalStatus', storage: 'text', interpretation: 'plain', required: true },
    { name: 'historicalSource', storage: 'text', interpretation: 'plain', required: true },
    { name: 'trendStatus', storage: 'text', interpretation: 'plain' },
    { name: 'trendError', storage: 'text', interpretation: 'plain' },
    { name: 'storageUtilization', storage: 'number', interpretation: { kind: 'percent', decimals: 0 } },
    { name: 'metrics', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'trendPoints', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'freshnessSeconds', storage: 'number', interpretation: 'plain' },
    { name: 'sourceEntityId', storage: 'text', interpretation: 'plain' },
    { name: 'alerts', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'lastObservedAt', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
    { name: 'lastQueryAt', storage: 'text', interpretation: { kind: 'datetime' } },
    { name: 'lastQueryStatus', storage: 'text', interpretation: 'plain' },
  ],
  permissions: readOnlyPermissions,
}

const telemetryColumns: CollectionSchema['columns'] = [
  { name: 'resourceId', storage: 'text', interpretation: 'plain', required: true },
  { name: 'provider', storage: 'text', interpretation: 'plain', required: true },
  { name: 'metric', storage: 'text', interpretation: 'plain', required: true },
  { name: 'value', storage: 'number', interpretation: 'plain' },
  { name: 'unit', storage: 'text', interpretation: 'plain', required: true },
  { name: 'status', storage: 'text', interpretation: 'plain', required: true },
  { name: 'observedAt', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
  { name: 'receivedAt', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
  { name: 'freshnessMs', storage: 'number', interpretation: 'plain', required: true },
  { name: 'sourceEntityGuid', storage: 'text', interpretation: 'plain' },
  { name: 'metadata', storage: 'text', interpretation: { kind: 'json' }, required: true },
]

export const currentTelemetrySchema: CollectionSchema = {
  name: 'current-telemetry', columns: telemetryColumns, permissions: readOnlyPermissions,
  uniqueOn: ['resourceId', 'metric'],
}

export const telemetryObservationsSchema: CollectionSchema = {
  name: 'telemetry-observations',
  columns: [...telemetryColumns,
    { name: 'hourBucket', storage: 'text', interpretation: 'plain', required: true },
    { name: 'expiresAt', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
    { name: 'expiresOn', storage: 'text', interpretation: 'plain', required: true },
  ],
  uniqueOn: ['resourceId', 'metric', 'observedAt'], permissions: readOnlyPermissions,
}

export const telemetryAggregatesSchema: CollectionSchema = {
  name: 'telemetry-aggregates',
  columns: [
    { name: 'resourceId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'metric', storage: 'text', interpretation: 'plain', required: true },
    { name: 'unit', storage: 'text', interpretation: 'plain', required: true },
    { name: 'bucketStart', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
    { name: 'bucketEnd', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
    { name: 'minimum', storage: 'number', interpretation: 'plain', required: true },
    { name: 'maximum', storage: 'number', interpretation: 'plain', required: true },
    { name: 'average', storage: 'number', interpretation: 'plain', required: true },
    { name: 'sampleCount', storage: 'number', interpretation: 'plain', required: true },
    { name: 'status', storage: 'text', interpretation: 'plain', required: true },
    { name: 'expiresAt', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
    { name: 'expiresOn', storage: 'text', interpretation: 'plain', required: true },
  ], uniqueOn: ['resourceId', 'metric', 'bucketStart'], permissions: readOnlyPermissions,
}

export const alertsSchema: CollectionSchema = {
  name: 'alerts', columns: [
    { name: 'resourceId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'metric', storage: 'text', interpretation: 'plain', required: true },
    { name: 'severity', storage: 'text', interpretation: 'plain', required: true },
    { name: 'status', storage: 'text', interpretation: 'plain', required: true },
    { name: 'value', storage: 'number', interpretation: 'plain', required: true },
    { name: 'threshold', storage: 'number', interpretation: 'plain', required: true },
    { name: 'openedAt', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
    { name: 'updatedAt', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
    { name: 'resolvedAt', storage: 'text', interpretation: { kind: 'datetime' } },
    { name: 'expiresAt', storage: 'text', interpretation: { kind: 'datetime' } },
    { name: 'expiresOn', storage: 'text', interpretation: 'plain' },
  ], permissions: readOnlyPermissions,
}

export const policyDecisionsSchema: CollectionSchema = {
  name: 'policy-decisions', columns: [
    { name: 'actionId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'resourceId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'policyId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'providerId', storage: 'text', interpretation: 'plain' },
    { name: 'decision', storage: 'text', interpretation: 'plain', required: true },
    { name: 'checks', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'decidedAt', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
    { name: 'expiresAt', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
    { name: 'expiresOn', storage: 'text', interpretation: 'plain', required: true },
  ], permissions: readOnlyPermissions,
}

export const operationsLogSchema: CollectionSchema = {
  name: 'operations-log', columns: [
    { name: 'task', storage: 'text', interpretation: 'plain', required: true },
    { name: 'status', storage: 'text', interpretation: 'plain', required: true },
    { name: 'message', storage: 'text', interpretation: 'plain', required: true },
    { name: 'timestamp', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
    { name: 'expiresAt', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
    { name: 'expiresOn', storage: 'text', interpretation: 'plain', required: true },
  ], permissions: readOnlyPermissions,
}

export const retentionStatusSchema: CollectionSchema = {
  name: 'retention-status', columns: [
    { name: 'collection', storage: 'text', interpretation: 'plain', required: true },
    { name: 'status', storage: 'text', interpretation: 'plain', required: true },
    { name: 'deleted', storage: 'number', interpretation: 'plain', required: true },
    { name: 'oldestExpiresAt', storage: 'text', interpretation: { kind: 'datetime' } },
    { name: 'lastRunAt', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
    { name: 'cursorDate', storage: 'text', interpretation: 'plain' },
    { name: 'error', storage: 'text', interpretation: 'plain' },
  ], permissions: readOnlyPermissions,
}

export const integrationConfigSchema: CollectionSchema = {
  name: 'integration-config', columns: [
    { name: 'providerId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'publicConfig', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'verificationStatus', storage: 'text', interpretation: 'plain', required: true },
    { name: 'lastVerifiedAt', storage: 'text', interpretation: { kind: 'datetime' } },
    { name: 'lastError', storage: 'text', interpretation: 'plain' },
    { name: 'updatedAt', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
    { name: 'updatedBy', storage: 'text', interpretation: 'plain', required: true },
  ], permissions: readOnlyPermissions,
}

export const policiesSchema: CollectionSchema = {
  name: 'policies',
  columns: [
    { name: 'id', storage: 'text', interpretation: 'plain', required: true },
    { name: 'name', storage: 'text', interpretation: 'plain' },
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
    { name: 'allowedProviders', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'authorizationScopes', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'currency', storage: 'text', interpretation: 'plain', required: true },
    { name: 'requireEvidence', storage: 'number', interpretation: { kind: 'boolean' }, required: true },
    { name: 'maxTelemetryAgeSeconds', storage: 'number', interpretation: 'plain' },
    { name: 'updatedAt', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
    { name: 'createdAt', storage: 'text', interpretation: { kind: 'datetime' } },
    { name: 'createdBy', storage: 'text', interpretation: 'plain' },
    { name: 'updatedBy', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: false },
  },
}

export const actionsSchema: CollectionSchema = {
  name: 'actions',
  columns: [
    { name: 'agentId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'resourceId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'actionIntent', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'reasoning', storage: 'text', interpretation: 'plain' },
    { name: 'decisionSummary', storage: 'text', interpretation: 'plain' },
    { name: 'providerId', storage: 'text', interpretation: 'plain' },
    { name: 'policyDecision', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'executionStatus', storage: 'text', interpretation: 'plain', required: true },
    { name: 'policyId', storage: 'text', interpretation: 'plain' },
    { name: 'policyHash', storage: 'text', interpretation: 'plain' },
    { name: 'policySnapshot', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'operationFingerprint', storage: 'text', interpretation: 'plain' },
    { name: 'auditStatus', storage: 'text', interpretation: 'plain' },
    { name: 'execution', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'createdAt', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
    { name: 'expiresAt', storage: 'text', interpretation: { kind: 'datetime' } },
    { name: 'expiresOn', storage: 'text', interpretation: 'plain' },
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
    { name: 'expiresAt', storage: 'text', interpretation: { kind: 'datetime' } },
    { name: 'expiresOn', storage: 'text', interpretation: 'plain' },
  ],
  permissions: readOnlyPermissions,
}
