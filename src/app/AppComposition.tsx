import { KeyboardAvoidingView, View } from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AccountHosts } from '@/features/account/AccountHosts';
import { ForumSessionEpochProvider } from '@/platform/media/mediaSessionEpoch';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { AppRoutes } from './AppRoutes';
import { useAppRuntime } from './useAppRuntime';

export function AppComposition() {
  const runtime = useAppRuntime();
  return (
    <ReaderStyleProvider value={runtime.readerStyleContext}>
      <ForumSessionEpochProvider sessionEpochs={runtime.sessionEpochs}>
        <GestureHandlerRootView style={runtime.appStyles.screen}>
          <SafeAreaProvider>
            <KeyboardAvoidingView style={runtime.appStyles.screen}>
              <SafeAreaView edges={['left', 'right']} style={runtime.appStyles.screen}>
                <ExpoStatusBar style={runtime.theme.dark ? 'light' : 'dark'} />
                <View pointerEvents="none" style={runtime.appStyles.statusBarScrim} />
                <AccountHosts {...runtime.accountHosts} />
                {runtime.routes ? <AppRoutes {...runtime.routes} /> : null}
              </SafeAreaView>
            </KeyboardAvoidingView>
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </ForumSessionEpochProvider>
    </ReaderStyleProvider>
  );
}
