import { StyleSheet, StatusBar as NativeStatusBar } from 'react-native';
import {
  readerRadii,
  type ReaderStyleSettings,
  type ReaderTheme,
  alphaColor,
  fontFamilyValue
} from '@/ui/theme/tokens';

export function createFeedStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  return StyleSheet.create({
    actions: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8
    },
    content: {
      flex: 1,
      backgroundColor: theme.dark ? theme.surface : '#FFFFFF'
    },
    errorBox: {
      gap: 8,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: readerRadii.surface,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 12
    },
    errorText: {
      color: theme.danger,
      fontFamily: appFontFamily,
      fontSize: 13,
      lineHeight: 19
    },
    feedFloatingActions: {
      position: 'absolute',
      right: 16,
      bottom: 92,
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: 8,
      backgroundColor: 'transparent',
      zIndex: 4,
      elevation: 2
    },
    feedFixedHeader: {
      backgroundColor: theme.surface,
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 5,
      overflow: 'hidden',
      paddingHorizontal: 16,
      paddingTop: (NativeStatusBar.currentHeight ?? 0) + 8
    },
    feedSourceBar: {
      backgroundColor: 'transparent',
      elevation: 0,
      shadowOpacity: 0,
      borderBottomColor: theme.line,
      borderBottomWidth: 0
    },
    feedSourceRail: { paddingRight: 18 },
    feedSourceTab: { width: 'auto', minHeight: 48, padding: 0, paddingBottom: 6, justifyContent: 'center' },
    feedSourceLabel: {
      margin: 0,
      fontFamily: appFontFamily,
      fontSize: Math.round(14 * settings.fontScale),
      fontWeight: '600',
      textAlign: 'center'
    },
    feedSourceIndicator: { backgroundColor: theme.primary, height: 2 },
    feedSecondaryHeader: {
      backgroundColor: theme.surface,
      position: 'absolute',
      left: 0,
      right: 0,
      overflow: 'hidden',
      paddingHorizontal: 16,
      paddingTop: 0,
      paddingBottom: 0,
      borderBottomColor: theme.dark ? '#2B2D30' : '#ECEEF0',
      borderBottomWidth: StyleSheet.hairlineWidth,
      zIndex: 3,
      elevation: 0
    },
    feedSecondaryRow: {
      minHeight: 36,
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8
    },
    feedCategoryRailSlot: {
      flex: 1,
      minWidth: 0
    },
    linuxDoFilterButton: {
      minWidth: 62,
      maxWidth: 96,
      minHeight: 34,
      alignItems: 'center',
      flexDirection: 'row',
      flexShrink: 0,
      justifyContent: 'center',
      gap: 2,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderRadius: readerRadii.control,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 6,
      paddingVertical: 3
    },
    linuxDoFilterButtonText: {
      flexShrink: 1,
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '500',
      includeFontPadding: false,
      lineHeight: 16
    },
    linuxDoFilterMenu: {
      position: 'absolute',
      top: (NativeStatusBar.currentHeight ?? 0) + 96,
      right: 16,
      minWidth: 132,
      overflow: 'hidden',
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: readerRadii.surface,
      borderWidth: StyleSheet.hairlineWidth,
      elevation: 3
    },
    linuxDoFilterMenuSectionText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0,
      paddingHorizontal: 12,
      paddingTop: 6,
      paddingBottom: 2
    },
    linuxDoFilterMenuItem: {
      minHeight: 38,
      paddingVertical: 6
    },
    linuxDoFilterMenuItemText: {
      fontSize: 13,
      includeFontPadding: false,
      lineHeight: 18
    },
    linuxDoFilterMenuItemActive: {
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.16 : 0.06)
    },
    linuxDoFilterMenuItemTextActive: {
      color: theme.primary
    },
    feedPager: {
      flex: 1
    },
    feedListContentInner: {
      gap: 0,
      paddingHorizontal: 0,
      paddingTop: 0,
      paddingBottom: 96
    },
    topicListSeparator: {
      width: '100%',
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.dark ? '#2B2D30' : '#ECEEF0'
    },
    endOfListText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      lineHeight: 17,
      paddingVertical: 18,
      textAlign: 'center'
    }
  });
}
