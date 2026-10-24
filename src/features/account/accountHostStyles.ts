import { StyleSheet } from 'react-native';
import {
  type ReaderStyleSettings,
  alphaColor,
  fontFamilyValue,
  readerRadii,
  type ReaderTheme
} from '@/ui/theme/tokens';

export function createAccountHostStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const fontFamily = fontFamilyValue(settings.fontFamily);
  const success = theme.dark ? '#3DD68C' : '#218358';
  return StyleSheet.create({
    flex: {
      flex: 1
    },
    webView: {
      flex: 1,
      backgroundColor: theme.surface
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
      backgroundColor: theme.surface,
      flexGrow: 1,
      padding: 24,
      justifyContent: 'center',
      gap: 12
    },
    verificationContent: {
      alignSelf: 'center',
      width: '100%',
      maxWidth: 440,
      gap: 12
    },
    verificationStatusIcon: {
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'flex-start',
      width: 52,
      height: 52,
      borderRadius: readerRadii.surface,
      backgroundColor: theme.primarySoft,
      marginBottom: 8
    },
    verificationAccent: { color: theme.primary },
    verificationSuccess: { color: success },
    verificationWarning: { color: theme.warning },
    verificationSuccessBackground: { backgroundColor: alphaColor(success, theme.dark ? 0.12 : 0.08) },
    verificationWarningBackground: { backgroundColor: alphaColor(theme.warning, theme.dark ? 0.12 : 0.08) },
    verificationTitle: {
      color: theme.ink,
      fontFamily,
      fontSize: Math.round(20 * settings.fontScale),
      fontWeight: '600'
    },
    verificationBody: {
      color: theme.muted,
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
      gap: 6
    },
    verificationResultHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8
    },
    verificationResultBody: {
      marginLeft: 26
    },
    verificationResultLabel: {
      flex: 1,
      color: theme.ink,
      fontFamily,
      fontSize: Math.round(14 * settings.fontScale),
      fontWeight: '500'
    },
    webViewErrorPlaceholder: {
      flex: 1,
      backgroundColor: theme.surface
    }
  });
}

export type AccountHostStyles = ReturnType<typeof createAccountHostStyles>;
