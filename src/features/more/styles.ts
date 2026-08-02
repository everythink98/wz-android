import { StyleSheet, StatusBar as NativeStatusBar } from 'react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { type ReaderTheme, alphaColor, fontFamilyValue } from '@/ui/theme/tokens';
import { createMoreAccountStyles } from './accountStyles';
import { createLoginWebViewStyles } from '@/ui/navigation/loginWebViewStyles';

export function createMoreStyles(theme: ReaderTheme, settings: ReaderSettings) {
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  const radiusSm = 10;
  const radiusMd = 14;
  return StyleSheet.create({
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
    groupList: {
      gap: 7,
      backgroundColor: 'transparent',
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderRadius: 0,
      paddingHorizontal: 0,
      paddingVertical: 12
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
    loginWebViewModal: {
      flex: 1,
      backgroundColor: theme.background
    },
    loginWebViewTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 16,
      fontWeight: '700'
    },
    menuButton: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10,
      minHeight: 44
    },
    menuIcon: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 30,
      height: 30
    },
    menuLabel: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 15,
      fontWeight: '600'
    },
    meta: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      lineHeight: 17
    },
    panelTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 15,
      fontWeight: '600' as const
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
    moreContentInner: {
      gap: 10,
      padding: 16,
      paddingTop: (NativeStatusBar.currentHeight ?? 0) + 4,
      paddingBottom: 124
    },
    updateBadge: {
      alignSelf: 'flex-start',
      overflow: 'hidden',
      color: theme.danger,
      fontFamily: appFontFamily,
      fontSize: 11,
      fontWeight: '600',
      lineHeight: 16,
      backgroundColor: alphaColor(theme.danger, theme.dark ? 0.16 : 0.07),
      borderColor: alphaColor(theme.danger, theme.dark ? 0.38 : 0.2),
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 7,
      paddingVertical: 2
    },
    updateProgressBox: {
      gap: 7,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 10,
      paddingVertical: 9
    },
    updateProgressHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 10
    },
    updateProgressTitle: {
      flex: 1,
      minWidth: 0,
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '600',
      lineHeight: 17
    },
    updateProgressPercent: {
      flexShrink: 0,
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '700',
      lineHeight: 17
    },
    updateProgressTrack: {
      width: '100%',
      height: 6,
      overflow: 'hidden',
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.12 : 0.08),
      borderRadius: 999
    },
    updateProgressFill: {
      height: '100%',
      backgroundColor: theme.primary,
      borderRadius: 999
    },
    updateProgressMeta: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 11,
      fontWeight: '500',
      lineHeight: 15
    },
    appearanceSettings: {
      gap: 20,
      paddingTop: 4
    },
    appearanceSection: {
      gap: 4
    },
    appearanceSectionTitle: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '600',
      lineHeight: 17
    },
    appearanceSettingRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      minHeight: 48
    },
    appearanceSettingRowDivided: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth
    },
    appearanceSettingLabel: {
      flexBasis: 72,
      flexShrink: 0,
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 14,
      fontWeight: '500',
      lineHeight: 20
    },
    appearanceSegmentedControl: {
      flex: 1,
      flexDirection: 'row',
      minWidth: 0,
      padding: 2,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth
    },
    appearanceSegment: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      minHeight: 48,
      minWidth: 0,
      borderRadius: 6,
      paddingHorizontal: 4
    },
    appearanceSegmentActive: {
      backgroundColor: theme.primarySoft
    },
    appearanceSegmentText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '500',
      includeFontPadding: false
    },
    appearanceSegmentTextActive: {
      color: theme.primary,
      fontWeight: '600'
    },
    appearanceFontScaleBlock: {
      gap: 2,
      paddingBottom: 4
    },
    appearanceFontScaleHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      minHeight: 40
    },
    appearanceFontScaleValue: {
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 18
    },
    appearanceSliderRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12
    },
    appearanceStepButton: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 48,
      height: 48,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth
    },
    appearanceStepButtonText: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 20,
      fontWeight: '500',
      includeFontPadding: false
    },
    appearanceControlDisabled: {
      opacity: 0.38
    },
    appearanceSlider: {
      flex: 1,
      height: 48,
      justifyContent: 'center',
      minWidth: 0
    },
    appearanceSliderTrack: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: 4,
      backgroundColor: theme.lineStrong,
      borderRadius: 2
    },
    appearanceSliderFill: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: 4,
      backgroundColor: theme.primary,
      borderRadius: 2,
      transformOrigin: 'left center'
    },
    appearanceSliderThumb: {
      position: 'absolute',
      left: 0,
      width: 20,
      height: 20,
      marginLeft: -10,
      backgroundColor: theme.primaryStrong,
      borderColor: theme.surface,
      borderRadius: 10,
      borderWidth: 2
    }
  });
}

export type MoreStyles = ReturnType<typeof createMoreStyles>;

export function createMoreScreenStyles(theme: ReaderTheme, settings: ReaderSettings) {
  return Object.assign(
    {},
    createMoreStyles(theme, settings),
    createMoreAccountStyles(theme, settings),
    createLoginWebViewStyles(theme, settings)
  );
}

export type MoreScreenStyles = ReturnType<typeof createMoreScreenStyles>;
