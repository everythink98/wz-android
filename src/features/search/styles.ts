import { StyleSheet, StatusBar as NativeStatusBar } from 'react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { type ReaderTheme, alphaColor, fontFamilyValue } from '@/ui/theme/tokens';

export function createSearchStyles(theme: ReaderTheme, settings: ReaderSettings) {
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  const warningColor = theme.warning;
  const radiusSm = 10;
  const radiusMd = 14;
  return StyleSheet.create({
    actions: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8
    },
    authNoticeBox: {
      gap: 8,
      borderRadius: radiusMd,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 12
    },
    authNoticeBoxDanger: {
      backgroundColor: theme.surface2,
      borderColor: theme.line
    },
    authNoticeBoxNeutral: {
      backgroundColor: theme.surface2,
      borderColor: theme.line
    },
    authNoticeBoxWarning: {
      backgroundColor: theme.surface2,
      borderColor: theme.line
    },
    authNoticeText: {
      fontFamily: appFontFamily,
      fontSize: 13,
      lineHeight: 19
    },
    authNoticeTextDanger: {
      color: theme.danger
    },
    authNoticeTextNeutral: {
      color: theme.muted
    },
    authNoticeTextWarning: {
      color: warningColor
    },
    button: {
      minHeight: 40,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 6,
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: radiusSm,
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
    flex: {
      flex: 1
    },
    input: {
      minHeight: 42,
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: radiusSm,
      borderWidth: StyleSheet.hairlineWidth,
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 14,
      paddingHorizontal: 12,
      paddingVertical: 9
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
    searchFilterHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12
    },
    searchFilterTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 17,
      fontWeight: '700',
      lineHeight: 22
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
      fontSize: 17,
      fontWeight: '600'
    },
    stack: {
      gap: 10,
      width: '100%'
    },
    contentInner: {
      gap: 10,
      padding: 16,
      paddingTop: (NativeStatusBar.currentHeight ?? 0) + 4,
      paddingBottom: 96
    },
    searchInputShell: {
      minHeight: 48,
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      paddingLeft: 12,
      paddingRight: 6
    },
    searchInputIcon: {
      opacity: 0.76
    },
    searchInput: {
      flex: 1,
      minWidth: 0,
      minHeight: 46,
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 15,
      paddingHorizontal: 0,
      paddingVertical: 0
    },
    searchInlineButton: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 18
    },
    searchSubmitInlineButton: {
      width: 38,
      height: 32,
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.14 : 0.08),
      borderColor: alphaColor(theme.primary, theme.dark ? 0.24 : 0.16),
      borderRadius: radiusSm,
      borderWidth: StyleSheet.hairlineWidth
    },
    searchFilterEntry: {
      minHeight: 48,
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: 10,
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
      borderRadius: 6,
      backgroundColor: 'transparent'
    },
    searchFilterEntryText: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '700',
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
    searchSessionStatusBar: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8
    },
    searchSessionStatusChip: {
      minHeight: 34,
      maxWidth: '100%',
      alignItems: 'center',
      flexDirection: 'row',
      gap: 6,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 9,
      paddingVertical: 6
    },
    searchSessionStatusChipNeutral: {
      backgroundColor: 'transparent',
      borderColor: 'transparent'
    },
    searchSessionStatusChipWarning: {
      backgroundColor: alphaColor(warningColor, theme.dark ? 0.14 : 0.07),
      borderColor: alphaColor(warningColor, theme.dark ? 0.32 : 0.18)
    },
    searchSessionStatusChipDanger: {
      backgroundColor: alphaColor(theme.danger, theme.dark ? 0.14 : 0.07),
      borderColor: alphaColor(theme.danger, theme.dark ? 0.32 : 0.22)
    },
    searchSessionStatusDot: {
      width: 7,
      height: 7,
      borderRadius: 4
    },
    searchSessionStatusDotNeutral: {
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.48 : 0.34)
    },
    searchSessionStatusDotSuccess: {
      backgroundColor: theme.success
    },
    searchSessionStatusDotWarning: {
      backgroundColor: warningColor
    },
    searchSessionStatusDotDanger: {
      backgroundColor: theme.danger
    },
    searchSessionStatusSource: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '700',
      includeFontPadding: false,
      lineHeight: 17
    },
    searchSessionStatusText: {
      flexShrink: 1,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '500',
      includeFontPadding: false,
      lineHeight: 17
    },
    searchSessionStatusTextNeutral: {
      color: theme.muted
    },
    searchSessionStatusTextWarning: {
      color: warningColor
    },
    searchSessionStatusTextDanger: {
      color: theme.danger
    },
    searchFilterField: {
      gap: 8
    },
    searchFilterLabel: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '700',
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
      borderRadius: 9,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 8
    },
    searchFilterMoreText: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '700',
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
      borderRadius: 8,
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
    recentSearchList: {
      overflow: 'hidden',
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth
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
    removableChipShellDivided: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth
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
