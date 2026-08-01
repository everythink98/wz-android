import { StyleSheet, StatusBar as NativeStatusBar } from 'react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { type ReaderTheme, fontFamilyValue } from '@/ui/theme/tokens';
import type { SharedStyles } from '@/ui/theme/sharedStyles';

export function createLibraryStyles(sharedStyles: SharedStyles, theme: ReaderTheme, settings: ReaderSettings) {
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  return Object.assign(
    {},
    sharedStyles,
    StyleSheet.create({
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
    })
  );
}

export type LibraryStyles = ReturnType<typeof createLibraryStyles>;
