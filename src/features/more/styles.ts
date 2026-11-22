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
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth
    },
    settingsSection: { marginTop: 6 },
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
      paddingVertical: 8
    },
    updateHeaderRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'space-between',
      marginRight: -8,
      minHeight: 48
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
    updateNotes: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: fontSize(13),
      lineHeight: fontSize(20)
    },
    updateIntegratedBar: {
      backgroundColor: theme.primarySoft,
      borderRadius: readerRadii.control,
      justifyContent: 'center',
      minHeight: 52,
      overflow: 'hidden',
      position: 'relative',
      width: '100%'
    },
    updateIntegratedContent: {
      alignItems: 'center',
      flexDirection: 'row',
      columnGap: 10,
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 8
    },
    updateIntegratedFill: {
      ...StyleSheet.absoluteFill,
      backgroundColor: alphaColor(theme.primary, 0.46),
      transformOrigin: 'left center'
    },
    updateIntegratedLeft: {
      alignItems: 'center',
      flexDirection: 'row',
      flexShrink: 1,
      maxWidth: '100%',
      gap: 8
    },
    updateIntegratedActionText: {
      flexShrink: 1,
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: fontSize(14),
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: fontSize(20)
    },
    updateIntegratedRight: {
      alignItems: 'flex-end',
      flexShrink: 1,
      maxWidth: '100%'
    },
    updateProgressPercent: {
      flexShrink: 0,
      textAlign: 'right',
      includeFontPadding: false,
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: fontSize(14),
      fontWeight: '600',
      lineHeight: fontSize(19),
      fontVariant: ['tabular-nums']
    },
    updateProgressMeta: {
      flexShrink: 1,
      textAlign: 'right',
      includeFontPadding: false,
      color: alphaColor(theme.ink, 0.9),
      fontFamily: appFontFamily,
      fontSize: fontSize(11),
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
      color: theme.dark ? theme.primary : theme.primaryStrong,
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
