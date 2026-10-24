import { StyleSheet } from 'react-native';
import {
  alphaColor,
  readerRadii,
  type ReaderStyleSettings,
  type ReaderTheme,
  fontFamilyValue
} from '@/ui/theme/tokens';

export function createLoginWebViewStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  return StyleSheet.create({
    loginWebViewModal: {
      flex: 1,
      backgroundColor: theme.surface
    },
    loginWebViewChrome: {
      zIndex: 1,
      backgroundColor: theme.surface,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth
    },
    loginWebViewHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'space-between',
      minHeight: 64,
      paddingLeft: 20,
      paddingRight: 8,
      paddingVertical: 8,
      backgroundColor: theme.surface
    },
    loginWebViewTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: Math.round(17 * settings.fontScale),
      fontWeight: '600'
    },
    loginWebViewTitleBlock: {
      flex: 1,
      gap: 3,
      paddingVertical: 2
    },
    loginWebViewSubtitle: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: Math.round(12 * settings.fontScale),
      lineHeight: Math.round(18 * settings.fontScale)
    },
    loginWebViewToolbar: {
      flexGrow: 0,
      flexShrink: 0,
      backgroundColor: theme.surface
    },
    toolbarContent: {
      paddingHorizontal: 12,
      paddingBottom: 8
    },
    action: {
      minWidth: 48,
      maxWidth: '100%',
      borderRadius: 0,
      backgroundColor: 'transparent'
    },
    actionPrimary: {
      backgroundColor: theme.primaryStrong,
      borderRadius: readerRadii.control
    },
    iconAction: {
      width: 48,
      height: 48,
      margin: 0,
      borderRadius: 0,
      backgroundColor: 'transparent'
    },
    actionContent: {
      minHeight: 48
    },
    actionLabel: {
      fontFamily: appFontFamily,
      fontSize: Math.round(14 * settings.fontScale),
      lineHeight: Math.round(20 * settings.fontScale),
      includeFontPadding: false,
      fontWeight: '500',
      letterSpacing: 0,
      marginHorizontal: 8,
      marginVertical: 10
    },
    loginWebViewBody: {
      flex: 1,
      backgroundColor: theme.surface
    },
    loginWebViewFooter: {
      flexShrink: 0,
      paddingHorizontal: 20,
      paddingVertical: 12,
      gap: 12,
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.surface
    },
    footerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12
    },
    primaryAction: {
      flex: 1
    },
    loading: {
      position: 'absolute',
      zIndex: 1,
      top: 12,
      left: 20,
      right: 20,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: theme.surface,
      borderColor: alphaColor(theme.primary, 0.18),
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 10
    },
    loadingText: {
      flexShrink: 1,
      color: theme.dark ? theme.primary : theme.primaryStrong,
      fontFamily: appFontFamily,
      fontSize: Math.round(12 * settings.fontScale),
      lineHeight: Math.round(18 * settings.fontScale)
    },
    errorBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      marginHorizontal: 20,
      marginBottom: 12,
      backgroundColor: alphaColor(theme.danger, theme.dark ? 0.08 : 0.035),
      borderColor: alphaColor(theme.danger, 0.12),
      borderRadius: readerRadii.control,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 12
    },
    errorText: {
      flex: 1,
      color: theme.danger,
      fontFamily: appFontFamily,
      fontSize: Math.round(13 * settings.fontScale),
      lineHeight: Math.round(19 * settings.fontScale)
    },
    actions: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'nowrap',
      gap: 12
    }
  });
}
