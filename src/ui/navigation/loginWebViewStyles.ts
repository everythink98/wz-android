import { StyleSheet } from 'react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { type ReaderTheme, fontFamilyValue } from '@/ui/theme/tokens';

export function createLoginWebViewStyles(theme: ReaderTheme, settings: ReaderSettings) {
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  return StyleSheet.create({
    loginWebViewModal: {
      flex: 1,
      backgroundColor: theme.background
    },
    loginWebViewHeader: {
      alignItems: 'center',
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 12,
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 10
    },
    loginWebViewTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 16,
      fontWeight: '700'
    },
    loginWebViewTitleBlock: {
      flex: 1,
      gap: 2
    },
    loginWebViewSubtitle: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12
    },
    loginWebViewToolbar: {
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 8
    },
    loginWebViewBody: {
      flex: 1,
      backgroundColor: theme.surface
    },
    loading: {
      position: 'absolute',
      zIndex: 1,
      top: 14,
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      elevation: 1,
      paddingHorizontal: 12,
      paddingVertical: 8
    },
    loadingText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12
    },
    errorBox: {
      gap: 8,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 12
    },
    errorText: {
      color: theme.danger,
      fontFamily: appFontFamily,
      fontSize: 13,
      lineHeight: 19
    },
    actions: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8
    },
    webViewErrorPlaceholder: {
      flex: 1,
      backgroundColor: theme.surface
    }
  });
}

export type LoginWebViewStyles = ReturnType<typeof createLoginWebViewStyles>;
