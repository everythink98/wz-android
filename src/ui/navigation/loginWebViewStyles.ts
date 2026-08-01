import { StyleSheet } from 'react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { type ReaderTheme, fontFamilyValue } from '@/ui/theme/tokens';
import type { SharedStyles } from '@/ui/theme/sharedStyles';

export function createLoginWebViewStyles(sharedStyles: SharedStyles, theme: ReaderTheme, settings: ReaderSettings) {
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  return Object.assign(
    {},
    sharedStyles,
    StyleSheet.create({
      loginWebViewTitleBlock: {
        flex: 1,
        gap: 2
      },
      loginWebViewSubtitle: {
        color: theme.muted,
        fontFamily: appFontFamily,
        fontSize: 12
      },
      loginWebViewToolbar: {
        borderBottomColor: theme.line,
        borderBottomWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 12,
        paddingVertical: 8
      },
      loginWebViewBody: {
        flex: 1,
        backgroundColor: theme.surface
      },
      loading: {
        position: 'absolute',
        zIndex: 1,
        top: 14,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: theme.surface,
        borderColor: theme.line,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        elevation: 1,
        paddingHorizontal: 12,
        paddingVertical: 8
      },
      loadingText: {
        color: theme.muted,
        fontFamily: appFontFamily,
        fontSize: 12
      }
    })
  );
}

export type LoginWebViewStyles = ReturnType<typeof createLoginWebViewStyles>;
