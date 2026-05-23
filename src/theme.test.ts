import { describe, expect, it, vi } from 'vitest';
import { type ReaderSettings } from './readerData';
import { alphaColor, contentWidthValue, createStyles, createTheme, fontFamilyValue, lineHeightMultiplier } from './theme';

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
  const settings: ReaderSettings = {
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
  };

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
    expect(createTheme(settings, 'dark')).toMatchObject({
      dark: false,
      background: '#f7f7f2',
      primary: '#016826'
    });
  });

  it('keeps the Android bottom navigation close to the phone edge', () => {
    const theme = createTheme(settings, 'light');
    const styles = createStyles(theme, settings, 800);

    expect(styles.nav.paddingBottom).toBe(8);
    expect(styles.contentInner.paddingBottom).toBe(96);
    expect(styles.feedFloatingActions.bottom).toBe(78);
  });

  it('styles loading states as quiet content placeholders', () => {
    const theme = createTheme(settings, 'light');
    const styles = createStyles(theme, settings, 800);

    expect(styles.loadingState.alignItems).toBe('stretch');
    expect(styles.loadingState.backgroundColor).toBe(alphaColor(theme.primary, 0.035));
    expect(styles.loadingPlaceholderStack.gap).toBe(8);
    expect(styles.loadingPlaceholderLine.height).toBe(10);
    expect(styles.loadingPlaceholderLine.borderRadius).toBe(999);
    expect(styles.loadingPlaceholderLineShort.width).toBe('42%');
    expect(styles.loadingPlaceholderLineMuted.width).toBe('68%');
  });

  it('keeps topic rows blended into non-white feed backgrounds', () => {
    for (const background of ['warm', 'gray'] as const) {
      const nonWhiteSettings = { ...settings, background };
      const theme = createTheme(nonWhiteSettings, 'light');
      const styles = createStyles(theme, nonWhiteSettings, 800);

      expect(styles.topicSwipeShell.backgroundColor).toBe(theme.background);
      expect(styles.topicCard.backgroundColor).toBe(theme.background);
    }

    const whiteSettings = { ...settings, background: 'white' as const };
    const whiteTheme = createTheme(whiteSettings, 'light');
    const whiteStyles = createStyles(whiteTheme, whiteSettings, 800);

    expect(whiteStyles.topicCard.backgroundColor).toBe(whiteTheme.surface);
  });

  it('keeps the background browser WebView from occupying visible space', () => {
    const theme = createTheme(settings, 'light');
    const styles = createStyles(theme, settings, 800);

    expect(styles.hiddenBrowserWebViewHost).toMatchObject({
      position: 'absolute',
      width: 1,
      height: 1,
      overflow: 'hidden',
      opacity: 0
    });
    expect(styles.hiddenBrowserWebView).toMatchObject({
      flex: 0,
      width: 1,
      height: 1,
      opacity: 0,
      backgroundColor: 'transparent'
    });
  });
});
