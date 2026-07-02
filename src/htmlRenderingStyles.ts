import { StyleSheet } from 'react-native';
import type { HtmlAllowedStyles, HtmlBaseStyle, HtmlClassesStyles, HtmlIgnoredStyles, HtmlTagsStyles } from './appTypes';
import type { ReaderSettings } from './readerData';
import { alphaColor, fontFamilyValue, lineHeightMultiplier, LINK_COLOR, type ReaderTheme } from './theme';

export const HTML_ALLOWED_INLINE_STYLES: HtmlAllowedStyles = ['color', 'fontWeight', 'fontStyle', 'textAlign', 'textDecorationLine'];

export function buildHtmlRenderingStyles({
  settings,
  theme
}: {
  settings: ReaderSettings;
  theme: ReaderTheme;
}) {
  const baseFontSize = Math.round(16 * settings.fontScale);
  const baseLineHeight = Math.round(baseFontSize * lineHeightMultiplier(settings.lineHeight));
  const htmlBaseStyle: HtmlBaseStyle = {
    color: theme.ink,
    fontFamily: fontFamilyValue(settings.fontFamily),
    fontSize: baseFontSize,
    lineHeight: baseLineHeight
  };
  const htmlParagraph = {
    marginBottom: 10,
    marginTop: 0
  };
  const heading = (size: number, lineHeight: number, weight: '600' | '700', marginTop: number, marginBottom: number) => ({
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
    h1: heading(24, 32, '700', 20, 10),
    h2: heading(21, 29, '700', 18, 9),
    h3: heading(18, 26, '600', 16, 7),
    h4: heading(16, 24, '600', 14, 6),
    h5: heading(15, 22, '600', 12, 5),
    h6: heading(14, 21, '600', 10, 4),
    a: {
      color: LINK_COLOR
    },
    img: {
      borderRadius: 10,
      marginBottom: 8,
      marginTop: 6
    },
    li: {
      marginBottom: 4
    },
    ul: {
      marginBottom: 10,
      marginTop: 8,
      paddingLeft: listPaddingLeft
    },
    ol: {
      marginBottom: 10,
      marginTop: 8,
      paddingLeft: listPaddingLeft
    },
    blockquote: {
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 10,
      marginBottom: 12,
      marginTop: 12,
      paddingHorizontal: 14,
      paddingVertical: 12
    },
    pre: {
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 10,
      marginBottom: 12,
      marginTop: 12,
      padding: 12
    },
    code: {
      backgroundColor: theme.surface2,
      borderRadius: 8,
      fontFamily: 'monospace',
      paddingHorizontal: 3,
      paddingVertical: 1
    },
    mark: {
      backgroundColor: theme.surface2
    },
    table: {
      backgroundColor: 'transparent',
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth
    },
    tr: {
      flexDirection: 'row',
      flexWrap: 'nowrap'
    },
    th: {
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth,
      flexShrink: 0,
      paddingHorizontal: 8,
      paddingVertical: 7,
      width: 118
    },
    td: {
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth,
      flexShrink: 0,
      paddingHorizontal: 8,
      paddingVertical: 7,
      width: 118
    }
  };
  const htmlClassesStyles: HtmlClassesStyles = {
    'forum-user-mention': {
      backgroundColor: alphaColor(LINK_COLOR, theme.dark ? 0.2 : 0.12),
      borderColor: alphaColor(LINK_COLOR, theme.dark ? 0.38 : 0.26),
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      color: LINK_COLOR,
      fontWeight: '700',
      paddingHorizontal: 5,
      paddingVertical: 1,
      textDecorationLine: 'none'
    }
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
