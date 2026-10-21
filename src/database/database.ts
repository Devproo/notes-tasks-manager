import * as SQLite from 'expo-sqlite';

const DATABASE_NAME = 'notes-tasks-manager.db';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = initializeDatabase().catch((error) => {
      databasePromise = null;
      throw error;
    });
  }

  return databasePromise;
}

async function initializeDatabase(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);

  try {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        is_pinned INTEGER NOT NULL DEFAULT 0
          CHECK (is_pinned IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_notes_user_updated
      ON notes (user_id, updated_at);

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'todo'
          CHECK (status IN ('todo', 'in_progress', 'done')),
        priority TEXT NOT NULL DEFAULT 'medium'
          CHECK (priority IN ('low', 'medium', 'high')),
        due_date TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_user_status
      ON tasks (user_id, status);

      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        note_id TEXT REFERENCES notes(id) ON DELETE CASCADE,
        task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        uri TEXT NOT NULL,
        mime_type TEXT,
        created_at TEXT NOT NULL,
        CHECK (
          (note_id IS NOT NULL AND task_id IS NULL)
          OR
          (note_id IS NULL AND task_id IS NOT NULL)
        )
      );

      CREATE INDEX IF NOT EXISTS idx_attachments_note
      ON attachments (note_id);

      CREATE INDEX IF NOT EXISTS idx_attachments_task
      ON attachments (task_id);

      CREATE TABLE IF NOT EXISTS sync_queue (
        user_id TEXT NOT NULL,
        entity_type TEXT NOT NULL
          CHECK (entity_type IN ('note', 'task')),
        client_id TEXT NOT NULL,
        operation TEXT NOT NULL
          CHECK (operation IN ('save', 'delete')),
        payload TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, entity_type, client_id)
      );


CREATE TABLE IF NOT EXISTS sync_migrations (
  user_id TEXT PRIMARY KEY NOT NULL,
  completed_at TEXT NOT NULL
);


      CREATE INDEX IF NOT EXISTS idx_sync_queue_user_created
      ON sync_queue (user_id, created_at);

    `);

    return db;
  } catch (error) {
    await db.closeAsync();
    throw error;
  }
}
