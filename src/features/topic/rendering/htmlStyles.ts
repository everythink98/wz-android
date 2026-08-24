import { StyleSheet } from 'react-native';
import type { HtmlAllowedStyles, HtmlBaseStyle, HtmlClassesStyles, HtmlIgnoredStyles, HtmlTagsStyles } from './types';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { alphaColor, fontFamilyValue, lineHeightMultiplier, LINK_COLOR, type ReaderTheme } from '@/ui/theme/tokens';
import { DISCOURSE_CALLOUT_TITLE_CLASS, DISCOURSE_CALLOUT_TONE_CLASS_PREFIX } from '@/domain/forum/callouts';

export const HTML_ALLOWED_INLINE_STYLES: HtmlAllowedStyles = [
  'color',
  'fontWeight',
  'fontStyle',
  'textAlign',
  'textDecorationLine'
];
export const HTML_REPLY_CONTENT_CLASS = 'forum-reply-content';

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

export function buildHtmlRenderingStyles({
  enableDiscourseCallouts = false,
  settings,
  theme
}: {
  enableDiscourseCallouts?: boolean;
  settings: ReaderSettings;
  theme: ReaderTheme;
}) {
  const baseFontSize = Math.round(16 * settings.fontScale);
  const baseLineHeight = Math.round(baseFontSize * lineHeightMultiplier(settings.lineHeight));
  const replyFontSize = Math.round(15 * settings.fontScale);
  const linkColor = theme.dark ? theme.primary : LINK_COLOR;
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  const htmlBaseStyle: HtmlBaseStyle = {
    color: theme.ink,
    fontFamily: appFontFamily,
    fontSize: baseFontSize,
    lineHeight: baseLineHeight
  };
  const htmlParagraph = {
    marginBottom: 10,
    marginTop: 0
  };
  const heading = (
    size: number,
    lineHeight: number,
    weight: '600' | '700',
    marginTop: number,
    marginBottom: number
  ) => ({
    fontSize: Math.round(size * settings.fontScale),
    fontWeight: weight,
    lineHeight: Math.round(lineHeight * settings.fontScale),
    marginBottom,
    marginTop
  });
  const listPaddingLeft = Math.round(34 * settings.fontScale);
  const htmlTagsStyles: HtmlTagsStyles = {
    body: {
      backgroundColor: 'transparent'
    },
    p: htmlParagraph,
    h1: heading(24, 32, '700', 24, 10),
    h2: heading(20, 28, '700', 20, 10),
    h3: heading(18, 26, '600', 16, 8),
    h4: heading(16, 24, '600', 16, 8),
    h5: heading(15, 22, '600', 12, 6),
    h6: heading(14, 21, '600', 12, 6),
    strong: {
      fontWeight: '700'
    },
    hr: {
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      marginBottom: 8,
      marginTop: 8
    },
    a: {
      color: linkColor
    },
    img: {
      borderRadius: 10,
      marginBottom: 8,
      marginTop: 6
    },
    li: {
      marginBottom: 2
    },
    ul: {
      marginBottom: 10,
      marginTop: 6,
      paddingLeft: listPaddingLeft
    },
    ol: {
      marginBottom: 10,
      marginTop: 6,
      paddingLeft: listPaddingLeft
    },
    blockquote: {
      backgroundColor: 'transparent',
      borderLeftColor: theme.lineStrong,
      borderLeftWidth: 3,
      marginBottom: 10,
      marginTop: 10,
      paddingBottom: 2,
      paddingLeft: 12,
      paddingRight: 4,
      paddingTop: 2
    },
    pre: {
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 8,
      marginBottom: 10,
      marginTop: 10,
      padding: 12
    },
    code: {
      backgroundColor: theme.surface2,
      borderRadius: 4,
      fontFamily: 'monospace',
      fontSize: Math.round(14 * settings.fontScale),
      paddingHorizontal: 4,
      paddingVertical: 1
    },
    mark: {
      backgroundColor: theme.surface2
    },
    table: {
      backgroundColor: 'transparent'
    },
    tr: {
      flexDirection: 'row',
      flexWrap: 'nowrap'
    },
    th: {
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderRightWidth: StyleSheet.hairlineWidth,
      color: theme.ink,
      flexShrink: 0,
      fontWeight: '700',
      paddingHorizontal: 10,
      paddingVertical: 9
    },
    td: {
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderRightWidth: StyleSheet.hairlineWidth,
      color: theme.ink,
      flexShrink: 0,
      paddingHorizontal: 10,
      paddingVertical: 9
    }
  };
  const htmlClassesStyles: HtmlClassesStyles = {
    [HTML_REPLY_CONTENT_CLASS]: {
      fontSize: replyFontSize,
      lineHeight: Math.round(replyFontSize * lineHeightMultiplier(settings.lineHeight))
    },
    'forum-user-mention': {
      alignSelf: 'flex-start',
      backgroundColor: alphaColor(linkColor, theme.dark ? 0.2 : 0.12),
      borderColor: alphaColor(linkColor, theme.dark ? 0.38 : 0.26),
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      color: linkColor,
      fontWeight: '700',
      paddingHorizontal: 5,
      paddingVertical: 1,
      textDecorationLine: 'none'
    },
    'forum-attachment': {
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      marginBottom: 12,
      marginTop: 8,
      paddingHorizontal: 12,
      paddingVertical: 12
    },
    'forum-attachment-item': {
      marginTop: 8
    },
    'forum-attachment-meta': {
      color: theme.muted,
      fontSize: Math.round(12 * settings.fontScale),
      lineHeight: Math.round(18 * settings.fontScale)
    },
    'forum-attachment-title': {
      color: theme.ink,
      fontSize: Math.round(14 * settings.fontScale),
      fontWeight: '700',
      lineHeight: Math.round(21 * settings.fontScale)
    },
    'forum-attachment-actions': {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: 8
    },
    'forum-attachment-action': {
      color: linkColor,
      fontWeight: '700',
      marginRight: 8
    },
    'forum-attachment-count': {
      color: theme.muted,
      fontSize: Math.round(12 * settings.fontScale)
    },
    'forum-attachment-note': {
      color: theme.muted,
      fontSize: Math.round(12 * settings.fontScale),
      marginTop: 4
    },
    ...(enableDiscourseCallouts
      ? {
          [DISCOURSE_CALLOUT_TITLE_CLASS]: {
            fontWeight: '700'
          },
          [`${DISCOURSE_CALLOUT_TONE_CLASS_PREFIX}primary`]: { color: theme.primary },
          [`${DISCOURSE_CALLOUT_TONE_CLASS_PREFIX}success`]: { color: theme.success },
          [`${DISCOURSE_CALLOUT_TONE_CLASS_PREFIX}warning`]: { color: theme.warning },
          [`${DISCOURSE_CALLOUT_TONE_CLASS_PREFIX}danger`]: { color: theme.danger },
          [`${DISCOURSE_CALLOUT_TONE_CLASS_PREFIX}muted`]: { color: theme.muted }
        }
      : {})
  };
  const htmlIgnoredStyles: HtmlIgnoredStyles = [
    'backgroundColor',
    'borderTopColor',
    'borderRightColor',
    'borderBottomColor',
    'borderLeftColor',
    'outlineColor',
    'textDecorationColor'
  ];
  return {
    htmlBaseStyle,
    htmlClassesStyles,
    htmlIgnoredStyles,
    htmlTagsStyles
  };
}
