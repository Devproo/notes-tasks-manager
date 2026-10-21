import { useUser } from '@clerk/expo';
import { useEffect, useState } from 'react';

import { useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';

import {
  enqueueSyncOperation,
  getPendingSyncOperations,
  removeSyncedOperation,
} from '@/database/sync-queue';

import { getDatabase } from '@/database/database';
import TaskAttachments from '@/features/attachments/TaskAttachments';
import type { Task, TaskPriority, TaskStatus } from '@/types/models';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type TaskRow = {
  id: string;
  user_id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  created_at: string;
  updated_at: string;
};

const statuses: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

const priorities: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default function TasksScreen() {
  const { isLoaded, user } = useUser();
  const userId = user?.id;

  const saveCloudTask = useMutation(api.tasks.save);
  const removeCloudTask = useMutation(api.tasks.remove);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function loadTasks(currentUserId: string) {
    const db = await getDatabase();
    const rows = await db.getAllAsync<TaskRow>(
      `SELECT id, user_id, title, description, status, priority,
              due_date, created_at, updated_at
       FROM tasks
       WHERE user_id = ?
       ORDER BY
         CASE status
           WHEN 'todo' THEN 0
           WHEN 'in_progress' THEN 1
           ELSE 2
         END,
         updated_at DESC`,
      currentUserId,
    );

    setTasks(rows.map(mapTask));
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!userId) {
        setTasks([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');

      try {
        const db = await getDatabase();
        const rows = await db.getAllAsync<TaskRow>(
          `SELECT id, user_id, title, description, status, priority,
                  due_date, created_at, updated_at
           FROM tasks
           WHERE user_id = ?
           ORDER BY updated_at DESC`,
          userId,
        );

        if (!cancelled) setTasks(rows.map(mapTask));
      } catch {
        if (!cancelled) setError('Could not load tasks.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (isLoaded) void load();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, userId]);

  async function createTask() {
    if (!userId || saving) return;

    const taskTitle = title.trim();
    if (!taskTitle) {
      setError('Enter a task title first.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const db = await getDatabase();
      const now = new Date().toISOString();
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const task: Task = {
        id,
        userId,
        title: taskTitle,
        description: description.trim(),
        status: 'todo',
        priority,
        dueDate: null,
        createdAt: now,
        updatedAt: now,
      };

      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `INSERT INTO tasks
            (id, user_id, title, description, status, priority,
             due_date, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          task.id,
          userId,
          task.title,
          task.description,
          task.status,
          task.priority,
          task.dueDate,
          task.createdAt,
          task.updatedAt,
        );

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
            dueDate: task.dueDate,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          },
        });
      });

      setTasks((current) => [task, ...current]);
      setTitle('');
      setDescription('');
      setPriority('medium');

      try {
        await saveCloudTask({
          clientId: task.id,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        });

        const pending = await getPendingSyncOperations(db, userId);
        const queued = pending.find(
          (item) =>
            item.entity_type === 'task' &&
            item.client_id === task.id &&
            item.operation === 'save',
        );

        if (queued) await removeSyncedOperation(db, queued);
      } catch {
        setError('Task saved locally. Cloud sync is pending.');
      }
    } catch {
      setError('Could not save the task. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(task: Task, status: TaskStatus) {
    if (!userId || task.status === status) return;

    setError('');

    const now = new Date().toISOString();
    const updatedTask: Task = {
      ...task,
      status,
      updatedAt: now,
    };

    try {
      const db = await getDatabase();

      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `UPDATE tasks
           SET status = ?, updated_at = ?
           WHERE id = ? AND user_id = ?`,
          status,
          now,
          task.id,
          userId,
        );

        await enqueueSyncOperation(db, {
          userId,
          entityType: 'task',
          clientId: task.id,
          operation: 'save',
          payload: {
            title: updatedTask.title,
            description: updatedTask.description,
            status: updatedTask.status,
            priority: updatedTask.priority,
            dueDate: updatedTask.dueDate,
            createdAt: updatedTask.createdAt,
            updatedAt: updatedTask.updatedAt,
          },
        });
      });

      setTasks((current) =>
        current
          .map((item) => (item.id === task.id ? updatedTask : item))
          .sort((a, b) => {
            const order: Record<TaskStatus, number> = {
              todo: 0,
              in_progress: 1,
              done: 2,
            };
            return order[a.status] - order[b.status];
          }),
      );

      try {
        await saveCloudTask({
          clientId: updatedTask.id,
          title: updatedTask.title,
          description: updatedTask.description,
          status: updatedTask.status,
          priority: updatedTask.priority,
          dueDate: updatedTask.dueDate,
          createdAt: updatedTask.createdAt,
          updatedAt: updatedTask.updatedAt,
        });

        const pending = await getPendingSyncOperations(db, userId);
        const queued = pending.find(
          (item) =>
            item.entity_type === 'task' &&
            item.client_id === task.id &&
            item.operation === 'save' &&
            item.updated_at === now,
        );

        if (queued) await removeSyncedOperation(db, queued);
      } catch {
        setError('Status updated locally. Cloud sync is pending.');
      }
    } catch {
      setError('Could not update task status.');
    }
  }

  async function deleteTask(id: string) {
    if (!userId) return;

    setError('');

    try {
      const db = await getDatabase();

      await db.withTransactionAsync(async () => {
        await db.runAsync(
          'DELETE FROM tasks WHERE id = ? AND user_id = ?',
          id,
          userId,
        );

        await enqueueSyncOperation(db, {
          userId,
          entityType: 'task',
          clientId: id,
          operation: 'delete',
        });
      });

      setTasks((current) => current.filter((task) => task.id !== id));

      try {
        await removeCloudTask({ clientId: id });

        const pending = await getPendingSyncOperations(db, userId);
        const queued = pending.find(
          (item) =>
            item.entity_type === 'task' &&
            item.client_id === id &&
            item.operation === 'delete',
        );

        if (queued) await removeSyncedOperation(db, queued);
      } catch {
        setError('Task deleted locally. Cloud sync is pending.');
      }
    } catch {
      setError('Could not delete task locally.');
    }
  }

  if (!isLoaded || loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size='large' />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps='handled'
    >
      <Text style={styles.title}>Tasks</Text>
      <Text style={styles.subtitle}>
        Organize your work and keep track of what needs to get done.
      </Text>

      <View style={styles.form}>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder='Task title'
          placeholderTextColor='#888'
          maxLength={200}
          style={styles.input}
        />

        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder='Description (optional)'
          placeholderTextColor='#888'
          style={[styles.input, styles.descriptionInput]}
          multiline
        />

        <Text style={styles.fieldLabel}>Priority</Text>
        <View style={styles.options}>
          {priorities.map((item) => (
            <Pressable
              key={item.value}
              onPress={() => setPriority(item.value)}
              style={[
                styles.option,
                priority === item.value && styles.optionSelected,
              ]}
            >
              <Text
                style={[
                  styles.optionText,
                  priority === item.value && styles.optionTextSelected,
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          onPress={createTask}
          disabled={saving}
          style={[styles.addButton, saving && styles.buttonPressed]}
        >
          <Text style={styles.addButtonText}>
            {saving ? 'Saving...' : '+ Add task'}
          </Text>
        </Pressable>
      </View>

      {!!error && <Text style={styles.error}>{error}</Text>}

      <Text style={styles.sectionTitle}>Your tasks ({tasks.length})</Text>

      {tasks.length === 0 ? (
        <Text style={styles.empty}>
          No tasks yet. Add your first task above.
        </Text>
      ) : (
        tasks.map((task) => (
          <View
            key={task.id}
            style={styles.taskCard}
          >
            <View style={styles.taskHeader}>
              <View style={styles.taskText}>
                <Text
                  style={[
                    styles.taskTitle,
                    task.status === 'done' && styles.completedTitle,
                  ]}
                >
                  {task.title}
                </Text>
                {!!task.description && (
                  <Text style={styles.taskDescription}>{task.description}</Text>
                )}
              </View>

              <Pressable
                accessibilityRole='button'
                accessibilityLabel={`Delete ${task.title}`}
                onPress={() => void deleteTask(task.id)}
                style={styles.deleteButton}
              >
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            </View>

            <View style={styles.metaRow}>
              <Text style={styles.priorityText}>
                {task.priority.toUpperCase()} PRIORITY
              </Text>
              <Text style={styles.dateText}>
                {new Date(task.updatedAt).toLocaleDateString()}
              </Text>
            </View>

            <TaskAttachments
              userId={userId!}
              taskId={task.id}
            />

            <Text style={styles.fieldLabel}>Status</Text>
            <View style={styles.options}>
              {statuses.map((item) => (
                <Pressable
                  key={item.value}
                  onPress={() => void updateStatus(task, item.value)}
                  style={[
                    styles.statusOption,
                    task.status === item.value && styles.statusSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusText,
                      task.status === item.value && styles.statusTextSelected,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
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
  descriptionInput: {
    minHeight: 72,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555',
    marginTop: 4,
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  option: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  optionSelected: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  optionText: {
    color: '#444',
    fontWeight: '500',
  },
  optionTextSelected: {
    color: '#fff',
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
    paddingVertical: 16,
  },
  taskCard: {
    gap: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
  },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  taskText: {
    flex: 1,
    gap: 6,
  },
  taskTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#222',
  },
  completedTitle: {
    textDecorationLine: 'line-through',
    color: '#777',
  },
  taskDescription: {
    fontSize: 15,
    color: '#555',
    lineHeight: 22,
  },
  deleteButton: {
    padding: 6,
  },
  deleteText: {
    color: '#c62828',
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  priorityText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#555',
  },
  dateText: {
    fontSize: 12,
    color: '#777',
  },
  statusOption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  statusSelected: {
    backgroundColor: '#e8efff',
    borderColor: '#2563eb',
  },
  statusText: {
    color: '#555',
    fontSize: 13,
  },
  statusTextSelected: {
    color: '#1d4ed8',
    fontWeight: '600',
  },
});
