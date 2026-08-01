import { StyleSheet } from 'react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { type ReaderTheme, fontFamilyValue } from '@/ui/theme/tokens';
import type { SharedStyles } from '@/ui/theme/sharedStyles';

export function createUserStyles(sharedStyles: SharedStyles, theme: ReaderTheme, settings: ReaderSettings) {
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  return Object.assign(
    {},
    sharedStyles,
    StyleSheet.create({
      userContentInner: {
        gap: 10,
        padding: 16,
        paddingTop: 8,
        paddingBottom: 96
      },
      userProfileHeader: {
        gap: 16,
        padding: 16,
        paddingTop: 8,
        paddingBottom: 10,
        backgroundColor: theme.background,
        borderBottomColor: theme.line,
        borderBottomWidth: StyleSheet.hairlineWidth
      },
      profileStatRail: {
        alignItems: 'center',
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8
      },
      profileStatPill: {
        minHeight: 34,
        alignItems: 'center',
        flexDirection: 'row',
        gap: 6,
        backgroundColor: theme.surface2,
        borderColor: theme.line,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 10,
        paddingVertical: 5
      },
      profileStatLabel: {
        color: theme.muted,
        fontFamily: appFontFamily,
        fontSize: 12,
        fontWeight: '600',
        includeFontPadding: false,
        lineHeight: 16
      },
      profileStatValue: {
        maxWidth: 160,
        color: theme.ink,
        fontFamily: appFontFamily,
        fontSize: 12,
        fontWeight: '700',
        includeFontPadding: false,
        lineHeight: 16
      }
    })
  );
}

export type UserStyles = ReturnType<typeof createUserStyles>;
