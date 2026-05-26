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
    expect(alphaColor('#2b5548', 0.09)).toBe('rgba(43, 85, 72, 0.09)');
    expect(createTheme(settings)).toMatchObject({
      dark: false,
      background: '#fafaf8',
      surface: '#fafaf8',
      surface2: '#f0efec',
      line: '#e3e1dc',
      lineStrong: '#d0cec9',
      primary: '#2b5548'
    });
  });

  it('keeps the Android bottom navigation close to the phone edge', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800);

    expect(styles.nav.paddingBottom).toBe(8);
    expect(styles.contentInner.paddingBottom).toBe(96);
    expect(styles.feedFloatingActions.bottom).toBe(78);
  });

  it('keeps scrolled content from drawing under the Android status bar', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800);

    expect(styles.statusBarScrim).toMatchObject({
      position: 'absolute',
      top: 0,
      height: 24,
      backgroundColor: theme.background
    });
    expect(styles.statusBarScrim.zIndex).toBeGreaterThan(10);
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

  it('makes foldable panel state icons visible and tappable', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800);

    expect(styles.expandableStateIcon).toMatchObject({
      alignItems: 'center',
      justifyContent: 'center',
      width: 32,
      height: 32,
      borderRadius: 999,
      backgroundColor: theme.surface2
    });
    expect(styles.expandableStateIcon.borderWidth).toBe(1);
  });

  it('keeps topic rows blended into the maintained pea white background', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800);

    expect(styles.topicRowShell.backgroundColor).toBe(theme.background);
    expect(styles.topicCard.backgroundColor).toBe(theme.background);
  });

  it('lays out topic rows as full-width rows with internal padding instead of floating cards', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800);

    expect(styles.feedListContentInner.paddingHorizontal).toBe(0);
    expect(styles.feedListContentInner.gap).toBe(0);
    expect(styles.topicRowShell.width).toBe('100%');
    expect(styles.topicCard.width).toBe('100%');
    expect(styles.topicCardPressable.paddingHorizontal).toBe(16);
    expect(styles.topicCardPressable.paddingTop).toBeGreaterThan(10);
    expect(styles.topicCardPressable.paddingBottom).toBeGreaterThan(10);
    expect(styles.topicCard.borderRadius || 0).toBe(0);
  });

  it('keeps reading typography and quotes quiet instead of decorative', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800) as Record<string, Record<string, unknown>>;
    const letterSpacingValues = Object.values(styles)
      .map((style) => style.letterSpacing)
      .filter((value) => value !== undefined);

    expect(letterSpacingValues.every((value) => value === 0)).toBe(true);
    expect(styles.quoteBox.borderLeftWidth).toBeUndefined();
    expect(styles.quoteBox.borderWidth).toBe(1);
    expect(styles.quoteBox.borderRadius).toBeLessThanOrEqual(8);
  });

  it('keeps dark topic rows on the same neutral background as the page', () => {
    const theme = createTheme({ ...settings, theme: 'dark' });
    const styles = createStyles(theme, { ...settings, theme: 'dark' }, 800);

    expect(theme).toMatchObject({
      dark: true,
      background: '#121210',
      surface: '#1a1918',
      surface2: '#242321',
      line: '#302f2c',
      lineStrong: '#454441',
      ink: '#eceae6',
      muted: '#a3a19b',
      primary: '#82bda8'
    });
    expect(styles.topicRowShell.backgroundColor).toBe(theme.background);
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
      primary: '#2b5548'
    });
    expect(createTheme({ ...settings, theme: 'dark' })).toMatchObject({
      dark: true,
      primary: '#82bda8'
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
