import { StyleSheet, StatusBar as NativeStatusBar } from 'react-native';
import {
  createUiFontSizer,
  readerRadii,
  type ReaderStyleSettings,
  type ReaderTheme,
  alphaColor,
  fontFamilyValue,
  textSizeStyle
} from '@/ui/theme/tokens';
import { createMoreAccountStyles } from './accountStyles';
import { createLoginWebViewStyles } from '@/ui/navigation/loginWebViewStyles';

export function createMoreStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const appFontFamily = fontFamilyValue(settings.uiFontFamily);
  const fontSize = createUiFontSizer(settings);
  return StyleSheet.create({
    buttonText: {
      color: theme.ink,
      fontFamily: appFontFamily,
      ...textSizeStyle(fontSize(13)),
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
      ...textSizeStyle(fontSize(13), fontSize(19))
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
      ...textSizeStyle(Math.round(13 * settings.uiFontScale)),
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
      ...textSizeStyle(fontSize(16)),
      fontWeight: '700'
    },
    proxyCurrentLabel: {
      fontFamily: appFontFamily,
      ...textSizeStyle(fontSize(11), fontSize(14)),
      fontWeight: '600'
    },
    proxyAddLabel: {
      fontFamily: appFontFamily,
      ...textSizeStyle(fontSize(15)),
      fontWeight: '600'
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
      ...textSizeStyle(fontSize(15)),
      fontWeight: '500'
    },
    meta: {
      color: theme.muted,
      fontFamily: appFontFamily,
      ...textSizeStyle(fontSize(12), fontSize(17))
    },
    panelTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      ...textSizeStyle(fontSize(15)),
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
      ...textSizeStyle(Math.round(20 * settings.uiFontScale)),
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
      ...textSizeStyle(fontSize(12), fontSize(17)),
      fontVariant: ['tabular-nums']
    },
    updateNotes: {
      color: theme.ink,
      fontFamily: appFontFamily,
      ...textSizeStyle(fontSize(13), fontSize(20))
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
      gap: 8
    },
    appearanceGroup: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingTop: 12
    },
    appearanceGroupLabel: {
      color: theme.muted,
      fontFamily: appFontFamily,
      ...textSizeStyle(fontSize(12), fontSize(18)),
      fontWeight: '600',
      marginBottom: 2
    },
    appearanceChoiceRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 10,
      minHeight: 48,
      paddingVertical: 5
    },
    appearanceInlineRow: {
      flexWrap: 'wrap',
      rowGap: 4
    },
    appearanceThemeChoices: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      maxWidth: '100%',
      gap: 4
    },
    appearanceThemeOption: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 7,
      minHeight: 48,
      minWidth: 48,
      paddingHorizontal: 6,
      paddingVertical: 5
    },
    appearanceThemeSwatch: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 28,
      height: 28,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.lineStrong
    },
    appearanceThemeSwatchSelected: {
      borderColor: theme.dark ? theme.primary : theme.primaryStrong,
      borderWidth: 2
    },
    appearanceSegments: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      maxWidth: '100%',
      padding: 2,
      borderRadius: readerRadii.control,
      backgroundColor: theme.surface2
    },
    appearanceSegment: {
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 48,
      minHeight: 48,
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: readerRadii.control - 2
    },
    appearanceSegmentSelected: {
      backgroundColor: theme.primarySoft
    },
    appearanceOptionLabel: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: fontSize(12),
      lineHeight: fontSize(17),
      fontWeight: '500',
      includeFontPadding: false
    },
    appearanceOptionLabelSelected: {
      color: theme.dark ? theme.primary : theme.primaryStrong,
      fontWeight: '600'
    },
    appearanceSettingRowDivided: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth
    },
    appearanceSwitch: { minWidth: 48, minHeight: 48 },
    appearanceSettingLabel: {
      flexShrink: 1,
      color: theme.ink,
      fontFamily: appFontFamily,
      ...textSizeStyle(fontSize(14), fontSize(20)),
      fontWeight: '500'
    },
    appearanceFontSetting: { paddingVertical: 0 },
    appearanceFontField: {
      flex: 1,
      maxWidth: '67%',
      minWidth: 0,
      minHeight: 48,
      justifyContent: 'center'
    },
    appearanceFontFieldDisabled: { opacity: 0.5 },
    appearanceFontFieldControl: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      minHeight: 36,
      gap: 8,
      paddingHorizontal: 10,
      paddingVertical: 5,
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: readerRadii.control
    },
    appearanceFontFieldOpen: { borderColor: theme.primary },
    appearanceFontFieldValue: {
      flexShrink: 1,
      color: theme.ink,
      fontFamily: appFontFamily,
      ...textSizeStyle(fontSize(14), fontSize(20)),
      fontWeight: '500'
    },
    appearanceDropdown: { backgroundColor: theme.surface },
    appearanceDropdownScroll: { flexGrow: 0, flexShrink: 1 },
    appearanceDropdownContent: { padding: 4 },
    appearanceDropdownItem: {
      minHeight: 48,
      justifyContent: 'center',
      paddingHorizontal: 10,
      gap: 4,
      paddingVertical: 8
    },
    appearanceFontOptionLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    appearanceFontOptionSelected: { backgroundColor: theme.primarySoft, borderRadius: readerRadii.control },
    appearanceFontTitles: { flex: 1, minWidth: 0, gap: 2 },
    appearanceFontMeta: {
      color: theme.muted,
      fontFamily: appFontFamily,
      ...textSizeStyle(fontSize(12), fontSize(17)),
      flexShrink: 1
    },
    appearanceFontAction: {
      width: '38%',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 5
    },
    appearanceFontActionText: {
      color: theme.dark ? theme.primary : theme.primaryStrong,
      fontWeight: '600',
      fontVariant: ['tabular-nums']
    },
    appearanceFontProgress: {
      position: 'absolute',
      start: 10,
      end: 10,
      bottom: 1,
      height: 3,
      borderRadius: 2,
      backgroundColor: theme.line
    },
    appearanceError: {
      color: theme.danger,
      fontFamily: appFontFamily,
      ...textSizeStyle(fontSize(13), fontSize(20))
    },
    appearanceFontScaleBlock: {
      paddingTop: 4,
      paddingBottom: 3
    },
    appearanceFontScaleHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 8,
      minHeight: 26
    },
    appearanceFontScaleValue: {
      color: theme.ink,
      fontFamily: appFontFamily,
      ...textSizeStyle(fontSize(13), fontSize(18)),
      fontWeight: '600',
      fontVariant: ['tabular-nums']
    },
    appearanceSliderRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 6
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
