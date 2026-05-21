import { describe, expect, it, vi } from 'vitest';
import { alphaColor, contentWidthValue, createTheme, fontFamilyValue, lineHeightMultiplier } from './theme';

vi.mock('react-native', () => ({
  Platform: {
    OS: 'android',
    select: (options: Record<string, unknown>) => options.android ?? options.default
  },
  StatusBar: {
    currentHeight: 24
  },
  StyleSheet: {
    hairlineWidth: 1,
    create: (styles: unknown) => styles
  }
}));

describe('Android reader theme helpers', () => {
  it('keeps reader layout helper values stable', () => {
    expect(lineHeightMultiplier('compact')).toBe(1.45);
    expect(lineHeightMultiplier('standard')).toBe(1.62);
    expect(lineHeightMultiplier('loose')).toBe(1.82);
    expect(contentWidthValue('narrow')).toBe(640);
    expect(contentWidthValue('standard')).toBe(720);
    expect(contentWidthValue('wide')).toBe(820);
    expect(fontFamilyValue('sans')).toBeUndefined();
  });

  it('creates rgba colors and light theme tokens', () => {
    expect(alphaColor('#016826', 0.09)).toBe('rgba(1, 104, 38, 0.09)');
    expect(createTheme({
      theme: 'light',
      palette: 'sage',
      background: 'warm',
      fontScale: 1,
      lineHeight: 'standard',
      contentWidth: 'standard',
      fontFamily: 'sans',
      listDensity: 'standard',
      blockedKeywords: [],
      blockedUsers: [],
      blockedCategories: [],
      trackedKeywords: []
    }, 'dark')).toMatchObject({
      dark: false,
      background: '#f7f7f2',
      primary: '#016826'
    });
  });
});
