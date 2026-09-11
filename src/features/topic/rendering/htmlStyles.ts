import { StyleSheet } from 'react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { fontFamilyValue, LINK_COLOR, type ReaderTheme } from '@/ui/theme/tokens';

export type ContentContinuation = 'only' | 'first' | 'middle' | 'last';

export function contentBoundaryForContinuation(continuation: ContentContinuation) {
  return {
    trimLeading: continuation === 'middle' || continuation === 'last',
    trimTrailing: continuation === 'first' || continuation === 'middle'
  };
}

export function createHtmlRendererStyles(settings: ReaderSettings, theme: ReaderTheme) {
  const linkColor = theme.dark ? theme.primary : LINK_COLOR;
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  return StyleSheet.create({
    htmlMentionLink: {
      color: linkColor,
      fontFamily: appFontFamily,
      fontSize: Math.round(15 * settings.fontScale),
      fontWeight: '600',
      lineHeight: Math.round(24 * settings.fontScale)
    },
    htmlFloorLink: {
      color: linkColor,
      fontFamily: appFontFamily,
      fontSize: Math.round(13 * settings.fontScale),
      fontWeight: '600',
      lineHeight: Math.round(22 * settings.fontScale)
    },
    htmlReplyReferenceRow: {
      alignItems: 'center',
      alignSelf: 'stretch',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 5,
      marginBottom: 4,
      marginTop: -1
    },
    htmlReplyReferenceLabel: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: Math.round(12 * settings.fontScale),
      includeFontPadding: false,
      lineHeight: Math.round(18 * settings.fontScale),
      textAlignVertical: 'center'
    },
    htmlReplyReferenceMentionText: {
      color: linkColor,
      fontFamily: appFontFamily,
      fontSize: Math.round(13 * settings.fontScale),
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: Math.round(18 * settings.fontScale),
      textAlignVertical: 'center'
    },
    htmlReplyReferenceSeparator: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: Math.round(12 * settings.fontScale),
      includeFontPadding: false,
      lineHeight: Math.round(18 * settings.fontScale),
      textAlignVertical: 'center'
    },
    htmlReplyReferenceFloorText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: Math.round(12 * settings.fontScale),
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: Math.round(18 * settings.fontScale),
      textAlignVertical: 'center'
    },
    inlineForumImageText: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: Math.round(16 * settings.fontScale),
      lineHeight: Math.round(20 * settings.fontScale)
    },
    inlineForumImage: {
      width: Math.round(104 * settings.fontScale),
      height: Math.round(82 * settings.fontScale),
      marginHorizontal: 2,
      resizeMode: 'contain'
    }
  });
}
