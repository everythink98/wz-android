import { StyleSheet, StatusBar as NativeStatusBar } from 'react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { type ReaderTheme, alphaColor, fontFamilyValue } from '@/ui/theme/tokens';

export function createFeedStyles(theme: ReaderTheme, settings: ReaderSettings) {
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  const radiusMd = 14;
  return StyleSheet.create({
    actions: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8
    },
    content: {
      flex: 1
    },
    errorBox: {
      gap: 8,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: radiusMd,
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
      gap: 6,
      backgroundColor: theme.surface,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 16,
      paddingTop: (NativeStatusBar.currentHeight ?? 0) + 8,
      paddingBottom: 6,
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
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 6,
      paddingVertical: 3
    },
    linuxDoFilterButtonPressed: {
      backgroundColor: theme.mist
    },
    linuxDoFilterButtonText: {
      flexShrink: 1,
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '700',
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
      borderRadius: 8,
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
      height: 1,
      backgroundColor: theme.line
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

export type FeedStyles = ReturnType<typeof createFeedStyles>;
