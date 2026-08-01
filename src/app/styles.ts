import { StyleSheet, StatusBar as NativeStatusBar } from 'react-native';
import { type ReaderTheme } from '@/ui/theme/tokens';
import type { SharedStyles } from '@/ui/theme/sharedStyles';
import type { LoginWebViewStyles } from '@/ui/navigation/loginWebViewStyles';

export function createAppStyles(sharedStyles: SharedStyles, theme: ReaderTheme) {
  return Object.assign(
    {},
    sharedStyles,
    StyleSheet.create({
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
      moreContentInner: {
        gap: 10,
        padding: 16,
        paddingTop: (NativeStatusBar.currentHeight ?? 0) + 4,
        paddingBottom: 124
      },
      hiddenBrowserWebViewHost: {
        position: 'absolute',
        top: 0,
        left: 0,
        width: 1,
        height: 1,
        overflow: 'hidden',
        opacity: 0,
        zIndex: -1,
        elevation: -1
      },
      hiddenBrowserWebView: {
        flex: 0,
        width: 1,
        height: 1,
        opacity: 0,
        backgroundColor: 'transparent'
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
    })
  );
}

export type AppStyles = ReturnType<typeof createAppStyles>;
export type AppHostStyles = AppStyles & LoginWebViewStyles;
