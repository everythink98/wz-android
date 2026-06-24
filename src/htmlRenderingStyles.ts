import { StyleSheet } from 'react-native';
import type { HtmlBaseStyle, HtmlIgnoredStyles, HtmlTagsStyles } from './appTypes';
import type { ReaderSettings } from './readerData';
import { fontFamilyValue, lineHeightMultiplier, type ReaderTheme } from './theme';

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
    color: theme.ink,
    marginBottom: 10,
    marginTop: 6
  };
  const heading = (size: number, lineHeight: number, weight: '600' | '700', marginTop: number, marginBottom: number) => ({
    color: theme.ink,
    fontSize: Math.round(size * settings.fontScale),
    fontWeight: weight,
    lineHeight: Math.round(lineHeight * settings.fontScale),
    marginBottom,
    marginTop
  });
  const listPaddingLeft = Math.round(34 * settings.fontScale);
  const htmlTagsStyles: HtmlTagsStyles = {
    body: {
      color: theme.ink,
      backgroundColor: 'transparent'
    },
    p: htmlParagraph,
    div: {
      color: theme.ink
    },
    span: {
      color: theme.ink
    },
    h1: heading(24, 32, '700', 20, 10),
    h2: heading(21, 29, '700', 18, 9),
    h3: heading(18, 26, '600', 16, 7),
    h4: heading(16, 24, '600', 14, 6),
    h5: heading(15, 22, '600', 12, 5),
    h6: {
      ...heading(14, 21, '600', 10, 4),
      color: theme.muted
    },
    a: {
      color: theme.primary,
      textDecorationColor: theme.primary,
      textDecorationLine: 'underline'
    },
    img: {
      borderRadius: 10,
      marginBottom: 8,
      marginTop: 6
    },
    strong: {
      color: theme.ink
    },
    b: {
      color: theme.ink
    },
    em: {
      color: theme.ink
    },
    li: {
      color: theme.ink,
      marginBottom: 4
    },
    ul: {
      color: theme.ink,
      marginBottom: 10,
      marginTop: 8,
      paddingLeft: listPaddingLeft
    },
    ol: {
      color: theme.ink,
      marginBottom: 10,
      marginTop: 8,
      paddingLeft: listPaddingLeft
    },
    blockquote: {
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 10,
      color: theme.muted,
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
      color: theme.ink,
      fontFamily: 'monospace',
      paddingHorizontal: 3,
      paddingVertical: 1
    },
    mark: {
      backgroundColor: theme.surface2,
      color: theme.ink
    },
    table: {
      backgroundColor: 'transparent',
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth
    },
    th: {
      color: theme.ink,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 8,
      paddingVertical: 7
    },
    td: {
      color: theme.ink,
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 8,
      paddingVertical: 7
    }
  };
  const htmlIgnoredStyles: HtmlIgnoredStyles = [
    'backgroundColor',
    'borderTopColor',
    'borderRightColor',
    'borderBottomColor',
    'borderLeftColor',
    'color',
    'outlineColor',
    'textDecorationColor'
  ];

  return {
    htmlBaseStyle,
    htmlIgnoredStyles,
    htmlTagsStyles
  };
}
