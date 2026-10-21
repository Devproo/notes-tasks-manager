import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

async function requireIdentity(ctx: {
  auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
}) {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) {
    throw new Error('Authentication required');
  }

  return identity;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);

    const notes = await ctx.db
      .query('notes')
      .withIndex('by_owner_updated', (q) => q.eq('ownerId', identity.subject))
      .order('desc')
      .collect();

    return notes.filter((note) => note.deletedAt === undefined);
  },
});

export const save = mutation({
  args: {
    clientId: v.string(),
    title: v.string(),
    content: v.string(),
    isPinned: v.boolean(),
    createdAt: v.string(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);

    const existing = await ctx.db
      .query('notes')
      .withIndex('by_owner_client', (q) =>
        q.eq('ownerId', identity.subject).eq('clientId', args.clientId),
      )
      .unique();

    const note = {
      title: args.title,
      content: args.content,
      isPinned: args.isPinned,
      updatedAt: args.updatedAt,
    };

    if (existing) {
      // Do not let a stale retry resurrect a deleted note.
      if (existing.deletedAt !== undefined) {
        return existing._id;
      }

      await ctx.db.patch(existing._id, note);
      return existing._id;
    }

    return await ctx.db.insert('notes', {
      ownerId: identity.subject,
      clientId: args.clientId,
      ...note,
      createdAt: args.createdAt,
    });
  },
});

export const remove = mutation({
  args: {
    clientId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);

    const existing = await ctx.db
      .query('notes')
      .withIndex('by_owner_client', (q) =>
        q.eq('ownerId', identity.subject).eq('clientId', args.clientId),
      )
      .unique();

    if (!existing) {
      return null;
    }

    await ctx.db.patch(existing._id, {
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return existing._id;
  },
});
