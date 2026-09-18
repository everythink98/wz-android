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
import type { ReactNode } from 'react';
import { PortalProvider } from '@gorhom/portal';

export function AppFrame({
  children,
  styles,
  dark,
  onUserInteraction
}: {
  children: ReactNode;
  styles: ReturnType<typeof useAppRuntime>['appStyles'];
  dark: boolean;
  onUserInteraction?: () => void;
}) {
  return (
    <GestureHandlerRootView style={styles.screen} onTouchStart={onUserInteraction} onTouchMove={onUserInteraction}>
      <SafeAreaProvider>
        <KeyboardAvoidingView style={styles.screen}>
          <SafeAreaView edges={['left', 'right']} style={styles.screen}>
            <PortalProvider>
              <ExpoStatusBar style={dark ? 'light' : 'dark'} />
              <View pointerEvents="none" style={styles.statusBarScrim} />
              {children}
            </PortalProvider>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export function AppComposition() {
  const runtime = useAppRuntime();
  const startup = useAppStartupRuntime(runtime.routes?.onReady);
  return (
    <ReaderStyleProvider value={runtime.readerStyleContext}>
      <ForumSessionEpochProvider
        sessionEpochs={runtime.sessionEpochs}
        transportIdentity={runtime.mediaTransportIdentity}
      >
        <AppFrame styles={runtime.appStyles} dark={runtime.theme.dark} onUserInteraction={runtime.onUserInteraction}>
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
        </AppFrame>
      </ForumSessionEpochProvider>
    </ReaderStyleProvider>
  );
}
