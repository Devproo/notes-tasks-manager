import { useSignIn } from '@clerk/expo';
import { Link, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

export default function SignInScreen() {
  const { signIn, fetchStatus } = useSignIn();
  const router = useRouter();

  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const isLoading = fetchStatus === 'fetching';

  const finishSignIn = async () => {
    await signIn.finalize({
      navigate: ({ session, decorateUrl }) => {
        if (session?.currentTask) return;
        router.replace(decorateUrl('/') as Href);
      },
    });
  };

  const handleSignIn = async () => {
    setErrorMessage('');

    const { error } = await signIn.password({
      emailAddress: emailAddress.trim(),
      password,
    });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    if (signIn.status === 'complete') {
      await finishSignIn();
      return;
    }

    if (signIn.status === 'needs_client_trust') {
      const emailFactor = signIn.supportedSecondFactors.find(
        (factor) => factor.strategy === 'email_code',
      );

      if (emailFactor) {
        const { error: codeError } = await signIn.mfa.sendEmailCode();

        if (codeError) {
          setErrorMessage(codeError.message);
          return;
        }

        setNeedsCode(true);
      } else {
        setErrorMessage('Additional verification is required.');
      }

      return;
    }

    setErrorMessage('Additional sign-in verification is required.');
  };

  const handleVerifyCode = async () => {
    setErrorMessage('');

    const { error } = await signIn.mfa.verifyEmailCode({ code });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    if (signIn.status === 'complete') {
      await finishSignIn();
    } else {
      setErrorMessage('Verification is not complete yet.');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        {needsCode ? 'Verify your sign-in' : 'Welcome back'}
      </Text>

      <Text style={styles.subtitle}>
        {needsCode
          ? 'Enter the verification code sent to your email.'
          : 'Sign in to your Notes & Tasks account.'}
      </Text>

      {needsCode ? (
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={setCode}
          placeholder="Verification code"
          keyboardType="number-pad"
          autoCapitalize="none"
        />
      ) : (
        <>
          <TextInput
            style={styles.input}
            value={emailAddress}
            onChangeText={setEmailAddress}
            placeholder="Email address"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />

          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            secureTextEntry
            autoComplete="current-password"
          />
        </>
      )}

      {errorMessage ? (
        <Text style={styles.error}>{errorMessage}</Text>
      ) : null}

      <Pressable
        style={[styles.button, isLoading && styles.disabled]}
        onPress={needsCode ? handleVerifyCode : handleSignIn}
        disabled={
          isLoading ||
          (needsCode
            ? !code.trim()
            : !emailAddress.trim() || !password)
        }
      >
        {isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>
            {needsCode ? 'Verify code' : 'Sign in'}
          </Text>
        )}
      </Pressable>

      {!needsCode && (
        <View style={styles.linkRow}>
          <Text>Don't have an account? </Text>
          <Link href="/(auth)/sign-up" style={styles.link}>
            Sign up
          </Link>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 14,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 15,
    color: '#666',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
  },
  disabled: {
    opacity: 0.55,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: '#c62828',
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 8,
  },
  link: {
    color: '#2563eb',
    fontWeight: '600',
  },
});
