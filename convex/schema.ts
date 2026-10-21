import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  notes: defineTable({
    ownerId: v.string(),
    clientId: v.string(),
    title: v.string(),
    content: v.string(),
    isPinned: v.boolean(),
    createdAt: v.string(),
    updatedAt: v.string(),
    deletedAt: v.optional(v.string()),
  })
    .index('by_owner_client', ['ownerId', 'clientId'])
    .index('by_owner_updated', ['ownerId', 'updatedAt']),

  tasks: defineTable({
    ownerId: v.string(),
    clientId: v.string(),
    title: v.string(),
    description: v.string(),
    status: v.union(
      v.literal('todo'),
      v.literal('in_progress'),
      v.literal('done'),
    ),
    priority: v.union(v.literal('low'), v.literal('medium'), v.literal('high')),
    dueDate: v.union(v.string(), v.null()),
    createdAt: v.string(),
    updatedAt: v.string(),
    deletedAt: v.optional(v.string()),
  })
    .index('by_owner_client', ['ownerId', 'clientId'])
    .index('by_owner_updated', ['ownerId', 'updatedAt']),
});
