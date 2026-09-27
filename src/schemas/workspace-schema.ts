import type { CollectionSchema } from 'deepspace/schema'

export const workspacesSchema: CollectionSchema = {
  name: 'workspaces',
  columns: [
    { name: 'name', storage: 'text', interpretation: 'plain', required: true },
    { name: 'slug', storage: 'text', interpretation: 'plain', required: true },
    { name: 'createdBy', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'createdAt', storage: 'text', interpretation: { kind: 'datetime' }, required: true, immutable: true },
    { name: 'updatedAt', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
  ],
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: false, create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: false },
  },
}

/**
 * DeepSpace's `team` permission resolves against this exact collection name.
 * All writes are privileged server writes so callers cannot forge membership.
 */
export const workspaceMembershipsSchema: CollectionSchema = {
  name: 'team_members',
  columns: [
    { name: 'teamId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true, immutable: true, userBound: true },
    { name: 'status', storage: 'text', interpretation: 'plain', required: true },
    { name: 'role', storage: 'text', interpretation: 'plain', required: true },
    { name: 'createdBy', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'createdAt', storage: 'text', interpretation: { kind: 'datetime' }, required: true, immutable: true },
    { name: 'updatedAt', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
  ],
  uniqueOn: ['teamId', 'userId'],
  ownerField: 'userId',
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: 'own', create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: false },
  },
}
