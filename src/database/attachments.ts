import { getDatabase } from '@/database/database';
import type { Attachment } from '@/types/models';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

type AttachmentInput = {
  userId: string;
  uri: string;
  fileName: string;
  mimeType?: string | null;
  noteId?: string | null;
  taskId?: string | null;
};

type AttachmentRow = {
  id: string;
  user_id: string;
  note_id: string | null;
  task_id: string | null;
  file_name: string;
  uri: string;
  mime_type: string | null;
  created_at: string;
};

const MAX_WEB_FILE_SIZE = 5 * 1024 * 1024;

function mapAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    userId: row.user_id,
    noteId: row.note_id,
    taskId: row.task_id,
    fileName: row.file_name,
    uri: row.uri,
    mimeType: row.mime_type,
    createdAt: row.created_at,
  };
}

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function safeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'attachment';
}

async function saveWebFile(uri: string): Promise<string> {
  const response = await fetch(uri);

  if (!response.ok) {
    throw new Error('Could not read the selected file.');
  }

  const blob = await response.blob();

  if (blob.size > MAX_WEB_FILE_SIZE) {
    throw new Error('On web, attachments must be 5 MB or smaller.');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not save the selected file.'));
      }
    };

    reader.onerror = () =>
      reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(blob);
  });
}

async function saveNativeFile(
  uri: string,
  fileName: string,
  id: string,
  userId: string,
): Promise<string> {
  const directory = FileSystem.documentDirectory;

  if (!directory) {
    throw new Error('Persistent file storage is unavailable.');
  }

  const safeUserId = safeFileName(userId);
  const attachmentDirectory = `${directory}attachments/${safeUserId}/`;

  await FileSystem.makeDirectoryAsync(attachmentDirectory, {
    intermediates: true,
  });

  const storedUri = `${attachmentDirectory}${id}-${safeFileName(fileName)}`;

  await FileSystem.copyAsync({ from: uri, to: storedUri });

  return storedUri;
}

export async function addAttachment(
  input: AttachmentInput,
): Promise<Attachment> {
  const { userId, uri, fileName, noteId, taskId } = input;

  if (!userId) {
    throw new Error('You must be signed in to add an attachment.');
  }

  if (Boolean(noteId) === Boolean(taskId)) {
    throw new Error('Attach a file to exactly one note or task.');
  }

  const db = await getDatabase();

  if (noteId) {
    const parent = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM notes WHERE id = ? AND user_id = ?',
      noteId,
      userId,
    );

    if (!parent) throw new Error('Note not found.');
  }

  if (taskId) {
    const parent = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM tasks WHERE id = ? AND user_id = ?',
      taskId,
      userId,
    );

    if (!parent) throw new Error('Task not found.');
  }

  const id = createId();
  const createdAt = new Date().toISOString();

  const storedUri =
    Platform.OS === 'web'
      ? await saveWebFile(uri)
      : await saveNativeFile(uri, fileName, id, userId);

  try {
    await db.runAsync(
      `INSERT INTO attachments
        (id, user_id, note_id, task_id, file_name, uri, mime_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      userId,
      noteId ?? null,
      taskId ?? null,
      fileName,
      storedUri,
      input.mimeType ?? null,
      createdAt,
    );
  } catch (error) {
    if (Platform.OS !== 'web') {
      await FileSystem.deleteAsync(storedUri, { idempotent: true }).catch(
        () => undefined,
      );
    }
    throw error;
  }

  return {
    id,
    userId,
    noteId: noteId ?? null,
    taskId: taskId ?? null,
    fileName,
    uri: storedUri,
    mimeType: input.mimeType ?? null,
    createdAt,
  };
}

export async function listAttachments(input: {
  userId: string;
  noteId?: string;
  taskId?: string;
}): Promise<Attachment[]> {
  const { userId, noteId, taskId } = input;

  if (Boolean(noteId) === Boolean(taskId)) {
    throw new Error('Specify exactly one note ID or task ID.');
  }

  const db = await getDatabase();

  const rows = noteId
    ? await db.getAllAsync<AttachmentRow>(
        `SELECT id, user_id, note_id, task_id, file_name, uri, mime_type, created_at
         FROM attachments
         WHERE user_id = ? AND note_id = ?
         ORDER BY created_at DESC`,
        userId,
        noteId,
      )
    : await db.getAllAsync<AttachmentRow>(
        `SELECT id, user_id, note_id, task_id, file_name, uri, mime_type, created_at
         FROM attachments
         WHERE user_id = ? AND task_id = ?
         ORDER BY created_at DESC`,
        userId,
        taskId!,
      );

  return rows.map(mapAttachment);
}

export type AllAttachment = Attachment & {
  noteTitle: string;
};

export async function listAllAttachments(
  userId: string,
): Promise<AllAttachment[]> {
  const db = await getDatabase();

  const rows = await db.getAllAsync<
    AttachmentRow & { note_title: string | null }
  >(
    `SELECT a.id, a.user_id, a.note_id, a.task_id, a.file_name,
            a.uri, a.mime_type, a.created_at, n.title AS note_title
     FROM attachments a
     LEFT JOIN notes n ON n.id = a.note_id AND n.user_id = a.user_id
     WHERE a.user_id = ?
     ORDER BY a.created_at DESC`,
    userId,
  );

  return rows.map((row) => ({
    ...mapAttachment(row),
    noteTitle: row.note_title ?? 'Note unavailable',
  }));
}

export async function removeAttachment(
  attachmentId: string,
  userId: string,
): Promise<void> {
  const db = await getDatabase();

  const attachment = await db.getFirstAsync<AttachmentRow>(
    `SELECT id, user_id, note_id, task_id, file_name, uri, mime_type, created_at
     FROM attachments
     WHERE id = ? AND user_id = ?`,
    attachmentId,
    userId,
  );

  if (!attachment) return;

  await db.runAsync(
    'DELETE FROM attachments WHERE id = ? AND user_id = ?',
    attachmentId,
    userId,
  );

  if (Platform.OS !== 'web') {
    await FileSystem.deleteAsync(attachment.uri, { idempotent: true }).catch(
      () => undefined,
    );
  }
}
