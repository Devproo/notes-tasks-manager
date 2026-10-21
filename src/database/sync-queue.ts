import type * as SQLite from 'expo-sqlite';

export type SyncEntityType = 'note' | 'task';
export type SyncOperationType = 'save' | 'delete';

export interface SyncQueueItem {
  user_id: string;
  entity_type: SyncEntityType;
  client_id: string;
  operation: SyncOperationType;
  payload: string;
  created_at: string;
  updated_at: string;
  attempts: number;
}

interface EnqueueSyncOperationInput {
  userId: string;
  entityType: SyncEntityType;
  clientId: string;
  operation: SyncOperationType;
  payload?: Record<string, unknown>;
}

export async function enqueueSyncOperation(
  db: SQLite.SQLiteDatabase,
  input: EnqueueSyncOperationInput,
): Promise<void> {
  const now = new Date().toISOString();
  const payload =
    input.operation === 'save' ? JSON.stringify(input.payload ?? {}) : '{}';

  await db.runAsync(
    `INSERT INTO sync_queue (
      user_id,
      entity_type,
      client_id,
      operation,
      payload,
      created_at,
      updated_at,
      attempts
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT (user_id, entity_type, client_id)
    DO UPDATE SET
      operation = excluded.operation,
      payload = excluded.payload,
      updated_at = excluded.updated_at,
      attempts = 0`,
    input.userId,
    input.entityType,
    input.clientId,
    input.operation,
    payload,
    now,
    now,
  );
}

export async function getPendingSyncOperations(
  db: SQLite.SQLiteDatabase,
  userId: string,
  limit = 50,
): Promise<SyncQueueItem[]> {
  const safeLimit = Math.max(1, Math.floor(limit));

  return db.getAllAsync<SyncQueueItem>(
    `SELECT
      user_id,
      entity_type,
      client_id,
      operation,
      payload,
      created_at,
      updated_at,
      attempts
    FROM sync_queue
    WHERE user_id = ?
    ORDER BY created_at ASC, updated_at ASC
    LIMIT ?`,
    userId,
    safeLimit,
  );
}

export async function incrementSyncAttempts(
  db: SQLite.SQLiteDatabase,
  item: SyncQueueItem,
): Promise<void> {
  await db.runAsync(
    `UPDATE sync_queue
    SET attempts = attempts + 1
    WHERE user_id = ?
      AND entity_type = ?
      AND client_id = ?
      AND operation = ?
      AND updated_at = ?
      AND payload = ?`,
    item.user_id,
    item.entity_type,
    item.client_id,
    item.operation,
    item.updated_at,
    item.payload,
  );
}

export async function removeSyncedOperation(
  db: SQLite.SQLiteDatabase,
  item: SyncQueueItem,
): Promise<void> {
  await db.runAsync(
    `DELETE FROM sync_queue
    WHERE user_id = ?
      AND entity_type = ?
      AND client_id = ?
      AND operation = ?
      AND updated_at = ?
      AND payload = ?`,
    item.user_id,
    item.entity_type,
    item.client_id,
    item.operation,
    item.updated_at,
    item.payload,
  );
}

export async function getSyncQueueItem(
  db: SQLite.SQLiteDatabase,
  userId: string,
  entityType: SyncEntityType,
  clientId: string,
): Promise<SyncQueueItem | null> {
  return db.getFirstAsync<SyncQueueItem>(
    `SELECT user_id, entity_type, client_id, operation,
            payload, created_at, updated_at, attempts
     FROM sync_queue
     WHERE user_id = ?
       AND entity_type = ?
       AND client_id = ?`,
    userId,
    entityType,
    clientId,
  );
}
