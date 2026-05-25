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
    palette: 'mint',
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
    expect(alphaColor('#1f6954', 0.09)).toBe('rgba(31, 105, 84, 0.09)');
    expect(createTheme(settings)).toMatchObject({
      dark: false,
      background: '#ffffff',
      surface: '#ffffff',
      surface2: '#f7f7f7',
      line: '#e5e5e5',
      lineStrong: '#d8d8d8',
      primary: '#1f6954'
    });
  });

  it('keeps the Android bottom navigation close to the phone edge', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800);

    expect(styles.nav.paddingBottom).toBe(8);
    expect(styles.contentInner.paddingBottom).toBe(96);
    expect(styles.feedFloatingActions.bottom).toBe(78);
  });

  it('styles loading states as quiet content placeholders', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800);

    expect(styles.loadingState.alignItems).toBe('stretch');
    expect(styles.loadingState.backgroundColor).toBe(alphaColor(theme.primary, 0.035));
    expect(styles.loadingPlaceholderStack.gap).toBe(8);
    expect(styles.loadingPlaceholderLine.height).toBe(10);
    expect(styles.loadingPlaceholderLine.borderRadius).toBe(999);
    expect(styles.loadingPlaceholderLineShort.width).toBe('42%');
    expect(styles.loadingPlaceholderLineMuted.width).toBe('68%');
  });

  it('keeps topic rows blended into the maintained pea white background', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800);

    expect(styles.topicSwipeShell.backgroundColor).toBe(theme.background);
    expect(styles.topicCard.backgroundColor).toBe(theme.background);
  });

  it('keeps dark topic rows on the same neutral background as the page', () => {
    const theme = createTheme({ ...settings, theme: 'dark' });
    const styles = createStyles(theme, { ...settings, theme: 'dark' }, 800);

    expect(theme).toMatchObject({
      dark: true,
      background: '#111111',
      surface: '#171717',
      surface2: '#222222',
      line: '#2f2f2f',
      lineStrong: '#444444',
      ink: '#eeeeee',
      muted: '#a6a6a6',
      primary: '#72b8a0'
    });
    expect(styles.topicSwipeShell.backgroundColor).toBe(theme.background);
    expect(styles.topicCard.backgroundColor).toBe(theme.background);
  });

  it('keeps list chrome and controls in the pea white surface family', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800);

    expect(theme.surface).toBe(theme.background);
    expect(styles.group.backgroundColor).toBe(theme.background);
    expect(styles.button.backgroundColor).toBe(theme.background);
    expect(styles.input.backgroundColor).toBe(theme.background);
    expect(styles.nav.backgroundColor).toBe(theme.background);
    expect(styles.floatingIconButton.backgroundColor).toBe(theme.background);
  });

  it('uses only explicit light and dark themes', () => {
    expect(createTheme({ ...settings, theme: 'light' })).toMatchObject({
      dark: false,
      primary: '#1f6954'
    });
    expect(createTheme({ ...settings, theme: 'dark' })).toMatchObject({
      dark: true,
      primary: '#72b8a0'
    });
  });

  it('keeps the background browser WebView from occupying visible space', () => {
    const theme = createTheme(settings);
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
