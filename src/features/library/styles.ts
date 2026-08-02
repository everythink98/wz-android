import { StyleSheet, StatusBar as NativeStatusBar } from 'react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { type ReaderTheme, fontFamilyValue } from '@/ui/theme/tokens';

export function createLibraryStyles(theme: ReaderTheme, settings: ReaderSettings) {
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  return StyleSheet.create({
    actions: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
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
    libraryContentInner: {
      gap: 0,
      padding: 16,
      paddingTop: (NativeStatusBar.currentHeight ?? 0) + 4,
      paddingBottom: 96
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
      paddingBottom: 10
    },
    libraryUserButton: {
      flex: 1,
      minWidth: 0
    },
    libraryUserAction: {
      flexShrink: 0
    },
    libraryUserListSpacer: {
      height: 6
    }
  });
}

export type LibraryStyles = ReturnType<typeof createLibraryStyles>;
