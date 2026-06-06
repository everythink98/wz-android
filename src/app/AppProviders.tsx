import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { createStyles } from '../theme';

export function AppProviders({
  children,
  styles
}: {
  children: ReactNode;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <GestureHandlerRootView style={styles.screen}>
      <SafeAreaProvider>
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
            {children}
          </SafeAreaView>
        </KeyboardAvoidingView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
