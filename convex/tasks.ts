import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('Authentication required');

    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_owner_updated', (q) => q.eq('ownerId', identity.subject))
      .order('desc')
      .collect();

    return tasks.filter((task) => task.deletedAt === undefined);
  },
});

export const save = mutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('Authentication required');

    const existing = await ctx.db
      .query('tasks')
      .withIndex('by_owner_client', (q) =>
        q.eq('ownerId', identity.subject).eq('clientId', args.clientId),
      )
      .unique();

    const { clientId, createdAt, ...fields } = args;

    if (existing) {
      // Do not let a stale retry resurrect a deleted task.
      if (existing.deletedAt !== undefined) {
        return existing._id;
      }

      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }

    return await ctx.db.insert('tasks', {
      ownerId: identity.subject,
      clientId,
      createdAt,
      ...fields,
    });
  },
});

export const remove = mutation({
  args: { clientId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('Authentication required');

    const existing = await ctx.db
      .query('tasks')
      .withIndex('by_owner_client', (q) =>
        q.eq('ownerId', identity.subject).eq('clientId', args.clientId),
      )
      .unique();

    if (!existing) return null;

    const now = new Date().toISOString();

    await ctx.db.patch(existing._id, {
      deletedAt: now,
      updatedAt: now,
    });

    return existing._id;
  },
});
