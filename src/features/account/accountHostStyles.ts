import { StyleSheet } from 'react-native';
import { type ReaderStyleSettings, fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';

export function createAccountHostStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const fontFamily = fontFamilyValue(settings.fontFamily);
  return StyleSheet.create({
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
    verificationStatus: {
      flexGrow: 1,
      padding: 24,
      justifyContent: 'center',
      gap: 12
    },
    verificationTitle: {
      color: theme.ink,
      fontFamily,
      fontSize: Math.round(20 * settings.fontScale),
      fontWeight: '600'
    },
    verificationBody: {
      color: theme.ink,
      fontFamily,
      fontSize: Math.round(14 * settings.fontScale),
      lineHeight: Math.round(22 * settings.fontScale)
    },
    verificationHint: {
      color: theme.muted,
      fontFamily,
      fontSize: Math.round(12 * settings.fontScale),
      lineHeight: Math.round(18 * settings.fontScale)
    },
    verificationResult: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingTop: 16,
      marginTop: 4,
      gap: 4
    },
    verificationResultLabel: {
      color: theme.muted,
      fontFamily,
      fontSize: Math.round(12 * settings.fontScale)
    },
    webViewErrorPlaceholder: {
      flex: 1,
      backgroundColor: theme.surface
    }
  });
}

export type AccountHostStyles = ReturnType<typeof createAccountHostStyles>;
