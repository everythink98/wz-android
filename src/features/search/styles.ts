import { StyleSheet, StatusBar as NativeStatusBar } from 'react-native';
import {
  readerRadii,
  type ReaderStyleSettings,
  type ReaderTheme,
  alphaColor,
  fontFamilyValue
} from '@/ui/theme/tokens';

export function createSearchStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  return StyleSheet.create({
    button: {
      minHeight: 40,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 6,
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: readerRadii.control,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 5
    },
    buttonDisabled: {
      opacity: 0.45
    },
    buttonGhost: {
      backgroundColor: 'transparent',
      borderColor: 'transparent'
    },
    buttonText: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '600'
    },
    content: {
      flex: 1,
      backgroundColor: theme.surface
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
    flex: {
      flex: 1
    },
    input: {
      minHeight: 48
    },
    meta: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      lineHeight: 17
    },
    searchFilterActions: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingTop: 12
    },
    searchFilterBody: {
      flexGrow: 0
    },
    searchFilterBodyInner: {
      gap: 14,
      paddingBottom: 4
    },
    sectionHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 10
    },
    sectionTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: Math.round(20 * settings.fontScale),
      fontWeight: '600'
    },
    stack: {
      gap: 10,
      width: '100%'
    },
    contentInner: {
      padding: 16,
      paddingTop: (NativeStatusBar.currentHeight ?? 0) + 4,
      paddingBottom: 96
    },
    listHeader: {
      marginBottom: 10
    },
    listSeparator: {
      height: 10
    },
    searchTopicRow: {
      marginHorizontal: -16
    },
    searchInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    searchInputShell: {
      flex: 1,
      minWidth: 0,
      minHeight: 48,
      alignItems: 'center',
      flexDirection: 'row',
      backgroundColor: theme.background,
      borderColor: theme.line,
      borderRadius: readerRadii.control,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 0
    },
    searchInput: {
      flex: 1,
      minWidth: 0,
      minHeight: 46,
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 15 * settings.fontScale,
      lineHeight: 22 * settings.fontScale,
      includeFontPadding: false,
      textAlignVertical: 'center',
      paddingHorizontal: 0,
      paddingVertical: 0
    },
    searchFilterEntry: {
      minHeight: 48,
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: readerRadii.control,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 10,
      paddingVertical: 6
    },
    searchFilterEntryActive: {
      backgroundColor: theme.mist,
      borderColor: alphaColor(theme.primary, theme.dark ? 0.36 : 0.22)
    },
    searchFilterEntryIcon: {
      width: 22,
      height: 22,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: readerRadii.badge,
      backgroundColor: 'transparent'
    },
    searchFilterEntryText: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: 18
    },
    searchFilterEntrySummary: {
      flex: 1,
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '500',
      includeFontPadding: false,
      lineHeight: 17
    },
    searchFilterEntrySummaryActive: {
      color: theme.primary,
      fontWeight: '600'
    },
    searchFilterField: {
      gap: 8
    },
    searchFilterLabel: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '500',
      lineHeight: 18
    },
    searchFilterMoreButton: {
      minHeight: 38,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 10,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: readerRadii.control,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 8
    },
    searchFilterMoreText: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '500',
      lineHeight: 18
    },
    searchFilterOptionWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8
    },
    searchFilterOptionRow: {
      flexDirection: 'row',
      gap: 8,
      paddingRight: 4
    },
    searchFilterOption: {
      minHeight: 36,
      justifyContent: 'center',
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: readerRadii.control,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 11,
      paddingVertical: 3
    },
    searchFilterOptionActive: {
      backgroundColor: theme.mist,
      borderColor: alphaColor(theme.primary, theme.dark ? 0.36 : 0.22)
    },
    searchFilterOptionText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: 17
    },
    searchFilterOptionTextActive: {
      color: theme.primary,
      fontWeight: '700'
    },
    searchGroupHeader: {
      minHeight: 48,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 10,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingTop: 12,
      paddingBottom: 7
    },
    searchGroupTitleRow: {
      flex: 1,
      minWidth: 0,
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10
    },
    searchGroupTitleText: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '700',
      includeFontPadding: false,
      lineHeight: 18
    },
    searchGroupMetaText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '500',
      includeFontPadding: false,
      lineHeight: 17
    },
    searchGroupAction: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 2
    },
    searchGroupActionText: {
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: 17
    },
    searchGroupChevron: {
      opacity: 0.78
    },
    searchPaginationStatus: {
      alignItems: 'center',
      minHeight: 36,
      justifyContent: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8
    },
    chipWrap: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth
    },
    recentSearchItem: {
      overflow: 'hidden',
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderRightWidth: StyleSheet.hairlineWidth
    },
    recentSearchItemFirst: {
      borderTopLeftRadius: readerRadii.surface,
      borderTopRightRadius: readerRadii.surface,
      borderTopWidth: StyleSheet.hairlineWidth
    },
    recentSearchItemJoined: {
      borderTopWidth: StyleSheet.hairlineWidth
    },
    recentSearchItemLast: {
      borderBottomLeftRadius: readerRadii.surface,
      borderBottomRightRadius: readerRadii.surface,
      borderBottomWidth: StyleSheet.hairlineWidth
    },
    removableChip: {
      alignItems: 'center',
      flex: 1,
      flexDirection: 'row',
      gap: 10,
      minHeight: 48,
      paddingHorizontal: 12,
      paddingVertical: 8
    },
    removableChipIcon: {
      flexShrink: 0
    },
    removableChipText: {
      flex: 1,
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 14,
      fontWeight: '500',
      lineHeight: 20,
      minWidth: 0
    },
    removableChipShell: {
      alignItems: 'stretch',
      flexDirection: 'row',
      minHeight: 48
    },
    removableChipClose: {
      alignSelf: 'stretch',
      alignItems: 'center',
      justifyContent: 'center',
      width: 48,
      minHeight: 48
    }
  });
}

export type SearchStyles = ReturnType<typeof createSearchStyles>;
