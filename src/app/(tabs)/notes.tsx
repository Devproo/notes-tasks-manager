import { useUser } from '@clerk/expo';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';

import {
  enqueueSyncOperation,
  getPendingSyncOperations,
  removeSyncedOperation,
} from '@/database/sync-queue';

import { useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';

import {
  addAttachment,
  listAllAttachments,
  listAttachments,
  removeAttachment,
} from '@/database/attachments';
import { getDatabase } from '@/database/database';
import type { Attachment, Note } from '@/types/models';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type NoteRow = {
  id: string;
  user_id: string;
  title: string;
  content: string;
  is_pinned: number;
  created_at: string;
  updated_at: string;
};

function mapNote(row: NoteRow): Note {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    content: row.content,
    isPinned: row.is_pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default function NotesScreen() {
  const { isLoaded, user } = useUser();
  const userId = user?.id;

  const saveCloudNote = useMutation(api.notes.save);
  const removeCloudNote = useMutation(api.notes.remove);

  const [notes, setNotes] = useState<Note[]>([]);
  const [attachments, setAttachments] = useState<Record<string, Attachment[]>>(
    {},
  );
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyAttachment, setBusyAttachment] = useState<string | null>(null);
  const [error, setError] = useState('');

  const [showAllAttachments, setShowAllAttachments] = useState(false);
  const [allAttachments, setAllAttachments] = useState<
    Awaited<ReturnType<typeof listAllAttachments>>
  >([]);

  async function refreshAttachments(noteId: string, currentUserId: string) {
    const items = await listAttachments({
      userId: currentUserId,
      noteId,
    });

    setAttachments((current) => ({ ...current, [noteId]: items }));
  }

  useEffect(() => {
    let cancelled = false;

    async function loadNotes() {
      if (!userId) {
        setNotes([]);
        setAttachments({});
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');

      try {
        const db = await getDatabase();
        const rows = await db.getAllAsync<NoteRow>(
          `SELECT id, user_id, title, content, is_pinned, created_at, updated_at
           FROM notes
           WHERE user_id = ?
           ORDER BY is_pinned DESC, updated_at DESC`,
          userId,
        );

        const loadedNotes = rows.map(mapNote);
        const loadedAttachments = await Promise.all(
          loadedNotes.map(async (note) => ({
            noteId: note.id,
            items: await listAttachments({ userId, noteId: note.id }),
          })),
        );

        if (!cancelled) {
          setNotes(loadedNotes);
          setAttachments(
            Object.fromEntries(
              loadedAttachments.map(({ noteId, items }) => [noteId, items]),
            ),
          );
        }
      } catch {
        if (!cancelled) {
          setError('Could not load notes or attachments. Please try again.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (isLoaded) void loadNotes();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, userId]);

  async function createNote() {
    if (!userId || saving) return;

    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();

    if (!trimmedTitle && !trimmedContent) {
      setError('Enter a title or some note content first.');
      return;
    }

    setSaving(true);
    setError('');

    const now = new Date().toISOString();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const noteTitle = trimmedTitle || 'Untitled note';

    const newNote: Note = {
      id,
      userId,
      title: noteTitle,
      content: trimmedContent,
      isPinned: false,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const db = await getDatabase();

      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `INSERT INTO notes
           (id, user_id, title, content, is_pinned, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?)`,
          id,
          userId,
          noteTitle,
          trimmedContent,
          now,
          now,
        );

        await enqueueSyncOperation(db, {
          userId,
          entityType: 'note',
          clientId: id,
          operation: 'save',
          payload: {
            title: noteTitle,
            content: trimmedContent,
            isPinned: false,
            createdAt: now,
            updatedAt: now,
          },
        });
      });

      setNotes((current) => [newNote, ...current]);
      setTitle('');
      setContent('');

      try {
        await saveCloudNote({
          clientId: id,
          title: noteTitle,
          content: trimmedContent,
          isPinned: false,
          createdAt: now,
          updatedAt: now,
        });

        const pending = await getPendingSyncOperations(db, userId);
        const queuedSave = pending.find(
          (item) =>
            item.entity_type === 'note' &&
            item.client_id === id &&
            item.operation === 'save',
        );

        if (queuedSave) {
          await removeSyncedOperation(db, queuedSave);
        }
      } catch {
        setError(
          'Note saved on this device. Cloud sync is pending and will be retried.',
        );
      }
    } catch {
      setError('Could not save the note locally. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function pickPhoto(noteId: string) {
    if (!userId || busyAttachment) return;

    setBusyAttachment(noteId);
    setError('');

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });

      if (result.canceled) return;

      const asset = result.assets[0];
      if (!asset) return;

      await addAttachment({
        userId,
        noteId,
        uri: asset.uri,
        fileName: asset.fileName || `photo-${Date.now()}.jpg`,
        mimeType: asset.mimeType || 'image/jpeg',
      });

      await refreshAttachments(noteId, userId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not attach the photo.',
      );
    } finally {
      setBusyAttachment(null);
    }
  }

  async function takePhoto(noteId: string) {
    if (!userId || busyAttachment) return;

    setBusyAttachment(noteId);
    setError('');

    try {
      if (Platform.OS === 'web') {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            'Camera access is unavailable. Open the app using localhost or HTTPS in a supported browser.',
          );
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });

        try {
          const video = document.createElement('video');
          video.autoplay = true;
          video.playsInline = true;
          video.srcObject = stream;

          await new Promise<void>((resolve, reject) => {
            video.onloadedmetadata = () => resolve();
            video.onerror = () =>
              reject(new Error('Could not start the camera.'));
          });

          await video.play();

          await new Promise<void>((resolve) => {
            const checkReady = () => {
              if (video.videoWidth > 0 && video.videoHeight > 0) {
                resolve();
              } else {
                requestAnimationFrame(checkReady);
              }
            };
            checkReady();
          });

          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;

          const context = canvas.getContext('2d');
          if (!context) throw new Error('Could not capture the camera image.');

          context.drawImage(video, 0, 0, canvas.width, canvas.height);

          const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
              (result) =>
                result
                  ? resolve(result)
                  : reject(new Error('Could not create the photo.')),
              'image/jpeg',
              0.8,
            );
          });

          const uri = URL.createObjectURL(blob);

          try {
            await addAttachment({
              userId,
              noteId,
              uri,
              fileName: `camera-${Date.now()}.jpg`,
              mimeType: 'image/jpeg',
            });

            await refreshAttachments(noteId, userId);
          } finally {
            URL.revokeObjectURL(uri);
          }
        } finally {
          stream.getTracks().forEach((track) => track.stop());
        }

        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsEditing: false,
      });

      if (result.canceled) return;

      const asset = result.assets[0];
      if (!asset) return;

      await addAttachment({
        userId,
        noteId,
        uri: asset.uri,
        fileName: asset.fileName || `camera-${Date.now()}.jpg`,
        mimeType: asset.mimeType || 'image/jpeg',
      });

      await refreshAttachments(noteId, userId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not capture the photo.',
      );
    } finally {
      setBusyAttachment(null);
    }
  }

  async function pickFile(noteId: string) {
    if (!userId || busyAttachment) return;

    setBusyAttachment(noteId);
    setError('');

    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled) return;

      const file = result.assets[0];
      if (!file) return;

      await addAttachment({
        userId,
        noteId,
        uri: file.uri,
        fileName: file.name,
        mimeType: file.mimeType,
      });

      await refreshAttachments(noteId, userId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not attach the file.',
      );
    } finally {
      setBusyAttachment(null);
    }
  }

  async function deleteAttachment(noteId: string, attachmentId: string) {
    if (!userId || busyAttachment) return;

    setBusyAttachment(attachmentId);
    setError('');

    try {
      await removeAttachment(attachmentId, userId);
      await refreshAttachments(noteId, userId);
    } catch {
      setError('Could not remove the attachment.');
    } finally {
      setBusyAttachment(null);
    }
  }

  async function deleteNote(note: Note) {
    if (!userId) return;

    setError('');

    try {
      const db = await getDatabase();

      const noteAttachments = await listAttachments({
        userId,
        noteId: note.id,
      });

      for (const attachment of noteAttachments) {
        await removeAttachment(attachment.id, userId);
      }

      await db.withTransactionAsync(async () => {
        await db.runAsync(
          'DELETE FROM notes WHERE id = ? AND user_id = ?',
          note.id,
          userId,
        );

        await enqueueSyncOperation(db, {
          userId,
          entityType: 'note',
          clientId: note.id,
          operation: 'delete',
        });
      });

      setNotes((current) => current.filter((item) => item.id !== note.id));
      setAttachments((current) => {
        const next = { ...current };
        delete next[note.id];
        return next;
      });

      try {
        await removeCloudNote({ clientId: note.id });

        const pending = await getPendingSyncOperations(db, userId);
        const queuedDelete = pending.find(
          (item) =>
            item.entity_type === 'note' &&
            item.client_id === note.id &&
            item.operation === 'delete',
        );

        if (queuedDelete) {
          await removeSyncedOperation(db, queuedDelete);
        }
      } catch {
        setError(
          'Note deleted on this device. Cloud sync is pending and will be retried.',
        );
      }
    } catch {
      setError('Could not delete the note locally. Please try again.');
    }
  }

  if (!isLoaded || loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size='large' />
      </View>
    );
  }

  async function toggleAllAttachments() {
    if (!userId) return;

    if (!showAllAttachments) {
      try {
        const items = await listAllAttachments(userId);
        setAllAttachments(items);
      } catch {
        setError('Could not load all attachments.');
        return;
      }
    }

    setShowAllAttachments((current) => !current);
  }
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps='handled'
      >
        <Text style={styles.title}>Notes</Text>
        <Text style={styles.subtitle}>
          Capture ideas, attach files, and keep important information close.
        </Text>

        <Pressable
          onPress={() => void toggleAllAttachments()}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>
            {showAllAttachments
              ? 'Hide all attachments'
              : 'View all attachments'}
          </Text>
        </Pressable>

        {showAllAttachments && (
          <View style={styles.noteCard}>
            <Text style={styles.sectionTitle}>
              All attachments ({allAttachments.length})
            </Text>

            {allAttachments.length === 0 ? (
              <Text style={styles.empty}>No attachments yet.</Text>
            ) : (
              allAttachments.map((attachment) => (
                <View
                  key={attachment.id}
                  style={styles.attachmentRow}
                >
                  <View style={styles.attachmentText}>
                    <Text style={styles.attachmentName}>
                      {attachment.fileName}
                    </Text>
                    <Text style={styles.muted}>
                      {attachment.noteTitle} ·{' '}
                      {new Date(attachment.createdAt).toLocaleDateString()}
                    </Text>
                  </View>

                  <Pressable
                    onPress={() => void Linking.openURL(attachment.uri)}
                    style={styles.secondaryButton}
                  >
                    <Text style={styles.secondaryButtonText}>Open</Text>
                  </Pressable>
                </View>
              ))
            )}
          </View>
        )}

        <View style={styles.form}>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder='Note title'
            placeholderTextColor='#888'
            style={styles.input}
            maxLength={200}
          />

          <TextInput
            value={content}
            onChangeText={setContent}
            placeholder='Write your note...'
            placeholderTextColor='#888'
            style={[styles.input, styles.contentInput]}
            multiline
            textAlignVertical='top'
          />

          <Pressable
            onPress={createNote}
            disabled={saving}
            style={[styles.addButton, saving && styles.buttonPressed]}
          >
            <Text style={styles.addButtonText}>
              {saving ? 'Saving...' : '+ Add note'}
            </Text>
          </Pressable>
        </View>

        {!!error && <Text style={styles.error}>{error}</Text>}

        <Text style={styles.sectionTitle}>Your notes ({notes.length})</Text>

        {notes.length === 0 ? (
          <Text style={styles.empty}>
            No notes yet. Create your first note above.
          </Text>
        ) : (
          notes.map((note) => (
            <View
              key={note.id}
              style={styles.noteCard}
            >
              <Text style={styles.noteTitle}>{note.title}</Text>

              {!!note.content && (
                <Text style={styles.noteContent}>{note.content}</Text>
              )}

              <Text style={styles.noteDate}>
                Updated {new Date(note.updatedAt).toLocaleString()}
              </Text>

              <View style={styles.actions}>
                <Pressable
                  onPress={() => void pickPhoto(note.id)}
                  disabled={busyAttachment !== null}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryButtonText}>+ Add photo</Text>
                </Pressable>

                <Pressable
                  onPress={() => void takePhoto(note.id)}
                  disabled={busyAttachment !== null}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryButtonText}>Take Photo</Text>
                </Pressable>

                <Pressable
                  onPress={() => void pickFile(note.id)}
                  disabled={busyAttachment !== null}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryButtonText}>+ Attach file</Text>
                </Pressable>
              </View>

              {busyAttachment === note.id && (
                <Text style={styles.muted}>Processing attachment...</Text>
              )}

              {(attachments[note.id] || []).map((attachment) => (
                <View
                  key={attachment.id}
                  style={styles.attachmentRow}
                >
                  <View style={styles.attachmentText}>
                    <Text style={styles.attachmentName}>
                      {attachment.mimeType?.startsWith('image/') ? '🖼 ' : '📎 '}
                      {attachment.fileName}
                    </Text>
                    <Text style={styles.muted}>
                      Added{' '}
                      {new Date(attachment.createdAt).toLocaleDateString()}
                    </Text>
                  </View>

                  <Pressable
                    onPress={() =>
                      void deleteAttachment(note.id, attachment.id)
                    }
                    disabled={busyAttachment !== null}
                    style={styles.deleteButton}
                  >
                    <Text style={styles.deleteText}>Remove</Text>
                  </Pressable>
                </View>
              ))}

              <View style={styles.cardFooter}>
                <View style={styles.flexSpacer} />
                <Pressable
                  onPress={() => void deleteNote(note)}
                  style={styles.deleteButton}
                >
                  <Text style={styles.deleteText}>Delete note</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    padding: 24,
    gap: 12,
    width: '100%',
    maxWidth: 800,
    alignSelf: 'center',
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    lineHeight: 24,
  },
  form: {
    gap: 10,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#222',
    backgroundColor: '#fff',
  },
  contentInput: {
    minHeight: 100,
  },
  addButton: {
    backgroundColor: '#2563eb',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.7,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: '#c62828',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 12,
  },
  empty: {
    color: '#666',
    fontSize: 15,
    paddingVertical: 16,
  },
  noteCard: {
    gap: 10,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
  },
  noteTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#222',
  },
  noteContent: {
    fontSize: 15,
    lineHeight: 22,
    color: '#444',
  },
  noteDate: {
    fontSize: 12,
    color: '#777',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#2563eb',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  secondaryButtonText: {
    color: '#1d4ed8',
    fontWeight: '600',
  },
  attachmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 10,
  },
  attachmentText: {
    flex: 1,
    gap: 4,
  },
  attachmentName: {
    fontSize: 14,
    color: '#333',
  },
  muted: {
    fontSize: 12,
    color: '#777',
  },
  deleteButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  deleteText: {
    color: '#c62828',
    fontWeight: '600',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 6,
  },
  flexSpacer: {
    flex: 1,
  },
});
