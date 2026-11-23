import { StyleSheet, StatusBar as NativeStatusBar } from 'react-native';
import { READER_APP_FONT_FAMILY, textSizeStyle, type ReaderTheme } from '@/ui/theme/tokens';

export function createAppStyles(theme: ReaderTheme, fontFamily: string = READER_APP_FONT_FAMILY, uiFontScale = 1) {
  return StyleSheet.create({
    headerTitle: { fontFamily, ...textSizeStyle(Math.round(20 * uiFontScale)), fontWeight: '600' },
    screen: {
      flex: 1,
      backgroundColor: theme.background
    },
    bootstrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#ffffff'
    },
    bootstrapIcon: {
      width: 200,
      height: 200
    },
    navItem: {
      flex: 1,
      alignItems: 'stretch' as const,
      justifyContent: 'center' as const,
      minHeight: 48,
      borderRadius: 6
    },
    statusBarScrim: {
      position: 'absolute',
      top: 0,
      right: 0,
      left: 0,
      height: NativeStatusBar.currentHeight ?? 0,
      backgroundColor: theme.surface,
      zIndex: 20,
      elevation: 0
    },
    nav: {
      height: 'auto',
      flexDirection: 'row' as const,
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.surface,
      elevation: 0,
      paddingHorizontal: 10,
      paddingTop: 4
    },
    navOverlay: {
      position: 'absolute',
      backgroundColor: 'transparent',
      borderTopColor: theme.dark ? '#2B2D30' : '#ECEEF0'
    }
  });
}

export type AppStyles = ReturnType<typeof createAppStyles>;
