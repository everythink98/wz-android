import { StyleSheet, StatusBar as NativeStatusBar } from 'react-native';
import {
  createReaderFontSizer,
  readerRadii,
  type ReaderStyleSettings,
  type ReaderTheme,
  alphaColor,
  fontFamilyValue
} from '@/ui/theme/tokens';
import { createMoreAccountStyles } from './accountStyles';
import { createLoginWebViewStyles } from '@/ui/navigation/loginWebViewStyles';

export function createMoreStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  const fontSize = createReaderFontSizer(settings);
  return StyleSheet.create({
    buttonText: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: fontSize(13),
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
      fontSize: fontSize(13),
      lineHeight: fontSize(19)
    },
    flex: {
      flex: 1
    },
    groupList: {
      backgroundColor: 'transparent',
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderRadius: 0,
      marginTop: 0,
      paddingHorizontal: 0,
      paddingVertical: 6
    },
    settingsSection: { marginTop: 16 },
    utilityDivider: { backgroundColor: theme.line, height: StyleSheet.hairlineWidth, marginLeft: 38 },
    libraryShortcuts: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      paddingVertical: 6
    },
    libraryShortcut: {
      alignItems: 'center',
      flex: 1,
      gap: 6,
      justifyContent: 'center',
      minHeight: 64,
      paddingVertical: 8
    },
    libraryShortcutLabel: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: Math.round(13 * settings.fontScale),
      fontWeight: '500'
    },
    input: {
      minHeight: 48
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
      fontSize: fontSize(15),
      fontWeight: '500'
    },
    meta: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: fontSize(12),
      lineHeight: fontSize(17)
    },
    panelTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: fontSize(15),
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
    sectionTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: Math.round(20 * settings.fontScale),
      fontWeight: '600',
      paddingVertical: 8
    },
    stack: {
      gap: 10,
      width: '100%'
    },
    moreContentInner: {
      padding: 20,
      paddingTop: (NativeStatusBar.currentHeight ?? 0) + 4,
      paddingBottom: 124
    },
    moreFullWidthContent: { paddingHorizontal: 0 },
    moreGlassHeader: {
      position: 'absolute',
      top: 0,
      right: 0,
      left: 0,
      paddingTop: (NativeStatusBar.currentHeight ?? 0) + 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line
    },
    moreHeaderHost: { minHeight: 52 },
    morePageInset: { paddingHorizontal: 20 },
    readingSettingsContent: {
      paddingTop: 12
    },
    updatePanel: {
      gap: 12,
      paddingVertical: 12
    },
    updateCard: {
      backgroundColor: theme.surface2,
      borderColor: alphaColor(theme.ink, theme.dark ? 0.1 : 0.06),
      borderRadius: readerRadii.surface,
      borderWidth: StyleSheet.hairlineWidth,
      marginVertical: 8,
      paddingBottom: 16,
      paddingHorizontal: 16,
      paddingTop: 12
    },
    updateHeaderRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'space-between',
      marginRight: -8
    },
    updateTitleRow: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8
    },
    updateHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8
    },
    updateIdentity: {
      alignItems: 'center',
      flex: 1,
      flexDirection: 'row',
      gap: 10,
      minHeight: 44,
      minWidth: 0
    },
    updateIconBadge: {
      alignItems: 'center',
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.16 : 0.09),
      borderRadius: 9,
      height: 32,
      justifyContent: 'center',
      width: 32
    },
    updateVersionMeta: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: fontSize(12),
      fontVariant: ['tabular-nums'],
      lineHeight: fontSize(17)
    },
    updateDetails: {
      gap: 12
    },
    updateNotes: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: fontSize(13),
      lineHeight: fontSize(20)
    },
    updateBadge: {
      alignSelf: 'flex-start',
      overflow: 'hidden',
      color: theme.dark ? theme.primary : theme.primaryStrong,
      fontFamily: appFontFamily,
      fontSize: fontSize(11),
      fontWeight: '600',
      lineHeight: fontSize(15),
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.18 : 0.1),
      borderRadius: readerRadii.badge,
      paddingHorizontal: 7,
      paddingVertical: 2
    },
    updatePrimarySlot: {
      width: '100%'
    },
    updateIntegratedBar: {
      backgroundColor: theme.surface,
      borderColor: alphaColor(theme.primary, theme.dark ? 0.28 : 0.2),
      borderRadius: readerRadii.control,
      borderWidth: StyleSheet.hairlineWidth,
      justifyContent: 'center',
      minHeight: 42,
      overflow: 'hidden',
      position: 'relative',
      width: '100%'
    },
    updateBarDisabled: {
      opacity: 0.6
    },
    updateIntegratedFill: {
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.24 : 0.13),
      bottom: 0,
      left: 0,
      position: 'absolute',
      top: 0
    },
    updateIntegratedContent: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: 10,
      rowGap: 4,
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 8
    },
    updateIntegratedLeft: {
      alignItems: 'center',
      flexDirection: 'row',
      maxWidth: '100%',
      gap: 7
    },
    updateIntegratedActionText: {
      flexShrink: 1,
      color: theme.dark ? theme.primary : theme.primaryStrong,
      fontFamily: appFontFamily,
      fontSize: fontSize(13),
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: fontSize(18)
    },
    updateIntegratedRight: {
      alignItems: 'center',
      flexGrow: 1,
      flexShrink: 1,
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'flex-end',
      maxWidth: '100%'
    },
    updateSecondaryRow: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      justifyContent: 'space-between'
    },
    updateProgressPercent: {
      flexShrink: 0,
      color: theme.dark ? theme.primary : theme.primaryStrong,
      fontFamily: appFontFamily,
      fontSize: fontSize(12),
      fontWeight: '700',
      lineHeight: fontSize(17),
      fontVariant: ['tabular-nums']
    },
    updateProgressMeta: {
      flexShrink: 1,
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: fontSize(11),
      fontWeight: '500',
      lineHeight: fontSize(16),
      fontVariant: ['tabular-nums']
    },
    backupActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10
    },
    appearanceSettings: {
      gap: 6,
      paddingTop: 4
    },
    appearanceSettingRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      minHeight: 48,
      paddingTop: 6
    },
    appearanceSettingRowDivided: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth
    },
    appearanceSettingLabel: {
      flexBasis: 76,
      flexShrink: 0,
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: fontSize(14),
      fontWeight: '500',
      lineHeight: fontSize(20)
    },
    appearanceSegmentedControl: {
      flex: 1,
      flexDirection: 'row',
      minWidth: 0,
      padding: 2,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: readerRadii.control,
      borderWidth: StyleSheet.hairlineWidth
    },
    appearanceSegment: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      minHeight: 48,
      minWidth: 0,
      borderRadius: readerRadii.control,
      paddingHorizontal: 4
    },
    appearanceSegmentActive: {
      backgroundColor: theme.primarySoft
    },
    appearanceSegmentText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: fontSize(12),
      fontWeight: '500',
      includeFontPadding: false
    },
    appearanceSegmentTextActive: {
      color: theme.primary,
      fontWeight: '600'
    },
    appearanceFontScaleBlock: {
      gap: 2,
      paddingTop: 4,
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
      fontSize: fontSize(13),
      fontWeight: '600',
      lineHeight: fontSize(18)
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
      borderRadius: readerRadii.control,
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
    contentSourceRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10,
      marginHorizontal: 4,
      minHeight: 50,
      paddingVertical: 2
    },
    contentSourceCopy: {
      flex: 1,
      minWidth: 0
    },
    contentSourceActions: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 0
    },
    contentSourceDragHandle: {
      alignItems: 'flex-end',
      backgroundColor: 'transparent',
      height: 48,
      justifyContent: 'center',
      paddingRight: 3,
      width: 48
    },
    contentSourceRowDragging: {
      backgroundColor: theme.surface2,
      borderRadius: readerRadii.control,
      borderTopWidth: 0,
      elevation: 2,
      marginHorizontal: 0,
      paddingHorizontal: 8,
      zIndex: 2
    },
    appearanceSlider: {
      flex: 1,
      height: 48,
      minWidth: 0
    }
  });
}

export type MoreStyles = ReturnType<typeof createMoreStyles>;

export function createMoreScreenStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  return Object.assign(
    {},
    createMoreStyles(theme, settings),
    createMoreAccountStyles(theme, settings),
    createLoginWebViewStyles(theme, settings)
  );
}

export type MoreScreenStyles = ReturnType<typeof createMoreScreenStyles>;
