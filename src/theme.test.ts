import { describe, expect, it, vi } from 'vitest';
import { StyleSheet } from 'react-native';
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
    fontScale: 1,
    lineHeight: 'standard',
    contentWidth: 'standard',
    fontFamily: 'sans',
    listDensity: 'standard'
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

  it('creates rgba colors and high-contrast light theme tokens', () => {
    expect(alphaColor('#2f6555', 0.065)).toBe('rgba(47, 101, 85, 0.065)');
    expect(createTheme(settings)).toMatchObject({
      dark: false,
      background: '#ffffff',
      surface: '#ffffff',
      surface2: '#eef1ec',
      line: '#e3e7df',
      lineStrong: '#d2d8cb',
      primary: '#2f6a54'
    });
  });

  it('keeps the Android bottom navigation close to the phone edge', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800);

    expect(styles.nav.paddingBottom).toBe(8);
    expect(styles.contentInner.paddingBottom).toBe(96);
    expect(styles.moreContentInner.paddingBottom).toBeGreaterThan(styles.contentInner.paddingBottom);
  });

  it('keeps destructive and long-chip styles visually explicit', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800);

    expect(styles.buttonDanger.backgroundColor).toBe(alphaColor(theme.danger, 0.06));
    expect(styles.buttonTextDanger.color).toBe(theme.danger);
    expect(styles.removableChip.maxWidth).toBe(240);
    expect(styles.removableChipText.maxWidth).toBe(198);
  });

  it('keeps scrolled content from drawing under the Android status bar', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800);

    expect(styles.statusBarScrim).toMatchObject({
      position: 'absolute',
      top: 0,
      height: 24,
      backgroundColor: theme.background,
      elevation: 0
    });
    expect(styles.statusBarScrim.zIndex).toBeGreaterThan(10);
  });

  it('keeps the feed fixed header visually quiet', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800);

    expect(styles.feedFixedHeader.elevation).toBe(0);
    expect(styles.feedFixedHeader.borderBottomWidth).toBe(StyleSheet.hairlineWidth);
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

  it('keeps topic loading and reply sections aligned with a light divider', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800);

    expect(styles.loadingState.width).toBe('100%');
    expect(styles.replyHeader.width).toBe('100%');
    expect(styles.replyHeader.borderTopWidth).toBe(StyleSheet.hairlineWidth);
    expect(styles.replyHeader.borderTopColor).toBe(theme.line);
  });

  it('keeps reply action rows single-line with compact tappable buttons', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800) as Record<string, Record<string, unknown>>;

    expect(styles.replyActionRow.flexWrap).toBeUndefined();
    expect(styles.replyActionRow.gap).toBeLessThan(8);
    expect(styles.replyCompactActionButton.flex).toBeUndefined();
    expect(styles.replyCompactActionButton.flexShrink).toBe(0);
    expect(styles.replyCompactActionButton.width).toBe(76);
    expect(styles.replyCompactActionButton.justifyContent).toBe('flex-start');
    expect(styles.detailActionCompactTextBlock.gap).toBe(2);
    expect(styles.replyCompactActionButton.minWidth).toBeGreaterThanOrEqual(44);
    expect(styles.replyCompactActionButton.minHeight).toBeGreaterThanOrEqual(44);
  });

  it('makes foldable panel state icons visible and tappable', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800);

    expect(styles.expandableStateIcon).toMatchObject({
      alignItems: 'center',
      justifyContent: 'center',
      width: 32,
      height: 32,
      borderRadius: 10,
      backgroundColor: theme.surface2
    });
    expect(styles.expandableStateIcon.borderWidth).toBe(1);
  });

  it('renders topic rows as flat full-width rows on the page surface', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800) as Record<string, Record<string, unknown>>;

    expect(styles.topicRowShell.backgroundColor).toBe(theme.surface);
    expect(styles.topicRowShell.borderRadius || 0).toBe(0);
    expect(styles.topicCardPressable.backgroundColor || 'transparent').toBe('transparent');
  });

  it('separates feed rows with a thin divider line', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800) as Record<string, Record<string, unknown>>;

    expect(styles.topicListSeparator.backgroundColor).toBe(theme.line);
    expect(styles.topicListSeparator.height).toBe(1);
    expect(styles.topicRowShell.borderBottomWidth || 0).toBe(0);
    expect(styles.topicCardPressable.borderBottomWidth || 0).toBe(0);
  });

  it('styles feed secondary tags as lightweight underline tabs', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800) as Record<string, Record<string, unknown>>;

    expect(styles.subtab.backgroundColor).toBe('transparent');
    expect(styles.subtab.borderBottomColor).toBe('transparent');
    expect(styles.subtabActive.borderBottomColor).toBe(theme.primary);
    expect(styles.subtabActive.backgroundColor || 'transparent').toBe('transparent');
    expect(styles.subtabTextActive.color).toBe(theme.primary);
    expect(styles.subtabTextActive.fontWeight).toBe('600');
  });

  it('lays out topic rows as full-width rows with internal padding', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800) as Record<string, Record<string, unknown>>;

    expect(styles.feedListContentInner.paddingHorizontal).toBe(0);
    expect(styles.topicRowShell.width).toBe('100%');
    expect(styles.topicCardPressable.paddingHorizontal).toBe(16);
    expect(styles.topicCardPressable.paddingTop as number).toBeGreaterThan(10);
    expect(styles.topicCardPressable.paddingBottom as number).toBeGreaterThan(10);
    expect(styles.topicRowShell.borderRadius || 0).toBe(0);
  });

  it('presents Android topic rows as unified forum threads', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800) as Record<string, Record<string, unknown>>;

    expect(styles.topicBadgeRow.flexDirection).toBe('row');
    expect(styles.topicSourceBadge.borderRadius).toBe(7);
    expect(styles.topicCategoryBadge.borderColor).toBe(theme.line);
    expect(styles.topicStatGroup.flexDirection).toBe('row');
    expect(styles.topicFooterRow.justifyContent).toBe('space-between');
  });

  it('keeps topic tags lighter than reaction chips', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800) as Record<string, Record<string, unknown>>;

    expect(styles.topicTagPill.minHeight).toBeLessThan(styles.nodeSeekStatCompact.minHeight as number);
    expect(styles.topicTagPill.backgroundColor).toBe('transparent');
    expect(styles.topicTagPill.borderWidth).toBe(0);
    expect(styles.topicTagText.fontSize).toBeLessThan(styles.nodeSeekStatText.fontSize as number);
  });

  it('keeps search source headers quieter than result titles', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800) as Record<string, Record<string, unknown>>;

    expect(styles.searchGroupSourceMark).toBeUndefined();
    expect(styles.searchGroupTitleRow.gap).toBeGreaterThan(8);
    expect(styles.searchGroupTitleText.fontSize).toBeLessThan(styles.cardTitle.fontSize as number);
    expect(styles.searchGroupTitleText.color).toBe(theme.ink);
    expect(styles.searchGroupMetaText.color).toBe(theme.muted);
    expect(styles.searchGroupChevron.opacity).toBeLessThan(1);
    expect(styles.searchGroupMetaPill).toBeUndefined();
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
    expect(styles.quoteBox.borderRadius).toBeLessThanOrEqual(14);
  });

  it('does not force narrow markdown tables wider than the reading column', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800) as Record<string, Record<string, unknown>>;

    expect(styles.htmlTableFrame.minWidth).toBeUndefined();
  });

  it('keeps dark topic rows flat on the page surface', () => {
    const theme = createTheme({ ...settings, theme: 'dark' });
    const styles = createStyles(theme, { ...settings, theme: 'dark' }, 800) as Record<string, Record<string, unknown>>;

    expect(theme).toMatchObject({
      dark: true,
      background: '#12151a',
      surface: '#12151a',
      surface2: '#232831',
      line: '#313840',
      lineStrong: '#454d54',
      ink: '#e8ece9',
      muted: '#97a39c',
      primary: '#7cc9a4'
    });
    expect(styles.topicRowShell.backgroundColor).toBe(theme.surface);
    expect(styles.topicCardPressable.backgroundColor || 'transparent').toBe('transparent');
  });

  it('keeps chrome and controls on a single surface family', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800);

    expect(theme.surface).toBe(theme.background);
    expect(styles.group.backgroundColor).toBe(theme.surface);
    expect(styles.button.backgroundColor).toBe(theme.surface);
    expect(styles.input.backgroundColor).toBe(theme.surface);
    expect(styles.nav.backgroundColor).toBe(theme.surface);
  });

  it('keeps the feed back-to-top action above the bottom navigation without a bar', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800);

    expect(styles.feedFloatingActions).toMatchObject({
      position: 'absolute',
      right: 16,
      bottom: 92,
      flexDirection: 'row',
      justifyContent: 'flex-end',
      backgroundColor: 'transparent'
    });
    expect(styles.feedFloatingActions).not.toHaveProperty('minHeight');
    expect(styles.feedFloatingActions).not.toHaveProperty('borderTopWidth');
  });

  it('uses only explicit light and dark themes', () => {
    expect(createTheme({ ...settings, theme: 'light' })).toMatchObject({
      dark: false,
      primary: '#2f6a54'
    });
    expect(createTheme({ ...settings, theme: 'dark' })).toMatchObject({
      dark: true,
      primary: '#7cc9a4'
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
