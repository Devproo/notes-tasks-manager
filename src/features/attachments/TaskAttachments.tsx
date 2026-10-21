import {
  addAttachment,
  listAttachments,
  removeAttachment,
} from '@/database/attachments';
import type { Attachment } from '@/types/models';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type Props = {
  userId: string;
  taskId: string;
};

export default function TaskAttachments({ userId, taskId }: Props) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    setItems(await listAttachments({ userId, taskId }));
  }

  useEffect(() => {
    let cancelled = false;

    listAttachments({ userId, taskId })
      .then((result) => {
        if (!cancelled) setItems(result);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load attachments.');
      });

    return () => {
      cancelled = true;
    };
  }, [userId, taskId]);

  async function addPhoto() {
    if (busy) return;
    setBusy(true);
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
        taskId,
        uri: asset.uri,
        fileName: asset.fileName || `photo-${Date.now()}.jpg`,
        mimeType: asset.mimeType || 'image/jpeg',
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach photo.');
    } finally {
      setBusy(false);
    }
  }

  async function addFile() {
    if (busy) return;
    setBusy(true);
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
        taskId,
        uri: file.uri,
        fileName: file.name,
        mimeType: file.mimeType,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach file.');
    } finally {
      setBusy(false);
    }
  }

  async function openItem(item: Attachment) {
    setError('');

    try {
      if (Platform.OS === 'web') {
        const response = await fetch(item.uri);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = blobUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.click();

        setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
        return;
      }

      const supported = await Linking.canOpenURL(item.uri);
      if (!supported) {
        setError('No app can open this attachment.');
        return;
      }

      await Linking.openURL(item.uri);
    } catch {
      setError('Could not open this attachment.');
    }
  }

  async function removeItem(id: string) {
    if (busy) return;
    setBusy(true);
    setError('');

    try {
      await removeAttachment(id, userId);
      await refresh();
    } catch {
      setError('Could not remove attachment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Attachments ({items.length})</Text>

      <View style={styles.actions}>
        <Pressable
          onPress={() => void addPhoto()}
          disabled={busy}
          style={styles.button}
        >
          <Text style={styles.buttonText}>
            {busy ? 'Working...' : '+ Photo'}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => void addFile()}
          disabled={busy}
          style={styles.button}
        >
          <Text style={styles.buttonText}>+ File</Text>
        </Pressable>
      </View>

      {items.map((item) => (
        <View
          key={item.id}
          style={styles.attachment}
        >
          <Text style={styles.fileName}>
            {item.mimeType?.startsWith('image/') ? '🖼 ' : '📎 '}
            {item.fileName}
          </Text>

          <Pressable onPress={() => void openItem(item)}>
            <Text style={styles.openText}>Open</Text>
          </Pressable>

          <Pressable
            onPress={() => void removeItem(item.id)}
            disabled={busy}
          >
            <Text style={styles.removeText}>Remove</Text>
          </Pressable>
        </View>
      ))}

      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 10,
  },
  heading: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  button: {
    borderWidth: 1,
    borderColor: '#2563eb',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  buttonText: {
    color: '#1d4ed8',
    fontWeight: '600',
  },
  attachment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fileName: {
    flex: 1,
    fontSize: 13,
    color: '#333',
  },
  openText: {
    color: '#1d4ed8',
    fontSize: 13,
    fontWeight: '600',
  },
  removeText: {
    color: '#c62828',
    fontSize: 13,
    fontWeight: '600',
  },
  error: {
    color: '#c62828',
    fontSize: 13,
  },
});
