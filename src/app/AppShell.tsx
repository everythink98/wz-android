import type { ComponentProps } from 'react';
import { View } from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import type { createStyles, ReaderTheme } from '../theme';
import { AppNavigator } from './AppNavigator';
import { AppProviders } from './AppProviders';
import { GlobalModalHost } from './GlobalModalHost';
import { HiddenBrowserHost } from './HiddenBrowserHost';

type AppShellProps = {
  globalModalProps: ComponentProps<typeof GlobalModalHost>;
  hiddenBrowserProps: ComponentProps<typeof HiddenBrowserHost>;
  navigationProps: ComponentProps<typeof AppNavigator>;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
};

export function AppShell({
  globalModalProps,
  hiddenBrowserProps,
  navigationProps,
  styles,
  theme
}: AppShellProps) {
  return (
    <AppProviders styles={styles}>
      <ExpoStatusBar style={theme.dark ? 'light' : 'dark'} />
      <View pointerEvents="none" style={styles.statusBarScrim} />
      <HiddenBrowserHost {...hiddenBrowserProps} />
      <GlobalModalHost {...globalModalProps} />
      <AppNavigator {...navigationProps} />
    </AppProviders>
  );
}
