import { StyleSheet, StatusBar as NativeStatusBar } from 'react-native';
import {
  createUiFontSizer,
  readerRadii,
  type ReaderStyleSettings,
  type ReaderTheme,
  fontFamilyValue,
  textSizeStyle
} from '@/ui/theme/tokens';

export function createFeedStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const appFontFamily = fontFamilyValue(settings.uiFontFamily);
  const fontSize = createUiFontSizer(settings);
  return StyleSheet.create({
    actions: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8
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
    feedSourceRail: { paddingRight: 0 },
    feedSourceTab: { width: 'auto', minHeight: 48, padding: 0, paddingBottom: 6, justifyContent: 'center' },
    feedSourceLabel: {
      margin: 0,
      fontFamily: appFontFamily,
      ...textSizeStyle(Math.round(14 * settings.uiFontScale)),
      fontWeight: '600',
      textAlign: 'center'
    },
    feedSourceIndicator: { backgroundColor: theme.primary, height: 2 },
    feedCategoryViewport: {
      position: 'absolute',
      left: 0,
      right: 0,
      zIndex: 3,
      overflow: 'hidden',
      backgroundColor: theme.surface
    },
    feedCategoryTrack: { flexDirection: 'row', alignSelf: 'flex-start' },
    feedSecondaryHeader: {
      backgroundColor: theme.surface,
      overflow: 'hidden',
      paddingHorizontal: 16,
      paddingTop: 0,
      paddingBottom: 0,
      borderBottomColor: theme.dark ? '#2B2D30' : '#ECEEF0',
      borderBottomWidth: StyleSheet.hairlineWidth
    },
    feedSecondaryRow: {
      minHeight: 36,
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12
    },
    feedCategoryRailSlot: {
      flex: 1,
      minWidth: 0
    },
    linuxDoFilterButton: {
      minWidth: 48,
      maxWidth: '44%',
      minHeight: 48,
      alignItems: 'center',
      flexDirection: 'row',
      flexShrink: 0,
      justifyContent: 'flex-end',
      gap: 5,
      paddingLeft: 6,
      paddingRight: 0,
      paddingVertical: 3
    },
    linuxDoFilterButtonText: {
      flexShrink: 1,
      color: theme.dark ? theme.primary : theme.primaryStrong,
      fontFamily: appFontFamily,
      fontSize: fontSize(12),
      fontWeight: '500',
      includeFontPadding: false,
      lineHeight: fontSize(17)
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
      ...textSizeStyle(fontSize(11)),
      fontWeight: '600',
      letterSpacing: 0,
      paddingHorizontal: 12,
      paddingTop: 6,
      paddingBottom: 2
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
    feedListFooter: {
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14
    },
    pageErrorText: {
      color: theme.danger,
      fontFamily: appFontFamily,
      ...textSizeStyle(fontSize(13), fontSize(19)),
      textAlign: 'center'
    },
    endOfListText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      ...textSizeStyle(fontSize(12), fontSize(17)),
      paddingVertical: 18,
      textAlign: 'center'
    }
  });
}
