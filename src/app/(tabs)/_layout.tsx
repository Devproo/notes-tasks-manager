import { useUser } from '@clerk/expo';
import { useMutation } from 'convex/react';
import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { syncLocalData } from '@/database/sync';
import { api } from '../../../convex/_generated/api';

export default function TabsLayout() {
  const { isLoaded, user } = useUser();
  const userId = user?.id;

  const saveCloudNote = useMutation(api.notes.save);
  const removeCloudNote = useMutation(api.notes.remove);
  const saveCloudTask = useMutation(api.tasks.save);
  const removeCloudTask = useMutation(api.tasks.remove);

  useEffect(() => {
    if (!isLoaded || !userId) return;

    let cancelled = false;

    const runSync = () => {
      if (cancelled) return;

      void syncLocalData(userId, {
        saveNote: saveCloudNote,
        removeNote: removeCloudNote,
        saveTask: saveCloudTask,
        removeTask: removeCloudTask,
      });
    };

    runSync();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') runSync();
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [
    isLoaded,
    userId,
    saveCloudNote,
    removeCloudNote,
    saveCloudTask,
    removeCloudTask,
  ]);

  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen
        name='notes'
        options={{ title: 'Notes', tabBarLabel: 'Notes' }}
      />
      <Tabs.Screen
        name='tasks'
        options={{ title: 'Tasks', tabBarLabel: 'Tasks' }}
      />
      <Tabs.Screen
        name='settings'
        options={{ title: 'Settings', tabBarLabel: 'Settings' }}
      />
    </Tabs>
  );
}
