import { StyleSheet } from 'react-native';
import { type ReaderStyleSettings, type ReaderTheme, fontFamilyValue } from '@/ui/theme/tokens';

export function createLibraryStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  return StyleSheet.create({
    actions: {
      alignItems: 'center',
      flexDirection: 'row',
      flexShrink: 0,
      gap: 8
    },
    content: {
      flex: 1
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
      fontSize: 15,
      fontWeight: '600'
    },
    meta: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      lineHeight: 17
    },
    replyAvatarText: {
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '700'
    },
    sectionHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      minHeight: 48,
      gap: 10
    },
    stack: {
      gap: 8,
      paddingHorizontal: 16,
      width: '100%'
    },
    categoryFilterSlot: {
      flex: 1,
      minWidth: 0,
      justifyContent: 'center'
    },
    categoryFilterButton: {
      alignItems: 'center',
      alignSelf: 'flex-start',
      flexDirection: 'row',
      gap: 4,
      minHeight: 48,
      maxWidth: '100%',
      paddingHorizontal: 0
    },
    categoryFilterButtonText: {
      color: theme.primary,
      flexShrink: 1,
      fontFamily: appFontFamily,
      fontSize: 12,
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
      flexShrink: 0,
      justifyContent: 'center',
      minHeight: 32,
      paddingHorizontal: 2,
      paddingVertical: 4
    },
    libraryInlineActionText: {
      color: theme.danger,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '600'
    },
    libraryIconAction: {
      alignItems: 'center',
      flexShrink: 0,
      height: 32,
      justifyContent: 'center',
      width: 32
    },
    librarySectionTitle: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
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
