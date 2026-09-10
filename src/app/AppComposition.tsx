import { Image, KeyboardAvoidingView, View } from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ForumSessionEpochProvider } from '@/platform/media/mediaSessionEpoch';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { StartupPageLayoutProvider } from '@/ui/navigation/startupPageLayout';
import { AppRoutes } from './AppRoutes';
import { useAppRuntime } from './useAppRuntime';
import { useAppStartupRuntime } from './useAppStartupRuntime';

export function AppComposition() {
  const runtime = useAppRuntime();
  const startup = useAppStartupRuntime(runtime.routes?.onReady);
  return (
    <ReaderStyleProvider value={runtime.readerStyleContext}>
      <ForumSessionEpochProvider
        sessionEpochs={runtime.sessionEpochs}
        transportIdentity={runtime.mediaTransportIdentity}
      >
        <GestureHandlerRootView style={runtime.appStyles.screen}>
          <SafeAreaProvider>
            <KeyboardAvoidingView style={runtime.appStyles.screen}>
              <SafeAreaView edges={['left', 'right']} style={runtime.appStyles.screen}>
                <ExpoStatusBar style={runtime.theme.dark ? 'light' : 'dark'} />
                <View pointerEvents="none" style={runtime.appStyles.statusBarScrim} />
                {runtime.accountHost}
                {runtime.routes ? (
                  <StartupPageLayoutProvider value={startup.onLayout}>
                    <AppRoutes
                      {...runtime.routes}
                      onReady={startup.onReady}
                      onScreenChange={(screen, routeKey) => {
                        runtime.routes?.onScreenChange(screen, routeKey);
                        startup.onRouteChange();
                      }}
                    />
                  </StartupPageLayoutProvider>
                ) : (
                  <View
                    accessible
                    accessibilityLabel="阅坛正在启动"
                    accessibilityLiveRegion="polite"
                    accessibilityState={{ busy: true }}
                    role="status"
                    style={runtime.appStyles.bootstrap}
                  >
                    <Image
                      accessible={false}
                      source={startup.iconSource}
                      resizeMode="contain"
                      style={runtime.appStyles.bootstrapIcon}
                    />
                  </View>
                )}
              </SafeAreaView>
            </KeyboardAvoidingView>
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </ForumSessionEpochProvider>
    </ReaderStyleProvider>
  );
}
