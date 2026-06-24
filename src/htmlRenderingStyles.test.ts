import { describe, expect, it, vi } from 'vitest';
import * as htmlRenderingStyles from './htmlRenderingStyles';
import type { ReaderSettings } from './readerData';
import { createTheme } from './theme';

vi.mock('react-native', () => ({
  StyleSheet: {
    hairlineWidth: 1
  }
}));

describe('Android HTML rendering styles', () => {
  const settings: ReaderSettings = {
    theme: 'light',
    fontScale: 1,
    lineHeight: 'standard',
    contentWidth: 'standard',
    fontFamily: 'sans',
    listDensity: 'standard'
  };

  it('gives markdown headings real hierarchy instead of only bold text', () => {
    const theme = createTheme(settings);
    const { htmlBaseStyle, htmlTagsStyles } = htmlRenderingStyles.buildHtmlRenderingStyles({ settings, theme });
    const baseFontSize = Number(htmlBaseStyle.fontSize);
    const h1FontSize = Number(htmlTagsStyles.h1?.fontSize);
    const h2FontSize = Number(htmlTagsStyles.h2?.fontSize);
    const h3FontSize = Number(htmlTagsStyles.h3?.fontSize);

    expect(h1FontSize).toBeGreaterThan(baseFontSize);
    expect(h2FontSize).toBeGreaterThan(baseFontSize);
    expect(h3FontSize).toBeGreaterThan(baseFontSize);
    expect(h1FontSize).toBeGreaterThan(h2FontSize);
    expect(h2FontSize).toBeGreaterThan(h3FontSize);
  });

  it('makes inline code and code blocks visually distinct from normal prose', () => {
    const theme = createTheme(settings);
    const { htmlTagsStyles } = htmlRenderingStyles.buildHtmlRenderingStyles({ settings, theme });

    expect(htmlTagsStyles.code).toMatchObject({
      backgroundColor: theme.surface2,
      fontFamily: 'monospace'
    });
    expect(htmlTagsStyles.pre).toMatchObject({
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 10
    });
    expect(htmlTagsStyles.pre?.padding).toBeGreaterThan(8);
  });

  it('uses normal markdown text color and system blue links instead of the theme accent', () => {
    const theme = createTheme(settings);
    const { htmlBaseStyle, htmlTagsStyles } = htmlRenderingStyles.buildHtmlRenderingStyles({ settings, theme });

    expect(htmlBaseStyle.color).toBe(theme.ink);
    expect(htmlTagsStyles.p?.color).toBeUndefined();
    expect(htmlTagsStyles.a?.color).toBe('#0000EE');
    expect(htmlTagsStyles.a?.color).not.toBe(theme.primary);
    expect(htmlTagsStyles.a).not.toHaveProperty('textDecorationLine');
    expect(htmlTagsStyles.a).not.toHaveProperty('textDecorationColor');
  });

  it('allows source text color without allowing background colors', () => {
    const theme = createTheme(settings);
    const { htmlIgnoredStyles } = htmlRenderingStyles.buildHtmlRenderingStyles({ settings, theme });

    expect((htmlRenderingStyles as typeof htmlRenderingStyles & { HTML_ALLOWED_INLINE_STYLES?: string[] }).HTML_ALLOWED_INLINE_STYLES).toContain('color');
    expect(htmlIgnoredStyles).not.toContain('color');
    expect(htmlIgnoredStyles).toContain('backgroundColor');
  });
});
