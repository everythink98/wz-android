import { describe, expect, it, vi } from 'vitest';
import { buildHtmlRenderingStyles } from './htmlRenderingStyles';
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
    const { htmlBaseStyle, htmlTagsStyles } = buildHtmlRenderingStyles({ settings, theme });
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
    const { htmlTagsStyles } = buildHtmlRenderingStyles({ settings, theme });

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
});
