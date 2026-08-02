import { StyleSheet } from 'react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';

export function createAccountHostStyles(theme: ReaderTheme, settings: ReaderSettings) {
  const fontFamily = fontFamilyValue(settings.fontFamily);
  return StyleSheet.create({
    actions: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8
    },
    flex: {
      flex: 1
    },
    hiddenBrowserWebView: {
      flex: 0,
      width: 1,
      height: 1,
      opacity: 0,
      backgroundColor: 'transparent'
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
    meta: {
      color: theme.muted,
      fontFamily,
      fontSize: 12,
      lineHeight: 17
    },
    webViewErrorPlaceholder: {
      flex: 1,
      backgroundColor: theme.surface
    }
  });
}

export type AccountHostStyles = ReturnType<typeof createAccountHostStyles>;
