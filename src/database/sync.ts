import type * as SQLite from 'expo-sqlite';

import { getDatabase } from '@/database/database';
import {
  enqueueSyncOperation,
  getPendingSyncOperations,
  getSyncQueueItem,
  incrementSyncAttempts,
  removeSyncedOperation,
  type SyncQueueItem,
} from '@/database/sync-queue';

type NotePayload = {
  title: string;
  content: string;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
};

type TaskPayload = {
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'done';
  priority: 'low' | 'medium' | 'high';
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SyncCallbacks = {
  saveNote: (args: NotePayload & { clientId: string }) => Promise<unknown>;
  removeNote: (args: { clientId: string }) => Promise<unknown>;
  saveTask: (args: TaskPayload & { clientId: string }) => Promise<unknown>;
  removeTask: (args: { clientId: string }) => Promise<unknown>;
};

type NoteRow = {
  id: string;
  title: string;
  content: string;
  is_pinned: number;
  created_at: string;
  updated_at: string;
};

type TaskRow = {
  id: string;
  title: string;
  description: string;
  status: TaskPayload['status'];
  priority: TaskPayload['priority'];
  due_date: string | null;
  created_at: string;
  updated_at: string;
};

async function migrateExistingData(
  db: SQLite.SQLiteDatabase,
  userId: string,
): Promise<void> {
  const migration = await db.getFirstAsync<{ user_id: string }>(
    'SELECT user_id FROM sync_migrations WHERE user_id = ?',
    userId,
  );

  if (migration) return;

  await db.withTransactionAsync(async () => {
    const notes = await db.getAllAsync<NoteRow>(
      `SELECT id, title, content, is_pinned, created_at, updated_at
       FROM notes WHERE user_id = ?`,
      userId,
    );

    for (const note of notes) {
      const queued = await getSyncQueueItem(db, userId, 'note', note.id);
      if (queued) continue;

      await enqueueSyncOperation(db, {
        userId,
        entityType: 'note',
        clientId: note.id,
        operation: 'save',
        payload: {
          title: note.title,
          content: note.content,
          isPinned: note.is_pinned === 1,
          createdAt: note.created_at,
          updatedAt: note.updated_at,
        } satisfies NotePayload,
      });
    }

    const tasks = await db.getAllAsync<TaskRow>(
      `SELECT id, title, description, status, priority, due_date,
              created_at, updated_at
       FROM tasks WHERE user_id = ?`,
      userId,
    );

    for (const task of tasks) {
      const queued = await getSyncQueueItem(db, userId, 'task', task.id);
      if (queued) continue;

      await enqueueSyncOperation(db, {
        userId,
        entityType: 'task',
        clientId: task.id,
        operation: 'save',
        payload: {
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          dueDate: task.due_date,
          createdAt: task.created_at,
          updatedAt: task.updated_at,
        } satisfies TaskPayload,
      });
    }

    await db.runAsync(
      'INSERT INTO sync_migrations (user_id, completed_at) VALUES (?, ?)',
      userId,
      new Date().toISOString(),
    );
  });
}

async function processOperation(
  item: SyncQueueItem,
  callbacks: SyncCallbacks,
): Promise<void> {
  if (item.operation === 'delete') {
    if (item.entity_type === 'note') {
      await callbacks.removeNote({ clientId: item.client_id });
    } else {
      await callbacks.removeTask({ clientId: item.client_id });
    }
    return;
  }

  const payload: unknown = JSON.parse(item.payload);

  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new Error('Invalid sync payload');
  }

  if (item.entity_type === 'note') {
    await callbacks.saveNote({
      ...(payload as NotePayload),
      clientId: item.client_id,
    });
  } else {
    await callbacks.saveTask({
      ...(payload as TaskPayload),
      clientId: item.client_id,
    });
  }
}

let syncInProgress = false;

export async function syncLocalData(
  userId: string,
  callbacks: SyncCallbacks,
): Promise<void> {
  if (syncInProgress) return;

  syncInProgress = true;

  try {
    const db = await getDatabase();
    await migrateExistingData(db, userId);

    const pending = await getPendingSyncOperations(db, userId, 500);

    for (const item of pending) {
      try {
        await processOperation(item, callbacks);
        await removeSyncedOperation(db, item);
      } catch {
        await incrementSyncAttempts(db, item);
      }
    }
  } finally {
    syncInProgress = false;
  }
}
