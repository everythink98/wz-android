import { StyleSheet, StatusBar as NativeStatusBar } from 'react-native';
import { type ReaderTheme } from '@/ui/theme/tokens';

export function createAppStyles(theme: ReaderTheme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.background
    },
    navItem: {
      flex: 1,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      gap: 3,
      minHeight: 48,
      borderRadius: 6
    },
    statusBarScrim: {
      position: 'absolute',
      top: 0,
      right: 0,
      left: 0,
      height: NativeStatusBar.currentHeight ?? 0,
      backgroundColor: theme.background,
      zIndex: 20,
      elevation: 0
    },
    statusBarScrimBelowOverlay: {
      zIndex: 0,
      elevation: 0
    },
    nav: {
      flexDirection: 'row' as const,
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.surface,
      elevation: 0,
      paddingHorizontal: 10,
      paddingTop: 4
    }
  });
}

export type AppStyles = ReturnType<typeof createAppStyles>;
