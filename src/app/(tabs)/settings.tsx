import { useClerk, useUser } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';

import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export default function SettingsScreen() {
  const { signOut } = useClerk();
  const { user } = useUser();
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSignOut = async () => {
    setErrorMessage('');
    setIsSigningOut(true);

    try {
      await signOut();
      router.replace('/(auth)/sign-in');
    } catch {
      setErrorMessage('Could not sign out. Please try again.');
    } finally {
      setIsSigningOut(false);
    }
  };

  const convexIdentity = useQuery(api.authTest.currentUser);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.section}>
        <Text style={styles.label}>Signed in as</Text>

        <View style={styles.section}>
          <Text style={styles.label}>Convex authentication</Text>
          <Text style={styles.email}>
            {convexIdentity === undefined
              ? 'Checking connection...'
              : convexIdentity === null
                ? 'Not authenticated'
                : `Authenticated as ${convexIdentity.name ?? convexIdentity.subject}`}
          </Text>
        </View>

        <Text style={styles.email}>
          {user?.primaryEmailAddress?.emailAddress ?? 'Your account'}
        </Text>
      </View>

      <Text style={styles.subtitle}>
        Your notes and tasks will remain saved when you sign out.
      </Text>

      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      <Pressable
        accessibilityRole='button'
        style={[styles.button, isSigningOut && styles.disabled]}
        onPress={handleSignOut}
        disabled={isSigningOut}
      >
        {isSigningOut ? (
          <ActivityIndicator color='#fff' />
        ) : (
          <Text style={styles.buttonText}>Sign out</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
  },
  section: {
    gap: 6,
    padding: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
  },
  label: {
    color: '#666',
    fontSize: 14,
  },
  email: {
    fontSize: 16,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 15,
    color: '#666',
    lineHeight: 23,
  },
  button: {
    backgroundColor: '#b42318',
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
  },
  disabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: '#b42318',
  },
});
