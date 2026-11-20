import { StyleSheet, StatusBar as NativeStatusBar } from 'react-native';
import { readerRadii, type ReaderStyleSettings, type ReaderTheme, fontFamilyValue } from '@/ui/theme/tokens';

export function createSearchStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  const filterLabelWidth = Math.round(92 * settings.fontScale);
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
    meta: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      lineHeight: 17
    },
    searchFilterActions: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 8,
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingTop: 5
    },
    searchFilterReset: {
      justifyContent: 'center',
      minWidth: 48,
      minHeight: 48
    },
    searchFilterBody: {
      flexGrow: 0,
      flexShrink: 1
    },
    searchFilterHeader: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center'
    },
    searchFilterHeading: {
      flex: 1,
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'baseline',
      columnGap: 10
    },
    searchFilterTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: Math.round(19 * settings.fontScale),
      lineHeight: Math.round(25 * settings.fontScale),
      fontWeight: '700',
      includeFontPadding: false
    },
    searchFilterSite: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: Math.round(13 * settings.fontScale),
      lineHeight: Math.round(18 * settings.fontScale),
      includeFontPadding: false
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
      paddingTop: (NativeStatusBar.currentHeight ?? 0) + 10,
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
    searchInputShell: {
      minWidth: 0,
      minHeight: 48,
      alignItems: 'center',
      flexDirection: 'row',
      backgroundColor: theme.background,
      borderColor: theme.line,
      borderRadius: readerRadii.control,
      borderWidth: StyleSheet.hairlineWidth,
      paddingRight: 4
    },
    searchInput: {
      flex: 1,
      minWidth: 0,
      minHeight: 48,
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 15 * settings.fontScale,
      lineHeight: 22 * settings.fontScale,
      includeFontPadding: false,
      textAlignVertical: 'center',
      paddingHorizontal: 0,
      paddingVertical: 0
    },
    searchInputActions: { flexDirection: 'row', alignItems: 'center' },
    searchSubmitSlot: {
      minHeight: 48,
      justifyContent: 'center',
      borderLeftColor: theme.line,
      borderLeftWidth: StyleSheet.hairlineWidth
    },
    searchScopeBar: {
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth
    },
    searchFilterTrigger: {
      minHeight: 48,
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 8
    },
    searchFilterTriggerActive: {
      backgroundColor: theme.mist,
      borderRadius: readerRadii.control
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
      color: theme.dark ? theme.primary : theme.primaryStrong,
      fontWeight: '600'
    },
    searchFilterLabel: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: Math.round(14 * settings.fontScale),
      fontWeight: '600',
      lineHeight: Math.round(20 * settings.fontScale),
      includeFontPadding: false
    },
    searchFilterRow: {
      minHeight: 48,
      alignItems: 'center',
      flexDirection: 'row',
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth
    },
    searchFilterRowInvalid: { borderBottomColor: theme.danger },
    searchFilterFieldError: {
      color: theme.danger,
      fontFamily: appFontFamily,
      fontSize: Math.round(12 * settings.fontScale),
      lineHeight: Math.round(17 * settings.fontScale),
      includeFontPadding: false,
      marginLeft: filterLabelWidth,
      paddingVertical: 6
    },
    searchFilterRowMain: {
      flex: 1,
      minWidth: 0,
      minHeight: 48,
      alignItems: 'center',
      flexDirection: 'row'
    },
    searchFilterLabelColumn: {
      width: filterLabelWidth,
      paddingRight: 8
    },
    searchFilterInputLabel: {
      justifyContent: 'center',
      minHeight: 48
    },
    searchFilterTextInput: {
      flex: 1,
      minWidth: 0,
      minHeight: 48,
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: Math.round(14 * settings.fontScale),
      lineHeight: Math.round(20 * settings.fontScale),
      includeFontPadding: false,
      paddingHorizontal: 0,
      paddingVertical: 0
    },
    searchFilterTrailing: {
      width: 48,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center'
    },
    searchFilterValue: {
      flex: 1,
      minWidth: 0,
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: Math.round(14 * settings.fontScale),
      lineHeight: Math.round(20 * settings.fontScale),
      includeFontPadding: false,
      paddingVertical: 9
    },
    searchFilterSegmentRow: { flexWrap: 'wrap' },
    searchFilterSegments: {
      backgroundColor: theme.surface2,
      borderRadius: readerRadii.control,
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: 'hidden',
      flexGrow: 1,
      flexShrink: 1,
      maxWidth: '100%',
      minWidth: 0,
      flexDirection: 'row',
      marginVertical: 6
    },
    searchFilterSegment: {
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 0,
      minHeight: 48,
      alignItems: 'center',
      flexDirection: 'row',
      columnGap: 5,
      paddingHorizontal: 8,
      paddingVertical: 6
    },
    searchFilterSegmentDivider: {
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: theme.line
    },
    searchFilterSegmentSelected: { backgroundColor: theme.surface },
    searchFilterSegmentMark: {
      width: 14
    },
    searchFilterSegmentText: {
      flexShrink: 1,
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: Math.round(13 * settings.fontScale),
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: Math.round(18 * settings.fontScale)
    },
    searchFilterOptionCopy: { flex: 1, minWidth: 0, rowGap: 3, paddingVertical: 9 },
    searchFilterCheckbox: {
      width: 16,
      height: 16,
      borderRadius: 3,
      borderWidth: 1,
      borderColor: theme.muted,
      alignItems: 'center',
      justifyContent: 'center'
    },
    searchFilterCheckboxChecked: { borderColor: theme.ink },
    searchFilterActiveText: {
      color: theme.ink
    },
    searchFilterCandidateInput: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      paddingLeft: 12,
      paddingRight: 2,
      backgroundColor: theme.background,
      borderColor: theme.line,
      borderRadius: readerRadii.control,
      borderWidth: StyleSheet.hairlineWidth
    },
    searchFilterDetail: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: Math.round(12 * settings.fontScale),
      includeFontPadding: false,
      lineHeight: Math.round(17 * settings.fontScale)
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
