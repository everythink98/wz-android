import { StyleSheet } from 'react-native';
import {
  createReaderFontSizer,
  readerRadii,
  type ReaderStyleSettings,
  type ReaderTheme,
  fontFamilyValue
} from '@/ui/theme/tokens';

export function createLibraryStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  const fontSize = createReaderFontSizer(settings);
  return StyleSheet.create({
    content: {
      flex: 1,
      backgroundColor: theme.surface
    },
    flex: {
      flex: 1
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
      fontWeight: '600'
    },
    meta: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: fontSize(12),
      lineHeight: fontSize(17)
    },
    replyAvatarText: {
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: fontSize(13),
      fontWeight: '700'
    },
    toolbarRow: {
      alignItems: 'center',
      flexDirection: 'row',
      minHeight: 48,
      gap: 10
    },
    toolbarRail: { flex: 1, minWidth: 0 },
    stack: {
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 16,
      width: '100%'
    },
    categoryFilterSlot: {
      maxWidth: '45%',
      justifyContent: 'center'
    },
    categoryFilterButton: {
      alignItems: 'center',
      alignSelf: 'flex-start',
      flexDirection: 'row',
      gap: 4,
      minHeight: 48,
      maxWidth: '100%',
      paddingLeft: 8
    },
    categoryFilterButtonText: {
      color: theme.dark ? theme.primary : theme.primaryStrong,
      flexShrink: 1,
      fontFamily: appFontFamily,
      fontSize: fontSize(12),
      fontWeight: '600'
    },
    categoryFilterButtonTextDisabled: {
      color: theme.muted
    },
    libraryContentInner: {
      gap: 0,
      paddingHorizontal: 0,
      paddingTop: 8,
      paddingBottom: 16
    },
    libraryEmpty: {
      paddingHorizontal: 16
    },
    libraryViewportStack: {
      flex: 1
    },
    libraryViewport: {
      ...StyleSheet.absoluteFill
    },
    activeLibraryViewport: {
      zIndex: 1
    },
    hiddenLibraryViewport: {
      opacity: 0
    },
    libraryItem: {
      gap: 8,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingBottom: 10
    },
    libraryInlineAction: {
      alignItems: 'center',
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: readerRadii.control,
      borderWidth: StyleSheet.hairlineWidth,
      flexShrink: 0,
      justifyContent: 'center',
      minHeight: 36,
      paddingHorizontal: 10,
      paddingVertical: 6
    },
    libraryInlineActionText: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: fontSize(12),
      fontWeight: '500'
    },
    libraryIconAction: {
      alignItems: 'center',
      flexShrink: 0,
      height: 44,
      justifyContent: 'center',
      width: 44
    },
    librarySectionTitle: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: fontSize(12),
      fontWeight: '600',
      letterSpacing: 0,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 2
    },
    libraryFirstSectionTitle: {
      paddingTop: 10
    },
    libraryUserRow: {
      alignItems: 'center',
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 10,
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 10
    },
    libraryUserButton: {
      flex: 1,
      minWidth: 0
    },
    libraryUserAction: {
      flexShrink: 0
    }
  });
}

export type LibraryStyles = ReturnType<typeof createLibraryStyles>;
