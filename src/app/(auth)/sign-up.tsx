import { useSignUp } from '@clerk/expo';
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

export default function SignUpScreen() {
  const { signUp, fetchStatus } = useSignUp();
  const router = useRouter();

  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const isLoading = fetchStatus === 'fetching';

  const finishSignUp = async () => {
    const { error } = await signUp.finalize({
      navigate: ({ session, decorateUrl }) => {
        if (session?.currentTask) return;
        router.replace(decorateUrl('/') as Href);
      },
    });

    if (error) {
      setErrorMessage(error.message);
    }
  };

  const handleSignUp = async () => {
    setErrorMessage('');

    const { error } = await signUp.password({
      emailAddress: emailAddress.trim(),
      password,
    });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    const { error: verificationError } =
      await signUp.verifications.sendEmailCode();

    if (verificationError) {
      setErrorMessage(verificationError.message);
      return;
    }

    setNeedsVerification(true);
  };

  const handleVerify = async () => {
    setErrorMessage('');

    const { error } = await signUp.verifications.verifyEmailCode({
      code: code.trim(),
    });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    await finishSignUp();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        {needsVerification ? 'Verify your email' : 'Create your account'}
      </Text>

      <Text style={styles.subtitle}>
        {needsVerification
          ? 'Enter the verification code sent to your email.'
          : 'Sign up for your Notes & Tasks account.'}
      </Text>

      {needsVerification ? (
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={setCode}
          placeholder='Email verification code'
          keyboardType='number-pad'
          autoCapitalize='none'
        />
      ) : (
        <>
          <TextInput
            style={styles.input}
            value={emailAddress}
            onChangeText={setEmailAddress}
            placeholder='Email address'
            keyboardType='email-address'
            autoCapitalize='none'
            autoComplete='email'
          />

          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder='Password'
            secureTextEntry
            autoComplete='new-password'
          />
        </>
      )}

      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      <Pressable
        style={[styles.button, isLoading && styles.disabled]}
        onPress={needsVerification ? handleVerify : handleSignUp}
        disabled={
          isLoading ||
          (needsVerification ? !code.trim() : !emailAddress.trim() || !password)
        }
      >
        {isLoading ? (
          <ActivityIndicator color='#fff' />
        ) : (
          <Text style={styles.buttonText}>
            {needsVerification ? 'Verify and continue' : 'Sign up'}
          </Text>
        )}
      </Pressable>

      {!needsVerification && (
        <View style={styles.linkRow}>
          <Text>Already have an account? </Text>
          <Link
            href='/(auth)/sign-in'
            style={styles.link}
          >
            Sign in
          </Link>
        </View>
      )}

      <View nativeID='clerk-captcha' />
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
