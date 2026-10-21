import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { ConvexReactClient } from 'convex/react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import { Slot } from 'expo-router';

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;

if (!publishableKey) {
  throw new Error('Add your Clerk Publishable Key to the .env file');
}

if (!convexUrl) {
  throw new Error('Add EXPO_PUBLIC_CONVEX_URL to .env.local');
}

const convex = new ConvexReactClient(convexUrl);

export default function RootLayout() {
  return (
    <ClerkProvider
      publishableKey={publishableKey!}
      tokenCache={tokenCache}
    >
      <ConvexProviderWithClerk
        client={convex}
        useAuth={useAuth}
      >
        <Slot />
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
