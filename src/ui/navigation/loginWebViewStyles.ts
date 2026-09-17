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
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'space-between',
      paddingLeft: 16,
      paddingRight: 8,
      paddingVertical: 4,
      backgroundColor: theme.surface
    },
    loginWebViewTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: Math.round(15 * settings.fontScale),
      fontWeight: '600'
    },
    loginWebViewTitleBlock: {
      flex: 1,
      gap: 2
    },
    loginWebViewSubtitle: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: Math.round(11 * settings.fontScale)
    },
    loginWebViewToolbar: {
      flexGrow: 0,
      flexShrink: 0,
      backgroundColor: theme.surface,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth
    },
    toolbarContent: {
      paddingHorizontal: 12,
      paddingBottom: 4
    },
    action: {
      minHeight: 32,
      minWidth: 32,
      paddingHorizontal: 8,
      paddingVertical: 5,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      borderRadius: 6
    },
    actionPrimary: {
      backgroundColor: theme.primaryStrong
    },
    actionIcon: {
      paddingHorizontal: 0
    },
    actionDimmed: {
      opacity: 0.5
    },
    actionText: {
      fontFamily: appFontFamily,
      fontSize: Math.round(13 * settings.fontScale),
      fontWeight: '600'
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
